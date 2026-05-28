import random
import secrets
import string
from dataclasses import dataclass, field
from typing import Dict, Optional

from fastapi import WebSocket

from app.pong import PongGame
from app.pool import PoolGame

SUPPORTED_GAMES = {
    "pong": "Pong",
    "pool": "8-Ball Pool"
}


def clean_player_name(name: Optional[str], fallback: str) -> str:
    if not name:
        return fallback

    cleaned_name = " ".join(str(name).strip().split())

    if not cleaned_name:
        return fallback

    return cleaned_name[:24]


@dataclass
class Room:
    code: str
    host_token: str
    game_name: str = "pong"
    host_player_id: Optional[str] = None
    players: Dict[str, WebSocket] = field(default_factory=dict)
    player_names: Dict[str, str] = field(default_factory=dict)
    player_account_ids: Dict[str, int] = field(default_factory=dict)
    wager: int = 0
    winning_score: int = 5
    pong_ball_speed: float = 5
    pool_table_speed: float = 0.985
    pool_max_shot_power: float = 22
    max_pause_seconds: int = 30
    pauses_per_player: int = 2
    paid_out: bool = False
    game: PongGame = field(default_factory=PongGame)

    def is_host(self, player_id: str) -> bool:
        return self.host_player_id == player_id

    def set_player_name(self, player_id: str, name: Optional[str]):
        self.player_names[player_id] = clean_player_name(name, player_id)

    def set_game(self, game_name: str):
        if self.game.started:
            raise ValueError("You cannot change the game after it starts.")

        normalized_game_name = game_name.lower().strip()

        if normalized_game_name not in SUPPORTED_GAMES:
            raise ValueError(f"Unsupported game: {game_name}")

        self.game_name = normalized_game_name

        self.reset_game()

    def set_wager(self, wager: int):
        if self.game.started:
            raise ValueError("You cannot change the wager after the game starts.")
        if wager < 0:
            raise ValueError("Wager cannot be negative.")
        if wager > 1_000_000:
            raise ValueError("Wager is too high.")
        self.wager = wager

    def set_game_settings(
            self,
            winning_score: int,
            pong_ball_speed: float,
            max_pause_seconds: int,
            pauses_per_player: int,
            pool_table_speed: float = None,
            pool_max_shot_power: float = None,
    ):
        if self.game.started:
            raise ValueError("You cannot change game settings after the game starts.")

        self.winning_score = PongGame.clean_winning_score(winning_score)
        self.pong_ball_speed = PongGame.clean_ball_speed(pong_ball_speed)
        self.max_pause_seconds = PongGame.clean_max_pause_seconds(max_pause_seconds)
        self.pauses_per_player = PongGame.clean_pauses_per_player(pauses_per_player)
        if pool_table_speed is not None:
            self.pool_table_speed = PoolGame.clean_table_speed(pool_table_speed)
        if pool_max_shot_power is not None:
            self.pool_max_shot_power = PoolGame.clean_max_shot_power(pool_max_shot_power)
        self.reset_game()

    def reset_game(self):
        if self.game_name == "pool":
            self.game = PoolGame(
                max_pause_seconds=self.max_pause_seconds,
                pauses_per_player=self.pauses_per_player,
                table_speed=self.pool_table_speed,
                max_shot_power=self.pool_max_shot_power,
            )
        else:
            self.game = PongGame(
                winning_score=self.winning_score,
                ball_speed=self.pong_ball_speed,
                max_pause_seconds=self.max_pause_seconds,
                pauses_per_player=self.pauses_per_player,
            )
        self.paid_out = False


rooms: Dict[str, Room] = {}


def generate_room_code(length: int = 6) -> str:
    alphabet = string.ascii_uppercase + string.digits

    while True:
        code = "".join(random.choice(alphabet) for _ in range(length))
        if code not in rooms:
            return code


def create_room() -> Room:
    code = generate_room_code()
    room = Room(code=code, host_token=secrets.token_urlsafe(24))
    rooms[code] = room
    return room


def get_room(room_code: str) -> Optional[Room]:
    return rooms.get(room_code.upper())


def join_room(
    room_code: str,
    websocket: WebSocket,
    host_token: Optional[str] = None,
    player_name: Optional[str] = None,
    account_id: Optional[int] = None
) -> str:
    room = rooms[room_code.upper()]

    if "player1" not in room.players:
        player_id = "player1"
    elif "player2" not in room.players:
        player_id = "player2"
    else:
        player_id = f"spectator{len(room.players) + 1}"

    room.players[player_id] = websocket
    room.set_player_name(player_id, player_name)

    if account_id is not None:
        room.player_account_ids[player_id] = account_id

    if host_token and secrets.compare_digest(host_token, room.host_token):
        room.host_player_id = player_id

    return player_id


def remove_player(room_code: str, player_id: str):
    room = rooms.get(room_code.upper())
    if not room:
        return

    room.players.pop(player_id, None)
    room.player_names.pop(player_id, None)
    room.player_account_ids.pop(player_id, None)

    if room.host_player_id == player_id:
        room.host_player_id = None

    # Do not delete the room immediately.
    # React dev mode / StrictMode can briefly disconnect and reconnect WebSockets.
