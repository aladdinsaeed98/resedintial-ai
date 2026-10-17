"""Reading types shared with the supervisory agent.

The hub is monitor-only. Adapters refuse writes by raising WriteNotSupported.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Iterable, Mapping, Optional, Sequence


class Quality(Enum):
    GOOD = "good"
    BAD = "bad"
    UNKNOWN = "unknown"


def quality_is_good(quality: Quality) -> bool:
    """UNKNOWN is not good. Never silently promote it."""
    return quality is Quality.GOOD


class GatewayError(Exception):
    """Connection or contract failure."""


class UnknownPoint(GatewayError):
    """The profile and the store have never seen this point."""


class WriteNotSupported(Exception):
    """Raised by adapters that have no write path. Safe by omission."""


@dataclass(frozen=True)
class Point:
    id: str
    name: str
    equipment_id: str
    unit: str
    writable: bool
    description: str = ""


@dataclass(frozen=True)
class PointValue:
    point_id: str
    value: Any
    unit: str
    quality: Quality
    timestamp: datetime
    raw: dict[str, Any] = field(default_factory=dict)

    def trustworthy(self) -> bool:
        return quality_is_good(self.quality) and self.value is not None


@dataclass(frozen=True)
class StoredReading:
    point_id: str
    node_id: str
    value: float | None
    unit: str
    quality: Quality
    device_timestamp: datetime
    received_at: datetime
    time_source: str


class BuildingGateway:
    """Read port. The default write is refused so a monitor adapter stays safe."""

    backend_name: str = ""
    adapter_kind: str = "unknown"
    supports_write: bool = False

    def connect(self) -> None:
        raise NotImplementedError

    def close(self) -> None:
        raise NotImplementedError

    def list_equipment(self) -> Sequence[str]:
        raise NotImplementedError

    def list_points(self, equipment_id: Optional[str] = None) -> Sequence[Point]:
        raise NotImplementedError

    def read(self, point_id: str) -> PointValue:
        raise NotImplementedError

    def read_many(self, point_ids: Iterable[str]) -> Mapping[str, PointValue]:
        return {point_id: self.read(point_id) for point_id in point_ids}

    def write(self, point_id: str, value: Any) -> Any:
        raise WriteNotSupported(
            f"{type(self).__name__} does not support writes "
            f"(supports_write={self.supports_write})"
        )
