import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";

const WS_BASE = "ws://localhost:8000";
const PLAYER_NAME_COOKIE = "gamblepigeon_player_name";

type GameState = {
    width: number;
    height: number;
    started: boolean;
    paddles: {
        player1: Paddle;
        player2: Paddle;
    };
    ball: {
        x: number;
        y: number;
        size: number;
    };
    score: {
        player1: number;
        player2: number;
    };
};

type Paddle = {
    x: number;
    y: number;
    width: number;
    height: number;
};

type RoomPlayer = {
    id: string;
    name: string;
    isHost: boolean;
};

type RoomState = {
    code: string;
    players: RoomPlayer[];
    hostPlayerId: string | null;
    gameName: string;
    supportedGames: Record<string, string>;
    game: GameState;
};

function readCookie(name: string): string | null {
    const cookie = document.cookie
        .split("; ")
        .find((row) => row.startsWith(`${name}=`));

    if (!cookie) {
        return null;
    }

    return decodeURIComponent(cookie.split("=").slice(1).join("="));
}

function writeCookie(name: string, value: string) {
    const maxAge = 60 * 60 * 24 * 365;
    document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${maxAge}; SameSite=Lax; Path=/`;
}

function defaultPlayerName() {
    return `Player ${Math.floor(1000 + Math.random() * 9000)}`;
}

export default function RoomPage() {
    const { roomCode } = useParams();

    const socketRef = useRef<WebSocket | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    const [playerId, setPlayerId] = useState<string | null>(null);
    const [room, setRoom] = useState<RoomState | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [isManageOpen, setIsManageOpen] = useState(false);
    const [isNameOpen, setIsNameOpen] = useState(false);
    const [playerName, setPlayerName] = useState(() => readCookie(PLAYER_NAME_COOKIE) ?? defaultPlayerName());
    const [draftPlayerName, setDraftPlayerName] = useState(playerName);

    const shareUrl = window.location.href;
    const currentPlayer = room?.players.find((player) => player.id === playerId);
    const isHost = Boolean(playerId && room?.hostPlayerId === playerId);

    useEffect(() => {
        writeCookie(PLAYER_NAME_COOKIE, playerName);
    }, [playerName]);

    useEffect(() => {
        if (!roomCode) {
            return;
        }

        const hostToken = sessionStorage.getItem(`hostToken:${roomCode}`);
        const socketUrl = new URL(`${WS_BASE}/ws/rooms/${roomCode}`);

        socketUrl.searchParams.set("playerName", playerName);

        if (hostToken) {
            socketUrl.searchParams.set("hostToken", hostToken);
        }

        const socket = new WebSocket(socketUrl.toString());
        socketRef.current = socket;

        socket.onmessage = (event) => {
            const message = JSON.parse(event.data);

            if (message.type === "joined") {
                setPlayerId(message.playerId);
            }

            if (message.type === "state") {
                setRoom(message.room);
            }

            if (message.type === "error") {
                setNotice(message.message);
            }

            if (message.type === "kicked") {
                setNotice(message.message);
                socket.close();
            }
        };

        return () => {
            socket.close();
        };
    }, [roomCode]);

    useEffect(() => {
        const interval = window.setInterval(() => {
            socketRef.current?.send(JSON.stringify({ type: "tick" }));
        }, 1000 / 60);

        return () => {
            window.clearInterval(interval);
        };
    }, []);

    useEffect(() => {
        if (!room) {
            return;
        }

        drawGame(room.game);
    }, [room]);

    useEffect(() => {
        function handleKeyDown(event: KeyboardEvent) {
            if (event.key === "ArrowUp" || event.key.toLowerCase() === "w") {
                sendPaddleDirection("up");
            }

            if (event.key === "ArrowDown" || event.key.toLowerCase() === "s") {
                sendPaddleDirection("down");
            }
        }

        function handleKeyUp(event: KeyboardEvent) {
            if (
                event.key === "ArrowUp" ||
                event.key === "ArrowDown" ||
                event.key.toLowerCase() === "w" ||
                event.key.toLowerCase() === "s"
            ) {
                sendPaddleDirection("none");
            }
        }

        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("keyup", handleKeyUp);

        return () => {
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("keyup", handleKeyUp);
        };
    }, []);

    function sendPaddleDirection(direction: "up" | "down" | "none") {
        socketRef.current?.send(
            JSON.stringify({
                type: "paddle",
                direction,
            })
        );
    }

    function startGame() {
        socketRef.current?.send(
            JSON.stringify({
                type: "start",
            })
        );
    }

    function changeGame(game: string) {
        socketRef.current?.send(
            JSON.stringify({
                type: "set_game",
                game,
            })
        );
        setNotice(`Game changed to ${room?.supportedGames[game] ?? game}.`);
        setIsManageOpen(false);
    }

    function kickPlayer(targetPlayerId: string) {
        socketRef.current?.send(
            JSON.stringify({
                type: "kick_player",
                playerId: targetPlayerId,
            })
        );
    }

    function savePlayerName() {
        const cleanedName = draftPlayerName.trim().replace(/\s+/g, " ").slice(0, 24) || defaultPlayerName();

        setPlayerName(cleanedName);
        writeCookie(PLAYER_NAME_COOKIE, cleanedName);
        socketRef.current?.send(
            JSON.stringify({
                type: "set_name",
                name: cleanedName,
            })
        );
        setIsNameOpen(false);
        setNotice("Name saved.");
    }

    async function copyInviteLink() {
        await navigator.clipboard.writeText(shareUrl);
        setNotice("Invite link copied.");
    }

    function drawGame(game: GameState) {
        const canvas = canvasRef.current;

        if (!canvas) {
            return;
        }

        const ctx = canvas.getContext("2d");

        if (!ctx) {
            return;
        }

        ctx.clearRect(0, 0, game.width, game.height);

        ctx.fillStyle = "#111827";
        ctx.fillRect(0, 0, game.width, game.height);

        ctx.fillStyle = "white";

        // Middle line
        for (let y = 0; y < game.height; y += 30) {
            ctx.fillRect(game.width / 2 - 2, y, 4, 15);
        }

        // Paddles
        const p1 = game.paddles.player1;
        const p2 = game.paddles.player2;

        ctx.fillRect(p1.x, p1.y, p1.width, p1.height);
        ctx.fillRect(p2.x, p2.y, p2.width, p2.height);

        // Ball
        ctx.fillRect(game.ball.x, game.ball.y, game.ball.size, game.ball.size);

        // Score
        ctx.font = "32px Arial";
        ctx.fillText(String(game.score.player1), game.width / 2 - 70, 50);
        ctx.fillText(String(game.score.player2), game.width / 2 + 50, 50);
    }

    return (
        <main className="room-page">
            <section className="room-header">
                <div>
                    <h1>Lobby {roomCode}</h1>
                    <p>
                        You are: {currentPlayer?.name ?? playerName} {isHost ? "(host)" : ""}
                    </p>
                    <p>Players: {room?.players.length ?? 0}</p>
                    <p>Game: {room?.supportedGames[room.gameName] ?? room?.gameName ?? "Loading..."}</p>
                    {notice && <p className="notice">{notice}</p>}
                </div>

                <div className="room-actions">
                    <button onClick={copyInviteLink}>Copy Invite Link</button>
                    <button
                        className="secondary"
                        onClick={() => {
                            setDraftPlayerName(playerName);
                            setIsNameOpen(true);
                        }}
                    >
                        Change Name
                    </button>
                    {isHost && (
                        <button className="secondary" onClick={() => setIsManageOpen(true)}>
                            Manage Lobby
                        </button>
                    )}
                    {isHost && <button onClick={startGame}>Start Game</button>}
                </div>
            </section>

            <section className="game-wrapper">
                <canvas
                    ref={canvasRef}
                    width={800}
                    height={500}
                    className="game-canvas"
                />
            </section>

            <section className="mobile-controls">
                <button onPointerDown={() => sendPaddleDirection("up")} onPointerUp={() => sendPaddleDirection("none")}>
                    Up
                </button>

                <button onPointerDown={() => sendPaddleDirection("down")} onPointerUp={() => sendPaddleDirection("none")}>
                    Down
                </button>
            </section>

            <p className="instructions">
                Desktop: use W/S or Arrow Up/Down. Phone: use the Up/Down buttons.
            </p>

            {isNameOpen && (
                <div className="modal-backdrop" onClick={() => setIsNameOpen(false)}>
                    <section className="modal-card compact-modal" onClick={(event) => event.stopPropagation()}>
                        <div className="modal-header">
                            <div>
                                <p className="eyebrow">Profile</p>
                                <h2>Change your display name</h2>
                            </div>
                            <button className="icon-button" onClick={() => setIsNameOpen(false)} aria-label="Close name editor">
                                ×
                            </button>
                        </div>

                        <label className="field-label">
                            Display name
                            <input
                                value={draftPlayerName}
                                maxLength={24}
                                onChange={(event) => setDraftPlayerName(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                        savePlayerName();
                                    }
                                }}
                                placeholder="Your name"
                            />
                        </label>

                        <div className="modal-actions">
                            <button className="secondary" onClick={() => setIsNameOpen(false)}>
                                Cancel
                            </button>
                            <button onClick={savePlayerName}>Save Name</button>
                        </div>
                    </section>
                </div>
            )}

            {isManageOpen && isHost && room && (
                <div className="modal-backdrop" onClick={() => setIsManageOpen(false)}>
                    <section className="modal-card" onClick={(event) => event.stopPropagation()}>
                        <div className="modal-header">
                            <div>
                                <p className="eyebrow">Host controls</p>
                                <h2>Manage Lobby</h2>
                            </div>
                            <button className="icon-button" onClick={() => setIsManageOpen(false)} aria-label="Close lobby manager">
                                ×
                            </button>
                        </div>

                        <div className="manager-section">
                            <h3>Choose a game</h3>
                            <div className="game-choice-grid">
                                {Object.entries(room.supportedGames).map(([gameId, gameLabel]) => {
                                    const selected = gameId === room.gameName;

                                    return (
                                        <button
                                            key={gameId}
                                            className={`game-choice ${selected ? "selected" : ""}`}
                                            onClick={() => changeGame(gameId)}
                                            disabled={selected}
                                        >
                                            <span>{gameLabel}</span>
                                            <small>{selected ? "Selected" : "Switch game"}</small>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="manager-section">
                            <h3>Players</h3>
                            <div className="player-list">
                                {room.players.map((connectedPlayer) => (
                                    <div className="player-row" key={connectedPlayer.id}>
                                        <span>
                                            <strong>{connectedPlayer.name}</strong>
                                            <small>{connectedPlayer.isHost ? "Host" : connectedPlayer.id}</small>
                                        </span>

                                        {connectedPlayer.id !== playerId && (
                                            <button className="danger" onClick={() => kickPlayer(connectedPlayer.id)}>
                                                Kick
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </section>
                </div>
            )}
        </main>
    );
}
