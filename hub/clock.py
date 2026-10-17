"""Timezone-aware clocks. Tests advance ManualClock instead of waiting."""

from __future__ import annotations

import threading
from datetime import datetime, timedelta, timezone


def format_timestamp(moment: datetime) -> str:
    if moment.tzinfo is None:
        raise ValueError("timestamp must be timezone-aware")
    text = moment.astimezone(timezone.utc).isoformat(timespec="seconds")
    return text.replace("+00:00", "Z")


def parse_timestamp(text: str) -> datetime:
    cleaned = text.strip()
    if cleaned.endswith("Z"):
        cleaned = cleaned[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(cleaned)
    except ValueError as exc:
        raise ValueError("invalid timestamp") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


class SystemClock:
    def now(self) -> datetime:
        return datetime.now(timezone.utc)


class ManualClock:
    def __init__(self, start: datetime) -> None:
        if start.tzinfo is None:
            raise ValueError("clock start must be timezone-aware")
        self._now = start.astimezone(timezone.utc)
        self._lock = threading.Lock()

    def now(self) -> datetime:
        with self._lock:
            return self._now

    def advance(self, seconds: float) -> None:
        with self._lock:
            self._now += timedelta(seconds=seconds)
