"""Decide what the page is allowed to show for each point.

Sits between the store and the API. Stale means the hub stopped hearing
that point (age from received_at, default 120 s). A message that just
arrived is current even if the node's own clock is wrong. A stale or
bad-quality sample is not returned as a current value — the last number
is not left on screen.

If tiles stay live after you unplug the node, check stale_after_seconds
and that age is computed from received_at, not the device timestamp.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from hub.clock import format_timestamp
from hub.config import PointSpec, Settings
from hub.models import Quality, StoredReading
from hub.store import ReadingStore


@dataclass(frozen=True)
class LivePoint:
    """One tile's worth of data after stale/bad rules have been applied.

    status is missing, live, stale, bad, or unknown. value is a number only
    when status is live; otherwise it is None so the page cannot show junk.
    """

    point_id: str
    name: str
    node_id: str
    unit: str
    status: str
    quality: str | None
    value: float | None
    age_seconds: int | None
    device_timestamp: datetime | None
    received_at: datetime | None
    time_source: str | None

    def as_public_dict(self) -> dict[str, Any]:
        """JSON for /api/readings. Timestamps are Z-suffix UTC strings or null."""
        return {
            "point_id": self.point_id,
            "name": self.name,
            "node_id": self.node_id,
            "unit": self.unit,
            "status": self.status,
            "quality": self.quality,
            "value": self.value,
            "age_seconds": self.age_seconds,
            "device_timestamp": (
                format_timestamp(self.device_timestamp) if self.device_timestamp else None
            ),
            "received_at": format_timestamp(self.received_at) if self.received_at else None,
            "time_source": self.time_source,
        }


def collect_live_points(
    settings: Settings, store: ReadingStore, now: datetime
) -> list[LivePoint]:
    """Classify every configured point, then any extra ids that showed up on the wire.

    Configured points stay in points.json order so the page does not jump
    around. Unexpected ids are appended, sorted, rather than dropped — a
    misnamed probe should still be visible while you debug it.
    """
    latest = store.latest_map()
    ordered = [spec.id for spec in settings.points]
    extras = sorted(point_id for point_id in latest if point_id not in ordered)
    specs = {spec.id: spec for spec in settings.points}
    return [
        classify(
            specs.get(point_id),
            latest.get(point_id),
            now,
            settings.stale_after_seconds,
            point_id,
        )
        for point_id in ordered + extras
    ]


def live_point_for(
    settings: Settings, store: ReadingStore, point_id: str, now: datetime
) -> LivePoint | None:
    """Classify one point. None only if the id is unknown to both config and store."""
    spec = next((item for item in settings.points if item.id == point_id), None)
    reading = store.latest(point_id)
    if spec is None and reading is None:
        return None
    return classify(spec, reading, now, settings.stale_after_seconds, point_id)


def public_snapshot(settings: Settings, store: ReadingStore, now: datetime) -> dict[str, Any]:
    """Full payload for /api/readings: system name, hub time, cutoff, and all tiles."""
    points = collect_live_points(settings, store, now)
    return {
        "system_name": settings.system_name,
        "server_time": format_timestamp(now),
        "stale_after_seconds": settings.stale_after_seconds,
        "points": [point.as_public_dict() for point in points],
    }


def classify(
    spec: PointSpec | None,
    reading: StoredReading | None,
    now: datetime,
    stale_after_seconds: int,
    point_id: str,
) -> LivePoint:
    """Apply the Phase 1 display rules to one stored row.

    Age is hub receive time minus now, not the ESP32's clock — a just-arrived
    sample is live even if the board's timestamp is hours off. After
    stale_after_seconds (120) the value is stripped. BAD quality (disconnected
    probe, out-of-range temp) is shown as bad, never as a number.
    """
    name = spec.name if spec is not None else point_id
    fallback_unit = spec.unit if spec is not None else ""
    fallback_node = spec.node_id if spec is not None else ""
    if reading is None:
        return LivePoint(
            point_id=point_id,
            name=name,
            node_id=fallback_node,
            unit=fallback_unit,
            status="missing",
            quality=None,
            value=None,
            age_seconds=None,
            device_timestamp=None,
            received_at=None,
            time_source=None,
        )

    # Hub hear-time, not the node's clock. A future device ts cannot fake "still live".
    age = int((now - reading.received_at).total_seconds())
    if age < 0:
        age = 0
    if age >= stale_after_seconds:
        status = "stale"
    elif reading.quality is Quality.GOOD and reading.value is not None:
        status = "live"
    elif reading.quality is Quality.BAD:
        status = "bad"
    else:
        # Missing or unknown quality is not promoted to good.
        status = "unknown"

    quality = {"live": "good", "bad": "bad", "unknown": "unknown"}.get(status)
    return LivePoint(
        point_id=point_id,
        name=name,
        node_id=reading.node_id or fallback_node,
        unit=reading.unit or fallback_unit,
        status=status,
        quality=quality,
        # Hide the number unless this sample is current and good.
        value=reading.value if status == "live" else None,
        age_seconds=age,
        device_timestamp=reading.device_timestamp,
        received_at=reading.received_at,
        time_source=reading.time_source,
    )
