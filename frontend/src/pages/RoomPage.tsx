import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";

const WS_BASE = "ws://localhost:8000";

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

type RoomState = {
    code: string;
    players: string[];
    game: GameState;
};

export default function RoomPage() {
    const { roomCode } = useParams();

    const socketRef = useRef<WebSocket | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    const [playerId, setPlayerId] = useState<string | null>(null);
    const [room, setRoom] = useState<RoomState | null>(null);
    const shareUrl = window.location.href;


    useEffect(() => {
        if (!roomCode) {
            return;
        }

        const socket = new WebSocket(`${WS_BASE}/ws/rooms/${roomCode}`);
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
                alert(message.message);
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

    async function copyInviteLink() {
        await navigator.clipboard.writeText(shareUrl);
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
                    <p>You are: {playerId ?? "Connecting..."}</p>
                    <p>Players: {room?.players.length ?? 0}</p>
                </div>

                <div className="room-actions">
                    <button onClick={copyInviteLink}>Copy Invite Link</button>
                    <button className="secondary" onClick={startGame}>
                        Start Pong
                    </button>
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
        </main>
    );
}