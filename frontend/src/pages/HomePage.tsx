import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

const API_BASE = "http://localhost:8000";

const FALLBACK_GAMES: Record<string, string> = {
    pong: "Pong",
    pool: "8-Ball Pool",
};

type Account = {
    id: number;
    username: string;
    displayName: string;
    balance: number;
};

export default function HomePage() {
    const navigate = useNavigate();

    const [joinCode, setJoinCode] = useState("");
    const [isCreating, setIsCreating] = useState(false);
    const [account, setAccount] = useState<Account | null>(null);
    const [authMode, setAuthMode] = useState<"login" | "register">("login");
    const [username, setUsername] = useState("");
    const [displayName, setDisplayName] = useState("");
    const [password, setPassword] = useState("");
    const [authMessage, setAuthMessage] = useState<string | null>(null);
    const [supportedGames, setSupportedGames] = useState<Record<string, string>>(FALLBACK_GAMES);
    const [isGamePickerOpen, setIsGamePickerOpen] = useState(false);
    const [createError, setCreateError] = useState<string | null>(null);

    useEffect(() => {
        refreshAccount();
        loadSupportedGames();
    }, []);

    async function refreshAccount() {
        const response = await fetch(`${API_BASE}/auth/me`, {
            credentials: "include",
        });
        const data = await response.json();
        setAccount(data.account ?? null);
    }

    async function loadSupportedGames() {
        try {
            const response = await fetch(`${API_BASE}/games`, {
                credentials: "include",
            });

            if (!response.ok) {
                return;
            }

            const data = await response.json();
            setSupportedGames(data.games ?? FALLBACK_GAMES);
        } catch {
            setSupportedGames(FALLBACK_GAMES);
        }
    }

    async function submitAuth() {
        setAuthMessage(null);

        const response = await fetch(`${API_BASE}/auth/${authMode}`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                username,
                password,
                displayName: displayName || username,
            }),
        });

        const data = await response.json();

        if (!response.ok) {
            setAuthMessage(data.detail ?? "Unable to sign in.");
            return;
        }

        setAccount(data.account);
        setPassword("");
        setAuthMessage("Signed in. Your money will be tracked across games.");
    }

    async function logout() {
        await fetch(`${API_BASE}/auth/logout`, {
            method: "POST",
            credentials: "include",
        });
        setAccount(null);
    }

    async function createLobby(game: string) {
        setIsCreating(true);
        setCreateError(null);

        try {
            const response = await fetch(`${API_BASE}/rooms`, {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ game }),
            });

            const data = await response.json();

            if (!response.ok) {
                setCreateError(data.detail ?? "Unable to create lobby.");
                return;
            }

            sessionStorage.setItem(`hostToken:${data.roomCode}`, data.hostToken);
            navigate(`/room/${data.roomCode}`);
        } finally {
            setIsCreating(false);
        }
    }

    function openGamePicker() {
        setCreateError(null);
        setIsGamePickerOpen(true);
    }

    function joinLobby() {
        const cleanedCode = joinCode.trim().toUpperCase();

        if (!cleanedCode) {
            return;
        }

        navigate(`/room/${cleanedCode}`);
    }

    return (
        <main className="page">
            <section className="card home-card">
                <h1>Game Night</h1>
                <p className="subtitle">Create a lobby, share the link, pick a game, and play for fun or wagers.</p>

                {account ? (
                    <div className="account-panel">
                        <div>
                            <strong>{account.displayName}</strong>
                            <span>@{account.username}</span>
                        </div>
                        <strong>${account.balance}</strong>
                        <button className="secondary small-button" onClick={logout}>Log out</button>
                    </div>
                ) : (
                    <div className="auth-panel">
                        <div className="segmented-buttons">
                            <button className={authMode === "login" ? "selected" : "secondary"} onClick={() => setAuthMode("login")}>Log in</button>
                            <button className={authMode === "register" ? "selected" : "secondary"} onClick={() => setAuthMode("register")}>Register</button>
                        </div>

                        <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Username" />
                        {authMode === "register" && (
                            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Display name" />
                        )}
                        <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" type="password" />
                        <button onClick={submitAuth}>{authMode === "login" ? "Log In" : "Create Account"}</button>
                        {authMessage && <p className="notice">{authMessage}</p>}
                        <p className="helper-text">You can still join lobbies as a guest. Log in to keep money and play wagered games.</p>
                    </div>
                )}

                <button onClick={openGamePicker} disabled={isCreating}>
                    Create Lobby
                </button>

                <div className="divider">or</div>

                <input
                    value={joinCode}
                    onChange={(event) => setJoinCode(event.target.value)}
                    placeholder="Enter room code"
                />

                <button className="secondary" onClick={joinLobby}>
                    Join Lobby
                </button>
            </section>

            {isGamePickerOpen && (
                <div className="modal-backdrop" onClick={() => setIsGamePickerOpen(false)}>
                    <section className="modal-card compact-modal" onClick={(event) => event.stopPropagation()}>
                        <div className="modal-header">
                            <div>
                                <p className="eyebrow">New lobby</p>
                                <h2>Choose a game</h2>
                            </div>
                            <button className="icon-button" onClick={() => setIsGamePickerOpen(false)} aria-label="Close game picker">
                                ×
                            </button>
                        </div>

                        <p className="helper-text">Your lobby will be created with the game you choose here. The host can still change it before starting.</p>

                        <div className="game-choice-grid home-game-choice-grid">
                            {Object.entries(supportedGames).map(([gameId, gameLabel]) => (
                                <button
                                    key={gameId}
                                    className="game-choice"
                                    onClick={() => createLobby(gameId)}
                                    disabled={isCreating}
                                >
                                    <span>{gameLabel}</span>
                                    <small>{isCreating ? "Creating..." : "Create lobby"}</small>
                                </button>
                            ))}
                        </div>

                        {createError && <p className="notice">{createError}</p>}
                    </section>
                </div>
            )}
        </main>
    );
}
