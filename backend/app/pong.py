from dataclasses import dataclass


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
    def __init__(self):
        self.width = 800
        self.height = 500
        self.paddle_width = 12
        self.paddle_height = 90
        self.ball_size = 12
        self.paddle_speed = 8

        self.started = False

        self.player1 = Paddle()
        self.player2 = Paddle()
        self.ball = Ball()

        self.score = {
            "player1": 0,
            "player2": 0
        }

    def set_paddle_direction(self, player_id: str, direction: str):
        if player_id == "player1":
            self.player1.direction = direction
        elif player_id == "player2":
            self.player2.direction = direction

    def tick(self):
        if not self.started:
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
            self.reset_ball(direction=1)

        # Player 1 scores
        if self.ball.x > self.width:
            self.score["player1"] += 1
            self.reset_ball(direction=-1)

    def reset_ball(self, direction: int):
        self.ball.x = self.width / 2
        self.ball.y = self.height / 2
        self.ball.vx = 5 * direction
        self.ball.vy = 3

    def to_dict(self):
        return {
            "width": self.width,
            "height": self.height,
            "started": self.started,
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