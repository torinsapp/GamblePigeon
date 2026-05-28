import { useEffect, useRef, useState, type PointerEvent } from "react";
import { useParams } from "react-router-dom";

const API_BASE = "http://localhost:8000";
const WS_BASE = "ws://localhost:8000";
const PLAYER_NAME_COOKIE = "gamblepigeon_player_name";

type Account = {
    id: number;
    username: string;
    displayName: string;
    balance: number;
};

type PoolBall = {
    number: number;
    kind: "cue" | "solid" | "stripe" | "eight";
    x: number;
    y: number;
    radius: number;
    pocketed: boolean;
};

type PoolPocket = {
    x: number;
    y: number;
    radius: number;
};

type GameState = {
    kind: "pong" | "pool";
    width: number;
    height: number;
    started: boolean;
    finished: boolean;
    winner: string | null;
    paused: boolean;
    pausedBy: string | null;
    pauseSecondsRemaining: number;
    maxPauseSeconds: number;
    pausesPerPlayer: number;
    pauseCounts: Record<string, number>;

    // Pong state
    winningScore?: number;
    ballSpeed?: number;
    paddles?: {
        player1: Paddle;
        player2: Paddle;
    };
    ball?: {
        x: number;
        y: number;
        size: number;
    };
    score?: {
        player1: number;
        player2: number;
    };

    // 8-ball pool state
    currentTurn?: string;
    groups?: Record<string, "solid" | "stripe" | null>;
    message?: string;
    tableSpeed?: number;
    maxShotPower?: number;
    shotInMotion?: boolean;
    rail?: number;
    balls?: PoolBall[];
    pockets?: PoolPocket[];
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
    isLoggedIn: boolean;
    balance: number | null;
};

type RoomState = {
    code: string;
    players: RoomPlayer[];
    hostPlayerId: string | null;
    gameName: string;
    supportedGames: Record<string, string>;
    wager: number;
    winningScore: number;
    pongBallSpeed: number;
    poolTableSpeed: number;
    poolMaxShotPower: number;
    maxPauseSeconds: number;
    pausesPerPlayer: number;
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
    const poolAimStartRef = useRef<{ x: number; y: number } | null>(null);

    const [playerId, setPlayerId] = useState<string | null>(null);
    const [room, setRoom] = useState<RoomState | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [account, setAccount] = useState<Account | null>(null);
    const [isManageOpen, setIsManageOpen] = useState(false);
    const [isNameOpen, setIsNameOpen] = useState(false);
    const [isAuthOpen, setIsAuthOpen] = useState(false);
    const [authMode, setAuthMode] = useState<"login" | "register">("login");
    const [authUsername, setAuthUsername] = useState("");
    const [authDisplayName, setAuthDisplayName] = useState("");
    const [authPassword, setAuthPassword] = useState("");
    const [authMessage, setAuthMessage] = useState<string | null>(null);
    const [playerName, setPlayerName] = useState(() => readCookie(PLAYER_NAME_COOKIE) ?? defaultPlayerName());
    const [draftPlayerName, setDraftPlayerName] = useState(playerName);
    const [draftWager, setDraftWager] = useState("0");
    const [draftWinningScore, setDraftWinningScore] = useState("5");
    const [draftPongBallSpeed, setDraftPongBallSpeed] = useState("5");
    const [draftPoolTableSpeed, setDraftPoolTableSpeed] = useState("0.985");
    const [draftPoolMaxShotPower, setDraftPoolMaxShotPower] = useState("22");
    const [draftMaxPauseSeconds, setDraftMaxPauseSeconds] = useState("30");
    const [draftPausesPerPlayer, setDraftPausesPerPlayer] = useState("2");

    const shareUrl = window.location.href;
    const currentPlayer = room?.players.find((player) => player.id === playerId);
    const isHost = Boolean(playerId && room?.hostPlayerId === playerId);
    const currentDisplayName = currentPlayer?.name ?? account?.displayName ?? playerName;
    const winnerName = room?.game.winner
        ? room.players.find((player) => player.id === room.game.winner)?.name ?? room.game.winner
        : null;
    const pausedByName = room?.game.pausedBy
        ? room.players.find((player) => player.id === room.game.pausedBy)?.name ?? room.game.pausedBy
        : null;
    const pausesUsed = playerId && room?.game.pauseCounts ? room.game.pauseCounts[playerId] ?? 0 : 0;
    const pausesRemaining = room ? Math.max(0, room.pausesPerPlayer - pausesUsed) : 0;

    useEffect(() => {
        refreshAccount();
    }, []);

    useEffect(() => {
        writeCookie(PLAYER_NAME_COOKIE, playerName);
    }, [playerName]);

    useEffect(() => {
        if (account) {
            setPlayerName(account.displayName);
            writeCookie(PLAYER_NAME_COOKIE, account.displayName);
        }
    }, [account]);

    useEffect(() => {
        if (room) {
            setDraftWager(String(room.wager));
            setDraftWinningScore(String(room.winningScore));
            setDraftPongBallSpeed(String(room.pongBallSpeed));
            setDraftPoolTableSpeed(String(room.poolTableSpeed));
            setDraftPoolMaxShotPower(String(room.poolMaxShotPower));
            setDraftMaxPauseSeconds(String(room.maxPauseSeconds));
            setDraftPausesPerPlayer(String(room.pausesPerPlayer));
        }
    }, [room?.wager, room?.winningScore, room?.pongBallSpeed, room?.poolTableSpeed, room?.poolMaxShotPower, room?.maxPauseSeconds, room?.pausesPerPlayer]);

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
                if (message.account) {
                    setAccount(message.account);
                }
            }

            if (message.type === "state") {
                setRoom(message.room);
            }

            if (message.type === "account") {
                setAccount(message.account);
            }

            if (message.type === "payout") {
                setNotice(message.message);
                refreshAccount();
            }

            if (message.type === "game_over") {
                setNotice(message.message);
            }

            if (message.type === "paused") {
                setNotice(message.message);
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

    async function refreshAccount() {
        const response = await fetch(`${API_BASE}/auth/me`, {
            credentials: "include",
        });
        const data = await response.json();
        setAccount(data.account ?? null);
    }

    async function submitAuth() {
        setAuthMessage(null);

        const response = await fetch(`${API_BASE}/auth/${authMode}`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                username: authUsername,
                password: authPassword,
                displayName: authDisplayName || authUsername,
            }),
        });

        const data = await response.json();

        if (!response.ok) {
            setAuthMessage(data.detail ?? "Unable to sign in.");
            return;
        }

        setAccount(data.account);
        setPlayerName(data.account.displayName);
        writeCookie(PLAYER_NAME_COOKIE, data.account.displayName);
        setAuthPassword("");
        setAuthMessage("Signed in. Rejoining lobby with your account...");
        window.setTimeout(() => window.location.reload(), 350);
    }

    async function logout() {
        await fetch(`${API_BASE}/auth/logout`, {
            method: "POST",
            credentials: "include",
        });
        setAccount(null);
        setNotice("Logged out. Rejoining lobby as a guest...");
        window.setTimeout(() => window.location.reload(), 350);
    }

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

    function saveGameSettings() {
        const winningScore = Math.max(1, Math.min(50, Math.floor(Number(draftWinningScore) || 5)));
        const pongBallSpeed = Math.max(3, Math.min(14, Number(draftPongBallSpeed) || 5));
        const poolTableSpeed = Math.max(0.92, Math.min(0.995, Number(draftPoolTableSpeed) || 0.985));
        const poolMaxShotPower = Math.max(8, Math.min(32, Number(draftPoolMaxShotPower) || 22));
        const maxPauseSeconds = Math.max(5, Math.min(300, Math.floor(Number(draftMaxPauseSeconds) || 30)));
        const pausesPerPlayer = Math.max(0, Math.min(20, Math.floor(Number(draftPausesPerPlayer) || 0)));

        socketRef.current?.send(
            JSON.stringify({
                type: "set_game_settings",
                winningScore,
                pongBallSpeed,
                poolTableSpeed,
                poolMaxShotPower,
                maxPauseSeconds,
                pausesPerPlayer,
            })
        );
        setNotice(`Game settings saved. Pong first to ${winningScore}, Pong speed ${pongBallSpeed}, pool power ${poolMaxShotPower}, ${pausesPerPlayer} pause(s) each.`);
    }

    function saveWager() {
        const nextWager = Math.max(0, Math.floor(Number(draftWager) || 0));
        socketRef.current?.send(
            JSON.stringify({
                type: "set_wager",
                wager: nextWager,
            })
        );
        setNotice(nextWager > 0 ? `Wager set to $${nextWager}.` : "Wager disabled.");
    }

    function pauseGame() {
        socketRef.current?.send(
            JSON.stringify({
                type: "pause",
            })
        );
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
        setNotice(account ? "Name saved to your account." : "Name saved on this browser.");
    }

    async function copyInviteLink() {
        await navigator.clipboard.writeText(shareUrl);
        setNotice("Invite link copied.");
    }

    function canvasPoint(event: PointerEvent<HTMLCanvasElement>) {
        const canvas = canvasRef.current;
        if (!canvas) {
            return null;
        }

        const rect = canvas.getBoundingClientRect();
        return {
            x: (event.clientX - rect.left) * (canvas.width / rect.width),
            y: (event.clientY - rect.top) * (canvas.height / rect.height),
        };
    }

    function handleCanvasPointerDown(event: PointerEvent<HTMLCanvasElement>) {
        if (room?.game.kind !== "pool" || !room.game.started || room.game.finished || room.game.paused) {
            return;
        }

        const point = canvasPoint(event);
        const cueBall = room.game.balls?.find((ball) => ball.number === 0 && !ball.pocketed);

        if (!point || !cueBall) {
            return;
        }

        if (Math.hypot(point.x - cueBall.x, point.y - cueBall.y) <= cueBall.radius * 2.5) {
            poolAimStartRef.current = point;
        }
    }

    function handleCanvasPointerUp(event: PointerEvent<HTMLCanvasElement>) {
        if (room?.game.kind !== "pool" || !poolAimStartRef.current) {
            poolAimStartRef.current = null;
            return;
        }

        const point = canvasPoint(event);
        const cueBall = room.game.balls?.find((ball) => ball.number === 0 && !ball.pocketed);

        if (!point || !cueBall) {
            poolAimStartRef.current = null;
            return;
        }

        const dx = cueBall.x - point.x;
        const dy = cueBall.y - point.y;
        const dragDistance = Math.hypot(dx, dy);
        const maxShotPower = room.game.maxShotPower ?? room.poolMaxShotPower;
        const power = Math.max(0.5, Math.min(maxShotPower, dragDistance / 7));

        socketRef.current?.send(
            JSON.stringify({
                type: "pool_shot",
                dx,
                dy,
                power,
            })
        );

        poolAimStartRef.current = null;
    }

    function drawGame(game: GameState) {
        if (game.kind === "pool") {
            drawPool(game);
        } else {
            drawPong(game);
        }
    }

    function drawPong(game: GameState) {
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

        for (let y = 0; y < game.height; y += 30) {
            ctx.fillRect(game.width / 2 - 2, y, 4, 15);
        }

        const p1 = game.paddles?.player1;
        const p2 = game.paddles?.player2;

        if (p1 && p2) {
            ctx.fillRect(p1.x, p1.y, p1.width, p1.height);
            ctx.fillRect(p2.x, p2.y, p2.width, p2.height);
        }

        if (game.ball) {
            ctx.fillRect(game.ball.x, game.ball.y, game.ball.size, game.ball.size);
        }

        ctx.font = "32px Arial";
        ctx.fillText(String(game.score?.player1 ?? 0), game.width / 2 - 70, 50);
        ctx.fillText(String(game.score?.player2 ?? 0), game.width / 2 + 50, 50);

        drawStatusOverlay(ctx, game);
    }

    function drawPool(game: GameState) {
        const canvas = canvasRef.current;

        if (!canvas) {
            return;
        }

        const ctx = canvas.getContext("2d");

        if (!ctx) {
            return;
        }

        ctx.clearRect(0, 0, game.width, game.height);
        ctx.fillStyle = "#6b3f24";
        ctx.fillRect(0, 0, game.width, game.height);
        ctx.fillStyle = "#0f7a4f";
        ctx.fillRect(game.rail ?? 38, game.rail ?? 38, game.width - (game.rail ?? 38) * 2, game.height - (game.rail ?? 38) * 2);

        ctx.fillStyle = "#020617";
        for (const pocket of game.pockets ?? []) {
            ctx.beginPath();
            ctx.arc(pocket.x, pocket.y, pocket.radius, 0, Math.PI * 2);
            ctx.fill();
        }

        for (const ball of game.balls ?? []) {
            if (ball.pocketed) {
                continue;
            }

            ctx.beginPath();
            ctx.fillStyle = poolBallColor(ball);
            ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = "rgba(255,255,255,0.85)";
            ctx.lineWidth = 2;
            ctx.stroke();

            if (ball.number > 0) {
                ctx.fillStyle = "white";
                ctx.beginPath();
                ctx.arc(ball.x, ball.y, ball.radius * 0.52, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = "#111827";
                ctx.font = "10px Arial";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(String(ball.number), ball.x, ball.y + 0.5);
                ctx.textAlign = "start";
                ctx.textBaseline = "alphabetic";
            }
        }

        const cueBall = game.balls?.find((ball) => ball.number === 0 && !ball.pocketed);
        if (cueBall && playerId === game.currentTurn && game.started && !game.finished && !game.paused && !game.shotInMotion) {
            ctx.strokeStyle = "rgba(255,255,255,0.35)";
            ctx.setLineDash([6, 8]);
            ctx.beginPath();
            ctx.moveTo(cueBall.x, cueBall.y);
            ctx.lineTo(cueBall.x + 85, cueBall.y);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.font = "18px Arial";
        ctx.fillText(game.message ?? "8-ball pool", 52, 28);

        drawStatusOverlay(ctx, game);
    }

    function poolBallColor(ball: PoolBall) {
        if (ball.number === 0) return "#f8fafc";
        if (ball.number === 8) return "#020617";
        if (ball.kind === "solid") return "#facc15";
        return "#2563eb";
    }

    function drawStatusOverlay(ctx: CanvasRenderingContext2D, game: GameState) {
        if (game.paused) {
            ctx.fillStyle = "rgba(2, 6, 23, 0.72)";
            ctx.fillRect(0, 0, game.width, game.height);
            ctx.fillStyle = "white";
            ctx.font = "42px Arial";
            ctx.textAlign = "center";
            ctx.fillText("Paused", game.width / 2, game.height / 2 - 16);
            ctx.font = "24px Arial";
            ctx.fillText(`${game.pauseSecondsRemaining}s remaining`, game.width / 2, game.height / 2 + 28);
            ctx.textAlign = "start";
        }

        if (game.finished) {
            ctx.fillStyle = "rgba(2, 6, 23, 0.72)";
            ctx.fillRect(0, 0, game.width, game.height);
            ctx.fillStyle = "white";
            ctx.font = "42px Arial";
            ctx.textAlign = "center";
            ctx.fillText("Game Over", game.width / 2, game.height / 2 - 16);
            ctx.font = "24px Arial";
            ctx.fillText("Start again when everyone is ready", game.width / 2, game.height / 2 + 28);
            ctx.textAlign = "start";
        }
    }


    return (
        <main className="room-page">
            <section className="room-header">
                <div>
                    <h1>Lobby {roomCode}</h1>
                    <p>
                        You are: {currentDisplayName} {isHost ? "(host)" : ""}
                    </p>
                    <p>Players: {room?.players.length ?? 0}</p>
                    <p>Game: {room?.supportedGames[room.gameName] ?? room?.gameName ?? "Loading..."}</p>
                    <p>Wager: ${room?.wager ?? 0} · {room?.gameName === "pool" ? `Pool power ${room.poolMaxShotPower}` : `First to ${room?.winningScore ?? 5} · Ball speed ${room?.pongBallSpeed ?? 5}`}</p>
                    <p>Pauses: {pausesRemaining}/{room?.pausesPerPlayer ?? 2} left · Max {room?.maxPauseSeconds ?? 30}s</p>
                    {room?.game.paused && <p className="pause-banner">Paused by {pausedByName}. Resumes in {room.game.pauseSecondsRemaining}s.</p>}
                    {account ? (
                        <p>Account: @{account.username} · Balance: ${account.balance}</p>
                    ) : (
                        <p>Guest mode · Log in to keep money and play wagers.</p>
                    )}
                    {notice && <p className="notice">{notice}</p>}
                </div>

                <div className="room-actions">
                    <button onClick={copyInviteLink}>Copy Invite Link</button>
                    {account ? (
                        <button className="secondary" onClick={logout}>Log Out</button>
                    ) : (
                        <button className="secondary" onClick={() => setIsAuthOpen(true)}>Log In</button>
                    )}
                    <button
                        className="secondary"
                        onClick={() => {
                            setDraftPlayerName(currentDisplayName);
                            setIsNameOpen(true);
                        }}
                    >
                        Change Name
                    </button>
                    <button
                        className="secondary"
                        onClick={pauseGame}
                        disabled={!room?.game.started || room?.game.finished || room?.game.paused || pausesRemaining <= 0}
                    >
                        Pause Game
                    </button>
                    {isHost && (
                        <button className="secondary" onClick={() => setIsManageOpen(true)}>
                            Manage Lobby
                        </button>
                    )}
                    {isHost && <button onClick={startGame} disabled={room?.game.started}>
                        {room?.game.finished ? "Start New Game" : room?.game.started ? "Game Running" : "Start Game"}
                    </button>}
                </div>
            </section>

            <section className="game-wrapper">
                <canvas
                    ref={canvasRef}
                    width={800}
                    height={500}
                    className="game-canvas"
                    onPointerDown={handleCanvasPointerDown}
                    onPointerUp={handleCanvasPointerUp}
                />
            </section>

            {room?.game.kind !== "pool" && (
                <section className="mobile-controls">
                    <button onPointerDown={() => sendPaddleDirection("up")} onPointerUp={() => sendPaddleDirection("none")}>
                        Up
                    </button>

                    <button onPointerDown={() => sendPaddleDirection("down")} onPointerUp={() => sendPaddleDirection("none")}>
                        Down
                    </button>
                </section>
            )}

            <p className="instructions">
                {room?.game.kind === "pool"
                    ? "8-ball: click/drag from the cue ball opposite the direction you want to shoot, then release."
                    : "Desktop: use W/S or Arrow Up/Down. Phone: use the Up/Down buttons."}
                {winnerName && room?.game.finished ? ` ${winnerName} won!` : ""}
                {room?.game.paused ? ` Paused by ${pausedByName}; resumes automatically.` : ""}
            </p>

            {isAuthOpen && (
                <div className="modal-backdrop" onClick={() => setIsAuthOpen(false)}>
                    <section className="modal-card compact-modal" onClick={(event) => event.stopPropagation()}>
                        <div className="modal-header">
                            <div>
                                <p className="eyebrow">Account</p>
                                <h2>{authMode === "login" ? "Log in" : "Create account"}</h2>
                            </div>
                            <button className="icon-button" onClick={() => setIsAuthOpen(false)} aria-label="Close login">
                                ×
                            </button>
                        </div>

                        <div className="auth-panel inline-auth-panel">
                            <div className="segmented-buttons">
                                <button className={authMode === "login" ? "selected" : "secondary"} onClick={() => setAuthMode("login")}>Log in</button>
                                <button className={authMode === "register" ? "selected" : "secondary"} onClick={() => setAuthMode("register")}>Register</button>
                            </div>
                            <input value={authUsername} onChange={(event) => setAuthUsername(event.target.value)} placeholder="Username" />
                            {authMode === "register" && (
                                <input value={authDisplayName} onChange={(event) => setAuthDisplayName(event.target.value)} placeholder="Display name" />
                            )}
                            <input value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} placeholder="Password" type="password" />
                            <button onClick={submitAuth}>{authMode === "login" ? "Log In" : "Create Account"}</button>
                            {authMessage && <p className="notice">{authMessage}</p>}
                        </div>
                    </section>
                </div>
            )}

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
                            <h3>Wager</h3>
                            <p className="helper-text">Set to 0 for a casual game. Wagered games require both player1 and player2 to be logged in and funded.</p>
                            <div className="wager-row">
                                <input
                                    value={draftWager}
                                    min={0}
                                    type="number"
                                    onChange={(event) => setDraftWager(event.target.value)}
                                    placeholder="0"
                                />
                                <button onClick={saveWager}>Save Wager</button>
                            </div>
                        </div>

                        <div className="manager-section">
                            <h3>Game Settings</h3>
                            <p className="helper-text">These can be changed before the host starts the game. Pong supports first-to score and ball speed. 8-ball supports table speed and max shot power. Both games use the pause rules.</p>
                            <div className="settings-grid">
                                <label className="field-label">
                                    First to
                                    <input
                                        value={draftWinningScore}
                                        min={1}
                                        max={50}
                                        type="number"
                                        onChange={(event) => setDraftWinningScore(event.target.value)}
                                    />
                                </label>

                                <label className="field-label">
                                    Pong ball speed
                                    <input
                                        value={draftPongBallSpeed}
                                        min={3}
                                        max={14}
                                        step={0.5}
                                        type="number"
                                        onChange={(event) => setDraftPongBallSpeed(event.target.value)}
                                    />
                                </label>


                                <label className="field-label">
                                    Pool table speed
                                    <input
                                        value={draftPoolTableSpeed}
                                        min={0.92}
                                        max={0.995}
                                        step={0.005}
                                        type="number"
                                        onChange={(event) => setDraftPoolTableSpeed(event.target.value)}
                                    />
                                </label>

                                <label className="field-label">
                                    Pool max shot power
                                    <input
                                        value={draftPoolMaxShotPower}
                                        min={8}
                                        max={32}
                                        step={1}
                                        type="number"
                                        onChange={(event) => setDraftPoolMaxShotPower(event.target.value)}
                                    />
                                </label>

                                <label className="field-label">
                                    Max pause seconds
                                    <input
                                        value={draftMaxPauseSeconds}
                                        min={5}
                                        max={300}
                                        type="number"
                                        onChange={(event) => setDraftMaxPauseSeconds(event.target.value)}
                                    />
                                </label>

                                <label className="field-label">
                                    Pauses per player
                                    <input
                                        value={draftPausesPerPlayer}
                                        min={0}
                                        max={20}
                                        type="number"
                                        onChange={(event) => setDraftPausesPerPlayer(event.target.value)}
                                    />
                                </label>

                                <button onClick={saveGameSettings} disabled={room.game.started}>Save Settings</button>
                            </div>
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
                                            disabled={selected || room.game.started}
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
                                            <small>
                                                {connectedPlayer.isHost ? "Host" : connectedPlayer.id}
                                                {connectedPlayer.isLoggedIn ? ` · $${connectedPlayer.balance ?? 0}` : " · Guest"}
                                            </small>
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
