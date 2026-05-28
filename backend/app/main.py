from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from app.rooms import create_room, get_room, join_room, remove_player
from app.pong import PongGame

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # fine for local dev
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/rooms")
def create_lobby():
    room = create_room()
    return {
        "roomCode": room.code,
        "url": f"/room/{room.code}"
    }


@app.get("/rooms/{room_code}")
def read_room(room_code: str):
    room = get_room(room_code)
    if not room:
        return {"exists": False}

    return {
        "exists": True,
        "roomCode": room.code,
        "players": len(room.players),
        "game": room.game_name
    }


@app.websocket("/ws/rooms/{room_code}")
async def websocket_room(websocket: WebSocket, room_code: str):
    await websocket.accept()

    room = get_room(room_code)
    if not room:
        await websocket.send_json({"type": "error", "message": "Room not found"})
        await websocket.close()
        return

    player_id = join_room(room_code, websocket)

    await websocket.send_json({
        "type": "joined",
        "playerId": player_id,
        "roomCode": room_code
    })

    await broadcast_room_state(room_code)

    try:
        while True:
            message = await websocket.receive_json()

            if message.get("type") == "paddle":
                direction = message.get("direction")
                room.game.set_paddle_direction(player_id, direction)
                await broadcast_room_state(room_code)

            elif message.get("type") == "start":
                room.game.started = True
                await broadcast_room_state(room_code)

            elif message.get("type") == "tick":
                room.game.tick()
                await broadcast_room_state(room_code)

    except WebSocketDisconnect:
        remove_player(room_code, player_id)
        await broadcast_room_state(room_code)


async def broadcast_room_state(room_code: str):
    room = get_room(room_code)
    if not room:
        return

    disconnected = []

    for player_id, socket in room.players.items():
        try:
            await socket.send_json({
                "type": "state",
                "room": {
                    "code": room.code,
                    "players": list(room.players.keys()),
                    "game": room.game.to_dict()
                }
            })
        except Exception:
            disconnected.append(player_id)

    for player_id in disconnected:
        remove_player(room_code, player_id)