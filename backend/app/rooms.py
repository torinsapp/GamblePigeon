import random
import string
from dataclasses import dataclass, field
from typing import Dict, Optional

from fastapi import WebSocket

from app.pong import PongGame


@dataclass
class Room:
    code: str
    game_name: str = "pong"
    players: Dict[str, WebSocket] = field(default_factory=dict)
    game: PongGame = field(default_factory=PongGame)


rooms: Dict[str, Room] = {}


def generate_room_code(length: int = 6) -> str:
    alphabet = string.ascii_uppercase + string.digits

    while True:
        code = "".join(random.choice(alphabet) for _ in range(length))
        if code not in rooms:
            return code


def create_room() -> Room:
    code = generate_room_code()
    room = Room(code=code)
    rooms[code] = room
    return room


def get_room(room_code: str) -> Optional[Room]:
    return rooms.get(room_code.upper())


def join_room(room_code: str, websocket: WebSocket) -> str:
    room = rooms[room_code.upper()]

    if "player1" not in room.players:
        player_id = "player1"
    elif "player2" not in room.players:
        player_id = "player2"
    else:
        player_id = f"spectator{len(room.players) + 1}"

    room.players[player_id] = websocket
    return player_id


def remove_player(room_code: str, player_id: str):
    room = rooms.get(room_code.upper())
    if not room:
        return

    room.players.pop(player_id, None)

    # Do not delete the room immediately.
    # React dev mode / StrictMode can briefly disconnect and reconnect WebSockets.