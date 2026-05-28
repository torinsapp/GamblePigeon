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

    def __init__(self, winning_score: int = 5, ball_speed: float = 5):
        self.width = 800
        self.height = 500
        self.paddle_width = 12
        self.paddle_height = 90
        self.ball_size = 12
        self.paddle_speed = 8
        self.winning_score = self.clean_winning_score(winning_score)
        self.ball_speed = self.clean_ball_speed(ball_speed)

        self.started = False
        self.finished = False
        self.winner: Optional[str] = None

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

    def set_paddle_direction(self, player_id: str, direction: str):
        if self.finished:
            return

        if player_id == "player1":
            self.player1.direction = direction
        elif player_id == "player2":
            self.player2.direction = direction

    def start(self):
        self.started = True
        self.finished = False
        self.winner = None

    def tick(self):
        if not self.started or self.finished:
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
        self.player1.direction = "none"
        self.player2.direction = "none"

    def reset_ball(self, direction: int):
        self.ball.x = self.width / 2
        self.ball.y = self.height / 2
        self.ball.vx = self.ball_speed * direction
        self.ball.vy = self.ball_speed * 0.6

    def to_dict(self):
        return {
            "width": self.width,
            "height": self.height,
            "started": self.started,
            "finished": self.finished,
            "winner": self.winner,
            "winningScore": self.winning_score,
            "ballSpeed": self.ball_speed,
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
