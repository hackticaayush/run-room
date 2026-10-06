def summary_line(shape) -> str:
    return "%-14s area %8.2f" % (shape.name(), shape.area())


def total_area(shapes) -> float:
    return sum(s.area() for s in shapes)
