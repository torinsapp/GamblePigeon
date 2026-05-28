import { useState } from "react";
import { useNavigate } from "react-router-dom";

const API_BASE = "http://localhost:8000";

export default function HomePage() {
    const navigate = useNavigate();

    const [joinCode, setJoinCode] = useState("");
    const [isCreating, setIsCreating] = useState(false);

    async function createLobby() {
        setIsCreating(true);

        try {
            const response = await fetch(`${API_BASE}/rooms`, {
                method: "POST",
            });

            const data = await response.json();

            navigate(`/room/${data.roomCode}`);
        } finally {
            setIsCreating(false);
        }
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
        <section className="card">
            <h1>Game Night</h1>
    <p className="subtitle">Create a lobby, share the link, and play Pong.</p>

    <button onClick={createLobby} disabled={isCreating}>
        {isCreating ? "Creating..." : "Create Lobby"}
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
    </main>
);
}