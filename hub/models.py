"""Reading types shared with the supervisory agent.

These are the nouns the rest of the hub passes around: a Point (a named
sensor), a PointValue (one sample), Quality, and StoredReading (one SQLite
row). The hub is monitor-only. Adapters refuse writes by raising
WriteNotSupported — that is the safety gate, not a TODO.

If a future adapter grows a write() that does not raise, that is a bug.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Iterable, Mapping, Optional, Sequence


class Quality(Enum):
    """How much we trust a sample. UNKNOWN is not a pass; only GOOD is current."""

    GOOD = "good"
    BAD = "bad"
    UNKNOWN = "unknown"


def quality_is_good(quality: Quality) -> bool:
    """True only for Quality.GOOD. UNKNOWN is not good. Never silently promote it."""
    return quality is Quality.GOOD


class GatewayError(Exception):
    """Connection or contract failure. Base for UnknownPoint."""


class UnknownPoint(GatewayError):
    """The profile and the store have never seen this point. Do not invent one."""


class WriteNotSupported(Exception):
    """Raised by adapters that have no write path. Safe by omission.

    BuildingGateway.write() always raises this so a monitor adapter cannot
    send a setpoint or a relay command even if a caller asks.
    """


@dataclass(frozen=True)
class Point:
    """A configured sensor. writable is always False on this hub."""

    id: str
    name: str
    equipment_id: str
    unit: str
    writable: bool
    description: str = ""


@dataclass(frozen=True)
class PointValue:
    """One reading as returned by gateway.read(). value may be None when not live."""

    point_id: str
    value: Any
    unit: str
    quality: Quality
    timestamp: datetime
    raw: dict[str, Any] = field(default_factory=dict)

    def trustworthy(self) -> bool:
        """True when this number may be shown or used as current. Stale/None fail."""
        return quality_is_good(self.quality) and self.value is not None


@dataclass(frozen=True)
class StoredReading:
    """One SQLite row: the node's stamp plus the hub's receive time.

    time_source is 'device' when the payload had a timestamp, 'hub' when we
    filled it in (ESP32 had no NTP yet). received_at is what stale uses.
    """

    point_id: str
    node_id: str
    value: float | None
    unit: str
    quality: Quality
    device_timestamp: datetime
    received_at: datetime
    time_source: str


class BuildingGateway:
    """Read port. The default write is refused so a monitor adapter stays safe.

    Concrete adapters (MqttGateway) implement connect, close, list_*, and
    read. They inherit write() unless they override it — and they must not.
    """

    backend_name: str = ""
    adapter_kind: str = "unknown"
    supports_write: bool = False

    def connect(self) -> None:
        """Open the upstream connection. Subclasses implement this."""
        raise NotImplementedError

    def close(self) -> None:
        """Release the upstream connection. Subclasses implement this."""
        raise NotImplementedError

    def list_equipment(self) -> Sequence[str]:
        """Ids of nodes / equipment this adapter knows. Subclasses implement this."""
        raise NotImplementedError

    def list_points(self, equipment_id: Optional[str] = None) -> Sequence[Point]:
        """Configured points, optionally for one node. Subclasses implement this."""
        raise NotImplementedError

    def read(self, point_id: str) -> PointValue:
        """Latest value for one point. Subclasses implement this."""
        raise NotImplementedError

    def read_many(self, point_ids: Iterable[str]) -> Mapping[str, PointValue]:
        """Read several points. Default is a loop over read(); no writes involved."""
        return {point_id: self.read(point_id) for point_id in point_ids}

    def write(self, point_id: str, value: Any) -> Any:
        """Always refuse. This is the no-write-path rule, not an unfinished method."""
        raise WriteNotSupported(
            f"{type(self).__name__} does not support writes "
            f"(supports_write={self.supports_write})"
        )
