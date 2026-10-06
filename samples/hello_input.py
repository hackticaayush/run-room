"""RUN ROOM sample: one file that asks questions.

RUN PYTHON -> ONE FILE -> pick this file. Run command: python hello_input.py
Watch Ghost think about each function and say what it returned, and answer the
questions that pop up. Type a negative size to see a crash.
"""

from dataclasses import dataclass


@dataclass
class Box:
    width: float
    height: float

    def area(self) -> float:
        return self.width * self.height


def ask_name() -> str:
    name = input("What is your name? ").strip()
    return name or "stranger"


def ask_size(label: str) -> float:
    value = float(input(label + " (a number): "))
    if value < 0:
        raise ValueError(label + " cannot be negative: " + str(value))
    return value


def squares(n: int):
    for i in range(1, n + 1):
        yield i * i


def describe(box: Box) -> str:
    return "a %s x %s box has an area of %.1f" % (box.width, box.height, box.area())


def main() -> None:
    name = ask_name()
    print("Hello, %s!" % name)
    box = Box(ask_size("Width"), ask_size("Height"))
    print(describe(box))
    print("Squares:", list(squares(5)))
    print("Done.")


if __name__ == "__main__":
    main()
