import math


class Circle:
    def __init__(self, radius: float):
        self.radius = radius

    def area(self) -> float:
        return math.pi * self.radius ** 2

    def name(self) -> str:
        return "circle r=%s" % self.radius


class Square:
    def __init__(self, side: float):
        self.side = side

    def area(self) -> float:
        return self.side * self.side

    def name(self) -> str:
        return "square s=%s" % self.side
