import math
import time
from dataclasses import dataclass
from typing import Dict, List, Optional


@dataclass
class PoolBall:
    number: int
    x: float
    y: float
    vx: float = 0
    vy: float = 0
    pocketed: bool = False

    @property
    def kind(self) -> str:
        if self.number == 0:
            return "cue"
        if self.number == 8:
            return "eight"
        if 1 <= self.number <= 7:
            return "solid"
        return "stripe"


class PoolGame:
    MIN_PAUSE_SECONDS = 5
    MAX_PAUSE_SECONDS = 300
    MIN_PAUSES_PER_PLAYER = 0
    MAX_PAUSES_PER_PLAYER = 20
    MIN_TABLE_SPEED = 0.92
    MAX_TABLE_SPEED = 0.995
    MIN_MAX_SHOT_POWER = 8
    MAX_MAX_SHOT_POWER = 32

    def __init__(
            self,
            max_pause_seconds: int = 30,
            pauses_per_player: int = 2,
            table_speed: float = 0.985,
            max_shot_power: float = 22,
    ):
        self.width = 800
        self.height = 500
        self.rail = 38
        self.ball_radius = 10
        self.pocket_radius = 24
        self.friction = self.clean_table_speed(table_speed)
        self.max_shot_power = self.clean_max_shot_power(max_shot_power)
        self.max_pause_seconds = self.clean_max_pause_seconds(max_pause_seconds)
        self.pauses_per_player = self.clean_pauses_per_player(pauses_per_player)

        self.started = False
        self.finished = False
        self.winner: Optional[str] = None
        self.paused = False
        self.pause_started_at: Optional[float] = None
        self.pause_ends_at: Optional[float] = None
        self.paused_by: Optional[str] = None
        self.pause_counts: Dict[str, int] = {}

        self.current_turn = "player1"
        self.groups: Dict[str, Optional[str]] = {"player1": None, "player2": None}
        self.message = "Break! Player 1 shoots first."
        self.shot_in_motion = False
        self.shot_player: Optional[str] = None
        self.pocketed_this_shot: List[int] = []
        self.scratch_this_shot = False
        self.balls: List[PoolBall] = []
        self.reset_balls()

    @classmethod
    def clean_max_pause_seconds(cls, max_pause_seconds: int) -> int:
        return max(cls.MIN_PAUSE_SECONDS, min(cls.MAX_PAUSE_SECONDS, int(max_pause_seconds)))

    @classmethod
    def clean_pauses_per_player(cls, pauses_per_player: int) -> int:
        return max(cls.MIN_PAUSES_PER_PLAYER, min(cls.MAX_PAUSES_PER_PLAYER, int(pauses_per_player)))

    @classmethod
    def clean_table_speed(cls, table_speed: float) -> float:
        return max(cls.MIN_TABLE_SPEED, min(cls.MAX_TABLE_SPEED, float(table_speed)))

    @classmethod
    def clean_max_shot_power(cls, max_shot_power: float) -> float:
        return max(cls.MIN_MAX_SHOT_POWER, min(cls.MAX_MAX_SHOT_POWER, float(max_shot_power)))

    def reset_balls(self):
        self.balls = [PoolBall(0, 210, self.height / 2)]

        start_x = 560
        start_y = self.height / 2
        spacing = self.ball_radius * 2.08
        rack_rows = [
            [1],
            [9, 2],
            [3, 8, 10],
            [11, 4, 12, 5],
            [6, 13, 7, 14, 15],
        ]

        for row_index, row in enumerate(rack_rows):
            x = start_x + row_index * spacing
            y = start_y - (len(row) - 1) * spacing / 2
            for col_index, number in enumerate(row):
                self.balls.append(PoolBall(number, x, y + col_index * spacing))

    def start(self):
        self.started = True
        self.finished = False
        self.winner = None
        self.paused = False
        self.pause_started_at = None
        self.pause_ends_at = None
        self.paused_by = None
        self.pause_counts = {}
        self.current_turn = "player1"
        self.groups = {"player1": None, "player2": None}
        self.message = "Break! Player 1 shoots first."
        self.shot_in_motion = False
        self.shot_player = None
        self.pocketed_this_shot = []
        self.scratch_this_shot = False
        self.reset_balls()

    def request_pause(self, player_id: str):
        if not self.started or self.finished:
            raise ValueError("The game is not running.")
        if self.paused:
            raise ValueError("The game is already paused.")
        if self.pauses_per_player <= 0:
            raise ValueError("Pauses are disabled for this game.")

        used_pauses = self.pause_counts.get(player_id, 0)
        if used_pauses >= self.pauses_per_player:
            raise ValueError("You have no pauses left this game.")

        now = time.monotonic()
        self.pause_counts[player_id] = used_pauses + 1
        self.paused = True
        self.pause_started_at = now
        self.pause_ends_at = now + self.max_pause_seconds
        self.paused_by = player_id

    def resume(self):
        self.paused = False
        self.pause_started_at = None
        self.pause_ends_at = None
        self.paused_by = None

    def pause_seconds_remaining(self) -> int:
        if not self.paused or self.pause_ends_at is None:
            return 0
        return max(0, int(round(self.pause_ends_at - time.monotonic())))

    def all_balls_stopped(self) -> bool:
        return all(ball.pocketed or math.hypot(ball.vx, ball.vy) < 0.08 for ball in self.balls)

    def can_shoot(self, player_id: str) -> bool:
        return (
            self.started
            and not self.finished
            and not self.paused
            and player_id == self.current_turn
            and self.all_balls_stopped()
            and not self.shot_in_motion
        )

    def shoot(self, player_id: str, dx: float, dy: float, power: float):
        if not self.can_shoot(player_id):
            raise ValueError("It is not your turn or the table is still moving.")

        cue_ball = self.cue_ball()
        if not cue_ball:
            self.replace_cue_ball()
            cue_ball = self.cue_ball()

        magnitude = math.hypot(dx, dy)
        if magnitude <= 0:
            raise ValueError("Drag away from the cue ball to shoot.")

        clamped_power = max(0.5, min(self.max_shot_power, float(power)))
        cue_ball.vx = dx / magnitude * clamped_power
        cue_ball.vy = dy / magnitude * clamped_power
        self.shot_in_motion = True
        self.shot_player = player_id
        self.pocketed_this_shot = []
        self.scratch_this_shot = False
        self.message = f"{self.player_label(player_id)} shot."

    def cue_ball(self) -> Optional[PoolBall]:
        return next((ball for ball in self.balls if ball.number == 0 and not ball.pocketed), None)

    def replace_cue_ball(self):
        cue_ball = next(ball for ball in self.balls if ball.number == 0)
        cue_ball.x = 210
        cue_ball.y = self.height / 2
        cue_ball.vx = 0
        cue_ball.vy = 0
        cue_ball.pocketed = False

    def tick(self):
        if not self.started or self.finished:
            return

        if self.paused:
            if self.pause_seconds_remaining() <= 0:
                self.resume()
            return

        self.move_balls()
        self.resolve_collisions()
        self.check_pockets()

        if self.shot_in_motion and self.all_balls_stopped():
            self.stop_all_balls()
            self.resolve_shot()

    def move_balls(self):
        for ball in self.balls:
            if ball.pocketed:
                continue

            ball.x += ball.vx
            ball.y += ball.vy
            ball.vx *= self.friction
            ball.vy *= self.friction

            if math.hypot(ball.vx, ball.vy) < 0.08:
                ball.vx = 0
                ball.vy = 0

            left = self.rail + self.ball_radius
            right = self.width - self.rail - self.ball_radius
            top = self.rail + self.ball_radius
            bottom = self.height - self.rail - self.ball_radius

            if ball.x < left:
                ball.x = left
                ball.vx = abs(ball.vx) * 0.92
            elif ball.x > right:
                ball.x = right
                ball.vx = -abs(ball.vx) * 0.92

            if ball.y < top:
                ball.y = top
                ball.vy = abs(ball.vy) * 0.92
            elif ball.y > bottom:
                ball.y = bottom
                ball.vy = -abs(ball.vy) * 0.92

    def resolve_collisions(self):
        active_balls = [ball for ball in self.balls if not ball.pocketed]
        min_distance = self.ball_radius * 2

        for index, first in enumerate(active_balls):
            for second in active_balls[index + 1:]:
                dx = second.x - first.x
                dy = second.y - first.y
                distance = math.hypot(dx, dy)

                if distance <= 0 or distance >= min_distance:
                    continue

                nx = dx / distance
                ny = dy / distance
                overlap = min_distance - distance
                first.x -= nx * overlap / 2
                first.y -= ny * overlap / 2
                second.x += nx * overlap / 2
                second.y += ny * overlap / 2

                dvx = first.vx - second.vx
                dvy = first.vy - second.vy
                impulse = dvx * nx + dvy * ny

                if impulse > 0:
                    continue

                first.vx -= impulse * nx
                first.vy -= impulse * ny
                second.vx += impulse * nx
                second.vy += impulse * ny

    def check_pockets(self):
        pockets = [
            (self.rail, self.rail),
            (self.width / 2, self.rail - 2),
            (self.width - self.rail, self.rail),
            (self.rail, self.height - self.rail),
            (self.width / 2, self.height - self.rail + 2),
            (self.width - self.rail, self.height - self.rail),
        ]

        for ball in self.balls:
            if ball.pocketed:
                continue

            if any(math.hypot(ball.x - px, ball.y - py) <= self.pocket_radius for px, py in pockets):
                ball.pocketed = True
                ball.vx = 0
                ball.vy = 0

                if ball.number == 0:
                    self.scratch_this_shot = True
                else:
                    self.pocketed_this_shot.append(ball.number)

    def resolve_shot(self):
        shooter = self.shot_player or self.current_turn
        opponent = self.other_player(shooter)
        pocketed_kinds = [self.ball_kind(number) for number in self.pocketed_this_shot]

        if 8 in self.pocketed_this_shot:
            if self.player_has_cleared_group(shooter) and not self.scratch_this_shot:
                self.end_game(shooter, f"{self.player_label(shooter)} legally pocketed the 8 ball.")
            else:
                self.end_game(opponent, f"{self.player_label(shooter)} pocketed the 8 ball early or scratched.")
            return

        if self.groups[shooter] is None:
            first_group = next((kind for kind in pocketed_kinds if kind in {"solid", "stripe"}), None)
            if first_group:
                self.groups[shooter] = first_group
                self.groups[opponent] = "stripe" if first_group == "solid" else "solid"
                self.message = f"{self.player_label(shooter)} is {self.groups[shooter]}s."

        shooter_group = self.groups[shooter]
        made_own_ball = bool(shooter_group and shooter_group in pocketed_kinds)

        if self.scratch_this_shot:
            self.replace_cue_ball()
            self.current_turn = opponent
            self.message = f"Scratch. {self.player_label(opponent)} gets ball in hand."
        elif made_own_ball:
            self.current_turn = shooter
            if self.message.endswith("s."):
                self.message += " Shoot again."
            else:
                self.message = f"{self.player_label(shooter)} made one. Shoot again."
        else:
            self.current_turn = opponent
            self.message = f"{self.player_label(opponent)}'s turn."

        self.shot_in_motion = False
        self.shot_player = None
        self.pocketed_this_shot = []
        self.scratch_this_shot = False

    def stop_all_balls(self):
        for ball in self.balls:
            ball.vx = 0
            ball.vy = 0

    def ball_kind(self, number: int) -> str:
        if number == 8:
            return "eight"
        if 1 <= number <= 7:
            return "solid"
        if 9 <= number <= 15:
            return "stripe"
        return "cue"

    def player_has_cleared_group(self, player_id: str) -> bool:
        group = self.groups[player_id]
        if group is None:
            return False

        return all(ball.pocketed or ball.kind != group for ball in self.balls)

    def other_player(self, player_id: str) -> str:
        return "player2" if player_id == "player1" else "player1"

    def player_label(self, player_id: str) -> str:
        return "Player 1" if player_id == "player1" else "Player 2"

    def end_game(self, winner: str, message: str):
        self.started = False
        self.finished = True
        self.winner = winner
        self.paused = False
        self.pause_started_at = None
        self.pause_ends_at = None
        self.paused_by = None
        self.shot_in_motion = False
        self.message = message
        self.stop_all_balls()

    def to_dict(self):
        return {
            "kind": "pool",
            "width": self.width,
            "height": self.height,
            "started": self.started,
            "finished": self.finished,
            "winner": self.winner,
            "paused": self.paused,
            "pausedBy": self.paused_by,
            "pauseSecondsRemaining": self.pause_seconds_remaining(),
            "maxPauseSeconds": self.max_pause_seconds,
            "pausesPerPlayer": self.pauses_per_player,
            "pauseCounts": self.pause_counts,
            "currentTurn": self.current_turn,
            "groups": self.groups,
            "message": self.message,
            "tableSpeed": self.friction,
            "maxShotPower": self.max_shot_power,
            "shotInMotion": self.shot_in_motion,
            "balls": [
                {
                    "number": ball.number,
                    "kind": ball.kind,
                    "x": ball.x,
                    "y": ball.y,
                    "vx": ball.vx,
                    "vy": ball.vy,
                    "radius": self.ball_radius,
                    "pocketed": ball.pocketed,
                }
                for ball in self.balls
            ],
            "pockets": [
                {"x": self.rail, "y": self.rail, "radius": self.pocket_radius},
                {"x": self.width / 2, "y": self.rail - 2, "radius": self.pocket_radius},
                {"x": self.width - self.rail, "y": self.rail, "radius": self.pocket_radius},
                {"x": self.rail, "y": self.height - self.rail, "radius": self.pocket_radius},
                {"x": self.width / 2, "y": self.height - self.rail + 2, "radius": self.pocket_radius},
                {"x": self.width - self.rail, "y": self.height - self.rail, "radius": self.pocket_radius},
            ],
            "rail": self.rail,
        }
