import time
from dataclasses import dataclass
from typing import Optional


@dataclass
class Paddle:
    y: float = 200
    direction: str = "none"


@dataclass
class Ball:
    x: float = 400
    y: float = 250
    vx: float = 5
    vy: float = 3


class PongGame:
    MIN_BALL_SPEED = 3
    MAX_BALL_SPEED = 14
    MIN_PAUSE_SECONDS = 5
    MAX_PAUSE_SECONDS = 300
    MIN_PAUSES_PER_PLAYER = 0
    MAX_PAUSES_PER_PLAYER = 20

    def __init__(
            self,
            winning_score: int = 5,
            ball_speed: float = 5,
            max_pause_seconds: int = 30,
            pauses_per_player: int = 2,
    ):
        self.width = 800
        self.height = 500
        self.paddle_width = 12
        self.paddle_height = 90
        self.ball_size = 12
        self.paddle_speed = 8
        self.winning_score = self.clean_winning_score(winning_score)
        self.ball_speed = self.clean_ball_speed(ball_speed)
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

        self.player1 = Paddle()
        self.player2 = Paddle()
        self.ball = Ball(vx=self.ball_speed, vy=self.ball_speed * 0.6)

        self.score = {
            "player1": 0,
            "player2": 0
        }

    @classmethod
    def clean_winning_score(cls, winning_score: int) -> int:
        return max(1, min(50, int(winning_score)))

    @classmethod
    def clean_ball_speed(cls, ball_speed: float) -> float:
        return max(cls.MIN_BALL_SPEED, min(cls.MAX_BALL_SPEED, float(ball_speed)))

    @classmethod
    def clean_max_pause_seconds(cls, max_pause_seconds: int) -> int:
        return max(cls.MIN_PAUSE_SECONDS, min(cls.MAX_PAUSE_SECONDS, int(max_pause_seconds)))

    @classmethod
    def clean_pauses_per_player(cls, pauses_per_player: int) -> int:
        return max(cls.MIN_PAUSES_PER_PLAYER, min(cls.MAX_PAUSES_PER_PLAYER, int(pauses_per_player)))

    def set_paddle_direction(self, player_id: str, direction: str):
        if self.finished or self.paused:
            return

        if player_id == "player1":
            self.player1.direction = direction
        elif player_id == "player2":
            self.player2.direction = direction

    def start(self):
        self.started = True
        self.finished = False
        self.winner = None
        self.paused = False
        self.pause_started_at = None
        self.pause_ends_at = None
        self.paused_by = None
        self.pause_counts = {}

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
        self.player1.direction = "none"
        self.player2.direction = "none"

    def resume(self):
        self.paused = False
        self.pause_started_at = None
        self.pause_ends_at = None
        self.paused_by = None

    def pause_seconds_remaining(self) -> int:
        if not self.paused or self.pause_ends_at is None:
            return 0

        return max(0, int(round(self.pause_ends_at - time.monotonic())))

    def tick(self):
        if not self.started or self.finished:
            return

        if self.paused:
            if self.pause_seconds_remaining() <= 0:
                self.resume()
            return

        self.move_paddle(self.player1)
        self.move_paddle(self.player2)
        self.move_ball()

    def move_paddle(self, paddle: Paddle):
        if paddle.direction == "up":
            paddle.y -= self.paddle_speed
        elif paddle.direction == "down":
            paddle.y += self.paddle_speed

        paddle.y = max(0, min(self.height - self.paddle_height, paddle.y))

    def move_ball(self):
        self.ball.x += self.ball.vx
        self.ball.y += self.ball.vy

        # Top/bottom bounce
        if self.ball.y <= 0 or self.ball.y + self.ball_size >= self.height:
            self.ball.vy *= -1

        # Left paddle collision
        if (
                self.ball.x <= 30 + self.paddle_width
                and self.player1.y <= self.ball.y <= self.player1.y + self.paddle_height
        ):
            self.ball.vx = abs(self.ball.vx)

        # Right paddle collision
        if (
                self.ball.x + self.ball_size >= self.width - 30 - self.paddle_width
                and self.player2.y <= self.ball.y <= self.player2.y + self.paddle_height
        ):
            self.ball.vx = -abs(self.ball.vx)

        # Player 2 scores
        if self.ball.x < 0:
            self.score["player2"] += 1
            self.after_point_scored(next_direction=1)

        # Player 1 scores
        if self.ball.x > self.width:
            self.score["player1"] += 1
            self.after_point_scored(next_direction=-1)

    def after_point_scored(self, next_direction: int):
        winner = self.find_winner()

        if winner:
            self.end_game(winner)
            return

        self.reset_ball(direction=next_direction)

    def find_winner(self) -> Optional[str]:
        if self.score["player1"] >= self.winning_score:
            return "player1"
        if self.score["player2"] >= self.winning_score:
            return "player2"
        return None

    def end_game(self, winner: str):
        self.started = False
        self.finished = True
        self.winner = winner
        self.paused = False
        self.pause_started_at = None
        self.pause_ends_at = None
        self.paused_by = None
        self.player1.direction = "none"
        self.player2.direction = "none"

    def reset_ball(self, direction: int):
        self.ball.x = self.width / 2
        self.ball.y = self.height / 2
        self.ball.vx = self.ball_speed * direction
        self.ball.vy = self.ball_speed * 0.6

    def to_dict(self):
        return {
            "kind": "pong",
            "width": self.width,
            "height": self.height,
            "started": self.started,
            "finished": self.finished,
            "winner": self.winner,
            "winningScore": self.winning_score,
            "ballSpeed": self.ball_speed,
            "paused": self.paused,
            "pausedBy": self.paused_by,
            "pauseSecondsRemaining": self.pause_seconds_remaining(),
            "maxPauseSeconds": self.max_pause_seconds,
            "pausesPerPlayer": self.pauses_per_player,
            "pauseCounts": self.pause_counts,
            "paddles": {
                "player1": {
                    "x": 30,
                    "y": self.player1.y,
                    "width": self.paddle_width,
                    "height": self.paddle_height,
                },
                "player2": {
                    "x": self.width - 30 - self.paddle_width,
                    "y": self.player2.y,
                    "width": self.paddle_width,
                    "height": self.paddle_height,
                }
            },
            "ball": {
                "x": self.ball.x,
                "y": self.ball.y,
                "size": self.ball_size,
            },
            "score": self.score
        }
