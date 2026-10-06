"""RUN ROOM sample project: several modules, a requirements file and a question.

RUN PYTHON -> PROJECT FOLDER -> pick this folder.
Setup command (suggested for you): pip install -r requirements.txt
Run command: python main.py
"""

from shapes.geometry import Circle, Square
from shapes.report import summary_line, total_area


def read_count() -> int:
    raw = input("How many circles (1-6)? ")
    return max(1, min(int(raw), 6))


def build(count: int) -> list:
    items = [Circle(r) for r in range(1, count + 1)]
    items.append(Square(3))
    return items


def main() -> None:
    shapes = build(read_count())
    for shape in shapes:
        print(summary_line(shape))
    print("Total area:", round(total_area(shapes), 2))


if __name__ == "__main__":
    main()
