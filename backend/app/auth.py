import base64
import hashlib
import hmac
import os
import secrets
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

DATABASE_PATH = Path(os.getenv("GAMBLEPIGEON_DB", "gamblepigeon.db"))
SESSION_COOKIE_NAME = "gamblepigeon_session"
SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 400
DEFAULT_BALANCE = 1000
PBKDF2_ITERATIONS = 210_000


@dataclass
class Account:
    id: int
    username: str
    display_name: str
    balance: int


def get_connection() -> sqlite3.Connection:
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def init_auth_db() -> None:
    with get_connection() as connection:
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE COLLATE NOCASE,
                display_name TEXT NOT NULL,
                password_salt TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                balance INTEGER NOT NULL DEFAULT 1000,
                created_at INTEGER NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                account_id INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL,
                FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
            )
            """
        )


def normalize_username(username: str) -> str:
    normalized = "".join(str(username).strip().lower().split())
    if len(normalized) < 3 or len(normalized) > 24:
        raise ValueError("Username must be 3-24 characters.")
    if not all(character.isalnum() or character in {"_", "-"} for character in normalized):
        raise ValueError("Username can only use letters, numbers, underscores, and dashes.")
    return normalized


def clean_display_name(display_name: Optional[str], fallback: str) -> str:
    cleaned = " ".join(str(display_name or "").strip().split())
    return (cleaned or fallback)[:24]


def validate_password(password: str) -> None:
    if len(password) < 8:
        raise ValueError("Password must be at least 8 characters.")
    if len(password) > 256:
        raise ValueError("Password is too long.")


def hash_password(password: str, salt: bytes) -> str:
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt,
        PBKDF2_ITERATIONS,
    )
    return base64.b64encode(digest).decode("ascii")


def verify_password(password: str, salt_b64: str, expected_hash_b64: str) -> bool:
    salt = base64.b64decode(salt_b64.encode("ascii"))
    actual_hash = hash_password(password, salt)
    return hmac.compare_digest(actual_hash, expected_hash_b64)


def hash_session_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def row_to_account(row: sqlite3.Row) -> Account:
    return Account(
        id=int(row["id"]),
        username=str(row["username"]),
        display_name=str(row["display_name"]),
        balance=int(row["balance"]),
    )


def serialize_account(account: Optional[Account]) -> Optional[dict]:
    if not account:
        return None
    return {
        "id": account.id,
        "username": account.username,
        "displayName": account.display_name,
        "balance": account.balance,
    }


def create_account(username: str, password: str, display_name: Optional[str]) -> tuple[Account, str]:
    normalized_username = normalize_username(username)
    validate_password(password)
    salt = secrets.token_bytes(16)
    now = int(time.time())

    try:
        with get_connection() as connection:
            cursor = connection.execute(
                """
                INSERT INTO accounts (username, display_name, password_salt, password_hash, balance, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    normalized_username,
                    clean_display_name(display_name, normalized_username),
                    base64.b64encode(salt).decode("ascii"),
                    hash_password(password, salt),
                    DEFAULT_BALANCE,
                    now,
                ),
            )
            account_id = int(cursor.lastrowid)
            account = Account(
                id=account_id,
                username=normalized_username,
                display_name=clean_display_name(display_name, normalized_username),
                balance=DEFAULT_BALANCE,
            )
    except sqlite3.IntegrityError:
        raise ValueError("That username is already taken.")

    return account, create_session(account.id)


def authenticate(username: str, password: str) -> tuple[Account, str]:
    normalized_username = normalize_username(username)

    with get_connection() as connection:
        row = connection.execute(
            "SELECT * FROM accounts WHERE username = ?",
            (normalized_username,),
        ).fetchone()

    if not row or not verify_password(password, row["password_salt"], row["password_hash"]):
        raise ValueError("Invalid username or password.")

    account = row_to_account(row)
    return account, create_session(account.id)


def create_session(account_id: int) -> str:
    token = secrets.token_urlsafe(48)
    now = int(time.time())
    expires_at = now + SESSION_MAX_AGE_SECONDS

    with get_connection() as connection:
        connection.execute(
            "INSERT INTO sessions (token_hash, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
            (hash_session_token(token), account_id, now, expires_at),
        )

    return token


def get_account_by_session_token(token: Optional[str]) -> Optional[Account]:
    if not token:
        return None

    now = int(time.time())
    token_hash = hash_session_token(token)

    with get_connection() as connection:
        row = connection.execute(
            """
            SELECT accounts.*
            FROM sessions
            JOIN accounts ON accounts.id = sessions.account_id
            WHERE sessions.token_hash = ? AND sessions.expires_at > ?
            """,
            (token_hash, now),
        ).fetchone()

    return row_to_account(row) if row else None


def delete_session(token: Optional[str]) -> None:
    if not token:
        return
    with get_connection() as connection:
        connection.execute("DELETE FROM sessions WHERE token_hash = ?", (hash_session_token(token),))


def get_account(account_id: Optional[int]) -> Optional[Account]:
    if not account_id:
        return None

    with get_connection() as connection:
        row = connection.execute("SELECT * FROM accounts WHERE id = ?", (account_id,)).fetchone()

    return row_to_account(row) if row else None


def update_display_name(account_id: int, display_name: str) -> Optional[Account]:
    account = get_account(account_id)
    if not account:
        return None

    cleaned_name = clean_display_name(display_name, account.username)

    with get_connection() as connection:
        connection.execute(
            "UPDATE accounts SET display_name = ? WHERE id = ?",
            (cleaned_name, account_id),
        )

    return get_account(account_id)


def can_afford(account_id: Optional[int], amount: int) -> bool:
    account = get_account(account_id)
    return bool(account and account.balance >= amount)


def transfer_balance(winner_account_id: int, loser_account_id: int, amount: int) -> tuple[Account, Account]:
    if amount <= 0:
        raise ValueError("Wager must be positive.")
    if winner_account_id == loser_account_id:
        raise ValueError("Cannot gamble against yourself.")

    with get_connection() as connection:
        loser_row = connection.execute(
            "SELECT balance FROM accounts WHERE id = ?",
            (loser_account_id,),
        ).fetchone()

        if not loser_row or int(loser_row["balance"]) < amount:
            raise ValueError("Loser no longer has enough money to pay the wager.")

        connection.execute(
            "UPDATE accounts SET balance = balance + ? WHERE id = ?",
            (amount, winner_account_id),
        )
        connection.execute(
            "UPDATE accounts SET balance = balance - ? WHERE id = ?",
            (amount, loser_account_id),
        )

    winner = get_account(winner_account_id)
    loser = get_account(loser_account_id)

    if not winner or not loser:
        raise ValueError("Unable to update balances.")

    return winner, loser
