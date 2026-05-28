from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from app.rooms import SUPPORTED_GAMES, create_room, get_room, join_room, remove_player

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
        "hostToken": room.host_token,
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
        "game": room.game_name,
        "supportedGames": SUPPORTED_GAMES
    }


@app.websocket("/ws/rooms/{room_code}")
async def websocket_room(
    websocket: WebSocket,
    room_code: str,
    hostToken: Optional[str] = None,
    playerName: Optional[str] = None
):
    await websocket.accept()

    room = get_room(room_code)
    if not room:
        await websocket.send_json({"type": "error", "message": "Room not found"})
        await websocket.close()
        return

    player_id = join_room(room_code, websocket, hostToken, playerName)

    await websocket.send_json({
        "type": "joined",
        "playerId": player_id,
        "roomCode": room_code,
        "isHost": room.is_host(player_id)
    })

    await broadcast_room_state(room_code)

    try:
        while True:
            message = await websocket.receive_json()
            message_type = message.get("type")

            if message_type == "paddle":
                direction = message.get("direction")
                room.game.set_paddle_direction(player_id, direction)
                await broadcast_room_state(room_code)

            elif message_type == "start":
                if not room.is_host(player_id):
                    await websocket.send_json({"type": "error", "message": "Only the lobby host can start the game."})
                    continue

                room.game.started = True
                await broadcast_room_state(room_code)

            elif message_type == "set_name":
                room.set_player_name(player_id, message.get("name"))
                await broadcast_room_state(room_code)

            elif message_type == "set_game":
                if not room.is_host(player_id):
                    await websocket.send_json({"type": "error", "message": "Only the lobby host can change the game."})
                    continue

                try:
                    room.set_game(str(message.get("game", "")))
                except ValueError as error:
                    await websocket.send_json({"type": "error", "message": str(error)})
                    continue

                await broadcast_room_state(room_code)

            elif message_type == "kick_player":
                if not room.is_host(player_id):
                    await websocket.send_json({"type": "error", "message": "Only the lobby host can moderate players."})
                    continue

                target_player_id = str(message.get("playerId", ""))
                if target_player_id == player_id:
                    await websocket.send_json({"type": "error", "message": "The host cannot kick themselves."})
                    continue

                target_socket = room.players.get(target_player_id)
                if target_socket:
                    await target_socket.send_json({"type": "kicked", "message": "You were removed from the lobby by the host."})
                    await target_socket.close()

                remove_player(room_code, target_player_id)
                await broadcast_room_state(room_code)

            elif message_type == "tick":
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
                    "players": [
                        {
                            "id": connected_player_id,
                            "name": room.player_names.get(connected_player_id, connected_player_id),
                            "isHost": connected_player_id == room.host_player_id
                        }
                        for connected_player_id in room.players.keys()
                    ],
                    "hostPlayerId": room.host_player_id,
                    "gameName": room.game_name,
                    "supportedGames": SUPPORTED_GAMES,
                    "game": room.game.to_dict()
                }
            })
        except Exception:
            disconnected.append(player_id)

    for player_id in disconnected:
        remove_player(room_code, player_id)
