@dataclass
class Clock:
    """A lap timer."""
    start: float = 0.0  # seconds

    def lap(self, now) -> float:
        return now - self.start if now else None
print(f"{Clock().lap(3)}", 0x10, 1_000j)
