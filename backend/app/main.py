from typing import Optional

from fastapi import FastAPI, HTTPException, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.auth import (
    SESSION_COOKIE_NAME,
    SESSION_MAX_AGE_SECONDS,
    authenticate,
    can_afford,
    create_account,
    delete_session,
    get_account,
    get_account_by_session_token,
    init_auth_db,
    serialize_account,
    transfer_balance,
    update_display_name,
)
from app.rooms import SUPPORTED_GAMES, create_room, get_room, join_room, remove_player

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class AuthPayload(BaseModel):
    username: str
    password: str
    displayName: Optional[str] = None


class NamePayload(BaseModel):
    displayName: str


def set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        max_age=SESSION_MAX_AGE_SECONDS,
        httponly=True,
        samesite="lax",
        secure=False,  # keep false for localhost dev; set true when served over HTTPS
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE_NAME, path="/")


def current_account_from_request(request: Request):
    return get_account_by_session_token(request.cookies.get(SESSION_COOKIE_NAME))


@app.on_event("startup")
def startup():
    init_auth_db()


@app.get("/auth/me")
def read_me(request: Request):
    return {"account": serialize_account(current_account_from_request(request))}


@app.post("/auth/register")
def register(payload: AuthPayload, response: Response):
    try:
        account, session_token = create_account(payload.username, payload.password, payload.displayName)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))

    set_session_cookie(response, session_token)
    return {"account": serialize_account(account)}


@app.post("/auth/login")
def login(payload: AuthPayload, response: Response):
    try:
        account, session_token = authenticate(payload.username, payload.password)
    except ValueError as error:
        raise HTTPException(status_code=401, detail=str(error))

    set_session_cookie(response, session_token)
    return {"account": serialize_account(account)}


@app.post("/auth/logout")
def logout(request: Request, response: Response):
    delete_session(request.cookies.get(SESSION_COOKIE_NAME))
    clear_session_cookie(response)
    return {"ok": True}


@app.patch("/auth/me/name")
def update_my_name(payload: NamePayload, request: Request):
    account = current_account_from_request(request)
    if not account:
        raise HTTPException(status_code=401, detail="You must be logged in.")

    updated_account = update_display_name(account.id, payload.displayName)
    return {"account": serialize_account(updated_account)}


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
        "supportedGames": SUPPORTED_GAMES,
        "wager": room.wager,
        "winningScore": room.winning_score,
        "pongBallSpeed": room.pong_ball_speed,
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

    account = get_account_by_session_token(websocket.cookies.get(SESSION_COOKIE_NAME))
    display_name = account.display_name if account else playerName
    player_id = join_room(room_code, websocket, hostToken, display_name, account.id if account else None)

    await websocket.send_json({
        "type": "joined",
        "playerId": player_id,
        "roomCode": room_code,
        "isHost": room.is_host(player_id),
        "account": serialize_account(account),
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

                error_message = validate_wager_can_start(room)
                if error_message:
                    await websocket.send_json({"type": "error", "message": error_message})
                    continue

                room.reset_game()
                room.game.start()
                await broadcast_room_state(room_code)

            elif message_type == "set_name":
                room.set_player_name(player_id, message.get("name"))

                if account:
                    updated_account = update_display_name(account.id, message.get("name", ""))
                    account = updated_account or account
                    room.set_player_name(player_id, account.display_name)
                    await websocket.send_json({"type": "account", "account": serialize_account(account)})

                await broadcast_room_state(room_code)

            elif message_type == "set_wager":
                if not room.is_host(player_id):
                    await websocket.send_json({"type": "error", "message": "Only the lobby host can set the wager."})
                    continue

                try:
                    room.set_wager(int(message.get("wager", 0)))
                except (TypeError, ValueError) as error:
                    await websocket.send_json({"type": "error", "message": str(error)})
                    continue

                await broadcast_room_state(room_code)

            elif message_type == "set_game_settings":
                if not room.is_host(player_id):
                    await websocket.send_json({"type": "error", "message": "Only the lobby host can change game settings."})
                    continue

                try:
                    room.set_game_settings(
                        winning_score=int(message.get("winningScore", room.winning_score)),
                        pong_ball_speed=float(message.get("pongBallSpeed", room.pong_ball_speed)),
                    )
                except (TypeError, ValueError) as error:
                    await websocket.send_json({"type": "error", "message": str(error)})
                    continue

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
                if not room.is_host(player_id):
                    continue

                was_finished = room.game.finished
                room.game.tick()

                if room.game.finished and not was_finished:
                    await maybe_finish_game(room_code)

                await broadcast_room_state(room_code)

    except WebSocketDisconnect:
        remove_player(room_code, player_id)
        await broadcast_room_state(room_code)


def validate_wager_can_start(room) -> Optional[str]:
    if room.wager <= 0:
        return None

    if "player1" not in room.players or "player2" not in room.players:
        return "A wagered game needs two active players."

    player1_account_id = room.player_account_ids.get("player1")
    player2_account_id = room.player_account_ids.get("player2")

    if not player1_account_id or not player2_account_id:
        return "Both players must be logged in before starting a wagered game."

    if player1_account_id == player2_account_id:
        return "Both sides must be different accounts."

    if not can_afford(player1_account_id, room.wager) or not can_afford(player2_account_id, room.wager):
        return "Both players must have enough money for the wager."

    return None


async def maybe_finish_game(room_code: str):
    room = get_room(room_code)
    if not room or room.paid_out:
        return

    winner_player_id = room.game.winner

    if winner_player_id == "player1":
        loser_player_id = "player2"
    elif winner_player_id == "player2":
        loser_player_id = "player1"
    else:
        return

    if room.wager <= 0:
        room.paid_out = True
        await broadcast_message(room_code, {
            "type": "game_over",
            "message": f"{room.player_names.get(winner_player_id, winner_player_id)} won the game.",
            "winnerPlayerId": winner_player_id,
        })
        return

    winner_account_id = room.player_account_ids.get(winner_player_id)
    loser_account_id = room.player_account_ids.get(loser_player_id)

    if not winner_account_id or not loser_account_id:
        return

    try:
        transfer_balance(winner_account_id, loser_account_id, room.wager)
        winner = get_account(winner_account_id)
        loser = get_account(loser_account_id)
        room.paid_out = True

        await broadcast_message(room_code, {
            "type": "payout",
            "message": f"{room.player_names.get(winner_player_id, winner_player_id)} won ${room.wager}.",
            "winner": serialize_account(winner),
            "loser": serialize_account(loser),
        })
    except ValueError as error:
        room.game.started = False
        room.paid_out = True
        await broadcast_message(room_code, {"type": "error", "message": str(error)})


async def broadcast_message(room_code: str, message: dict):
    room = get_room(room_code)
    if not room:
        return

    disconnected = []

    for player_id, socket in room.players.items():
        try:
            await socket.send_json(message)
        except Exception:
            disconnected.append(player_id)

    for player_id in disconnected:
        remove_player(room_code, player_id)


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
                            "isHost": connected_player_id == room.host_player_id,
                            "isLoggedIn": connected_player_id in room.player_account_ids,
                            "balance": serialize_account(get_account(room.player_account_ids.get(connected_player_id))).get("balance")
                            if get_account(room.player_account_ids.get(connected_player_id)) else None,
                        }
                        for connected_player_id in room.players.keys()
                    ],
                    "hostPlayerId": room.host_player_id,
                    "gameName": room.game_name,
                    "supportedGames": SUPPORTED_GAMES,
                    "wager": room.wager,
                    "winningScore": room.winning_score,
                    "pongBallSpeed": room.pong_ball_speed,
                    "game": room.game.to_dict()
                }
            })
        except Exception:
            disconnected.append(player_id)

    for player_id in disconnected:
        remove_player(room_code, player_id)
