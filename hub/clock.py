"""Timezone-aware clocks. Tests advance ManualClock instead of waiting.

Every reading is stamped in UTC so the page age and the 120 s stale cutoff
mean the same thing on the hub, the ESP32, and the simulator. If timestamps
look wrong, check NTP on the node and that the hub clock is timezone-aware.
"""

from __future__ import annotations

import threading
from datetime import datetime, timedelta, timezone


def format_timestamp(moment: datetime) -> str:
    """Turn a timezone-aware datetime into an ISO-8601 UTC string ending in Z.

    Input must already have a time zone; naive datetimes are rejected so we
    never store a local-time string that looks like UTC. Output example:
    2026-10-17T12:00:00Z.
    """
    if moment.tzinfo is None:
        raise ValueError("timestamp must be timezone-aware")
    text = moment.astimezone(timezone.utc).isoformat(timespec="seconds")
    return text.replace("+00:00", "Z")


def parse_timestamp(text: str) -> datetime:
    """Parse an ISO-8601 string from a node, the simulator, or SQLite.

    Accepts a trailing Z or +00:00. A string with no zone is treated as UTC
    so a board that omitted the suffix still stores a comparable instant.
    Output is always timezone-aware UTC.
    """
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
    """Wall clock used in production. now() is the hub's UTC time."""

    def now(self) -> datetime:
        """Return the real current UTC time. This is received_at for live MQTT."""
        return datetime.now(timezone.utc)


class ManualClock:
    """Test clock so stale-after-120 s can be proven without sleeping 2 minutes."""

    def __init__(self, start: datetime) -> None:
        """Freeze time at start. start must be timezone-aware (usually UTC)."""
        if start.tzinfo is None:
            raise ValueError("clock start must be timezone-aware")
        self._now = start.astimezone(timezone.utc)
        self._lock = threading.Lock()

    def now(self) -> datetime:
        """Return the frozen instant. Thread-safe because the gateway may read it."""
        with self._lock:
            return self._now

    def advance(self, seconds: float) -> None:
        """Move the frozen clock forward by seconds. Used to trip the stale cutoff."""
        with self._lock:
            self._now += timedelta(seconds=seconds)
