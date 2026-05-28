GamblePigeon AI Project Context
Project identity

GamblePigeon is a small real-time multiplayer web app for browser-based wager games. The current app is a FastAPI backend plus a React/TypeScript/Vite frontend. The repository currently has top-level backend, frontend, and docker-compose.yml entries, with GitHub showing Python, TypeScript, and CSS as the main languages.

The app is intended to feel like a casual “GamePigeon but gambling” multiplayer platform: users can register/login, join rooms, play games, wager account balance, and have the winner receive the loser’s wager.

Stack

Backend:

Python FastAPI.
WebSockets for room/game state.
SQLite local database for accounts/sessions/balances.
Main backend files are under backend/app: main.py, auth.py, rooms.py, and pong.py.

Frontend:

React 19, TypeScript, Vite.
Routing uses react-router-dom.
Main frontend source is under frontend/src, with App.tsx, pages/HomePage.tsx, and pages/RoomPage.tsx.
App.tsx routes / to HomePage and /room/:roomCode to RoomPage.

Local dev:

docker-compose.yml runs backend on port 8000 and frontend on port 5173.
Backend command: uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload.
Frontend command: npm run dev -- --host 0.0.0.0.
Core mental model

There are three main domains:

Accounts/auth/balance
Managed mostly in backend/app/auth.py.
Accounts have id, username, display_name, and balance.
Default starting balance is 1000.
Passwords use PBKDF2-SHA256 with salts.
Sessions are stored in SQLite and linked to an HTTP-only cookie named gamblepigeon_session.
Rooms/lobbies
Managed mostly in backend/app/rooms.py and WebSocket logic in main.py.
A room has a room code, host token, selected game, player sockets, player names, player account IDs, wager, game settings, and game instance.
The host is tracked by host_player_id.
Room state is in memory, so rooms reset when the backend restarts.
Current supported game list in the public repo only contains "pong": "Pong".
Games
Pong is implemented in backend/app/pong.py.
Room.game currently holds a PongGame instance.
The WebSocket protocol assumes room.game supports methods like start(), tick(), set_paddle_direction(), request_pause(), to_dict(), and fields like started, finished, and winner.
PongGame.to_dict() returns dimensions, started/finished/winner, winning score, ball speed, pause state, paddles, ball, and score.
Backend API and WebSocket behavior

Important HTTP endpoints in backend/app/main.py:

GET /auth/me: returns current session account.
POST /auth/register: creates account and sets session cookie.
POST /auth/login: authenticates and sets session cookie.
POST /auth/logout: deletes session and clears cookie.
PATCH /auth/me/name: updates display name.
POST /rooms: creates a room and returns roomCode, hostToken, and room URL.
GET /rooms/{room_code}: checks room existence and returns room metadata, including selected game, supported games, wager, winning score, pong ball speed, max pause seconds, and pauses per player.

Important WebSocket route:

/ws/rooms/{room_code}

Important incoming WebSocket message types:

paddle: update paddle direction.
start: host starts game after wager validation.
set_name: update room/player name and logged-in account display name.
set_wager: host changes wager before game start.
set_game_settings: host changes game settings before start.
set_game: host changes selected game before start.
kick_player: host removes another player.
pause: player requests pause.
tick: host/client drives game tick updates.

Wager flow:

Before starting, validate_wager_can_start(room) ensures wagered games have two active players, both players are logged in, the accounts are different, and both can afford the wager.
When a game finishes, maybe_finish_game(room_code) determines winner/loser and calls transfer_balance(winner_account_id, loser_account_id, room.wager).
transfer_balance() adds wager amount to winner and subtracts it from loser in SQLite.
Recent user goals and expected behavior

The user is actively trying to evolve this into a multi-game platform. Recent desired features include:

Any user should be able to pause.
Pause settings should be configurable:
max pause seconds,
pauses per player.
The game can be unpaused by either:
the player who paused it,
or the moderator/host.
Remove the broadcast text: ___ paused the game for up to 30 seconds. after/unless it is still intentionally desired.
Add another game: 8-ball pool.
Game settings should be shown and prompted per selected game, not all settings globally at once.
Users should be able to switch games from the lobby.
Admin user:
username is admin,
display/name is torin,
should be able to manage all user accounts.
Admin should be able to modify other users’ name, password, balance, etc.
Admin management button/portal must be visible only to the admin, not all users.
The UI currently may show “Log in as username admin to manage user accounts” even when the admin is logged in; this is a bug.
The admin portal should be easy to find after logging in as admin.
Known repo-state mismatch / likely current bugs

The public repo state may lag behind the latest desired behavior. In the public repo, SUPPORTED_GAMES only contains Pong, so if the UI has a game selector but only Pong exists backend-side, switching to 8-ball will fail or appear to do nothing.

The backend has a set_game WebSocket message handler that calls room.set_game(...), but Room.set_game() only accepts games present in SUPPORTED_GAMES. To add 8-ball properly, update backend game registration and room game factory, not just the frontend dropdown.

Current settings are room-level and Pong-specific fields are exposed directly:

winningScore
pongBallSpeed
maxPauseSeconds
pausesPerPlayer

This design needs refactoring for per-game settings because 8-ball pool will not use Pong’s paddle/ball-speed/winning-score model.

Recommended architecture direction
1. Introduce a game interface/protocol

Create a shared backend contract for games. Example conceptual shape:

class GameProtocol(Protocol):
game_type: str
started: bool
finished: bool
winner: Optional[str]

    def start(self) -> None: ...
    def tick(self) -> None: ...
    def to_dict(self) -> dict: ...
    def apply_input(self, player_id: str, message: dict) -> None: ...
    def update_settings(self, settings: dict) -> None: ...
    def request_pause(self, player_id: str) -> None: ...
    def resume_pause(self, player_id: str, is_moderator: bool = False) -> None: ...

Then main.py should stop assuming every game is Pong. For Pong, apply_input() can handle paddle messages. For pool, apply_input() can handle cue aim, power, shot, ball placement, etc.

2. Replace hardcoded SUPPORTED_GAMES with a registry

Instead of:

SUPPORTED_GAMES = {
"pong": "Pong"
}

Use a registry like:

GAME_REGISTRY = {
"pong": {
"label": "Pong",
"factory": PongGame,
"settings_schema": {...},
},
"eight_ball": {
"label": "8 Ball Pool",
"factory": EightBallGame,
"settings_schema": {...},
},
}

The frontend can render settings based on settings_schema, which solves the problem of “game settings should be prompted per game.”

3. Move game-specific WebSocket handling out of main.py

Right now main.py has message types like paddle, tick, set_game_settings, and pause. That is okay for Pong, but it will get messy as games grow. Better pattern:

Keep lobby/admin/account messages in main.py.
Route game messages to room.game.apply_input(player_id, message).
Use generic message type like:
{
"type": "game_input",
"action": "paddle",
"payload": { "direction": "up" }
}

For pool:

{
"type": "game_input",
"action": "shoot",
"payload": { "angle": 32, "power": 0.72 }
}
4. Make pause behavior generic

Pause should live in a reusable base/mixin or shared helper because it applies to all games. Store:

paused
paused_by
pause_started_at
pause_ends_at
pause_counts
max_pause_seconds
pauses_per_player

Add a resume_pause(player_id, is_moderator) rule:

allowed when player_id == paused_by
or is_moderator == True
otherwise reject.

Also remove the noisy pause broadcast if the user does not want it. It currently broadcasts the exact “paused the game for up to...” style message in the pause branch.

Admin model recommendation

Treat admin as a role, not as display name. Short-term simple rule:

def is_admin(account):
return bool(account and account.username.lower() == "admin")

Long-term better rule:

Add role TEXT NOT NULL DEFAULT 'user' to accounts.
Serialize isAdmin to frontend.
Protect admin endpoints server-side.
Hide admin UI unless account?.isAdmin === true.

Suggested admin endpoints:

GET /admin/accounts
PATCH /admin/accounts/{account_id}
DELETE /admin/accounts/{account_id}
POST /admin/accounts/{account_id}/password

Never rely on frontend hiding alone. The backend must reject non-admin requests.

8-ball pool implementation guidance

Start simple. Do not overbuild perfect physics on the first pass.

Minimum viable 8-ball:

Game state:
table dimensions,
balls with id, x, y, vx, vy, pocketed,
cue ball,
current turn,
player assignments,
solids/stripes assignment,
winner,
foul state.
Inputs:
aim angle,
shot power,
shoot.
Tick:
move balls,
apply friction,
wall collisions,
ball-ball collisions,
pocket detection,
turn resolution when balls stop.
First version can simplify:
no spin,
no exact pool rules,
basic solids/stripes after first legal pocket,
basic 8-ball win/loss.

Frontend:

Render table with SVG or canvas.
Use WebSocket state snapshots from backend.
Let current player aim and shoot.
Spectators can watch but not shoot.
Development conventions for future AI agents

When changing this project:

Do backend and frontend together for protocol changes.
Any new WebSocket message or state field must be reflected in both main.py/game classes and RoomPage.tsx.
Keep lobby behavior separate from game behavior.
Lobby: room creation, joining, host/moderation, wager, selected game, settings.
Game: inputs, physics, scoring, winner.
Preserve wager safety.
Validate before start.
Pay out only once.
Never allow same account to wager against itself.
Never allow balance to go negative.
Do not trust frontend for admin or money changes.
Admin checks and balance updates must happen backend-side.
Avoid adding more Pong-specific fields to generic room state.
Prefer gameSettings and gameState.
Be careful with in-memory rooms.
Restarting backend loses active rooms.
SQLite only stores account/session/balance, not active rooms.
Keep local dev assumptions:
Backend: localhost:8000.
Frontend: localhost:5173.
CORS currently allows those frontend origins.
Suggested next refactor order
Add isAdmin serialization and admin account endpoints.
Add frontend admin portal visible only when logged-in account username is admin.
Refactor SUPPORTED_GAMES into a backend game registry.
Refactor settings into per-game settings schema.
Fix game switching end-to-end.
Generalize pause/resume.
Add EightBallGame backend state and frontend renderer.
Add tests or at least manual verification scripts for:
create room,
join two players,
change game,
change per-game settings,
start wagered game,
payout,
admin edit account.
What the AI should know about current user preference

Use Patches to suggest specific file and function changes. 
The user values direct, practical implementation help. They are actively debugging and iterating, so avoid vague architectural advice without concrete file/function changes. When a bug is reported, inspect both backend protocol and frontend UI assumptions. The biggest current pain points are:

game switching not actually working,
admin portal not visible/working for username admin,
admin-only controls being shown to everyone,
per-game settings not separated,
pause/resume behavior needs cleanup.