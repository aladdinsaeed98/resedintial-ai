"""Parse an ESP32 reading.

Wire JSON is {point, value, unit, timestamp, quality}. Extra keys are ignored.
Nothing in a payload is a command — a "command": "off" field does not turn
anything off.

This sits between MQTT and the store. A parse error returns reading=None
so the gateway can drop the message and keep the last good row.

If every payload is dropped, check the topic (must be hvac/<node>/reading)
and that the JSON uses "point", not "point_id".
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from datetime import datetime

from hub.clock import parse_timestamp
from hub.models import Quality, StoredReading
from hub.topics import POINT_RE, TOPIC_RE

# Bigger than a real reading; small enough that a broken node cannot flood RAM.
MAX_PAYLOAD_BYTES = 2048

# DS18B20 usable range. The disconnect sentinel (-127) falls outside both.
_RANGES = {
    "F": (-67.0, 257.0),
    "C": (-55.0, 125.0),
}
_UNIT_ALIASES = {
    "f": "F",
    "°f": "F",
    "degf": "F",
    "fahrenheit": "F",
    "c": "C",
    "°c": "C",
    "degc": "C",
    "celsius": "C",
}


@dataclass(frozen=True)
class ParseResult:
    """Outcome of parse_reading. On success, error is None and reading is set."""

    reading: StoredReading | None
    error: str | None


def parse_reading(topic: str, payload: bytes | str, received_at: datetime) -> ParseResult:
    """Turn one MQTT message into a StoredReading, or explain why it was dropped.

    Inputs: topic (hvac/<node>/reading), raw JSON, hub receive time.
    Output: ParseResult. Rejects naive hub clocks, huge payloads, non-JSON,
    missing value/unit, and bad timestamps. Out-of-range numbers are stored
    as BAD rather than discarded, so you can still see that the probe died.
    """
    if received_at.tzinfo is None:
        return ParseResult(None, "hub clock must be timezone-aware")
    # Only the reading topic is accepted. A set/command topic is dropped.
    match = TOPIC_RE.match(topic.strip())
    if not match:
        return ParseResult(None, "unsupported topic")
    node_id = match.group(1)

    if isinstance(payload, str):
        raw = payload.encode("utf-8")
    else:
        raw = bytes(payload)
    if len(raw) > MAX_PAYLOAD_BYTES:
        return ParseResult(None, "payload too large")
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        return ParseResult(None, "payload is not utf-8")
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return ParseResult(None, "payload is not json")
    if not isinstance(data, dict):
        return ParseResult(None, "payload must be an object")

    # Wire field is "point". "point_id" is a common alias and is rejected.
    point = data.get("point")
    if not isinstance(point, str) or not POINT_RE.match(point):
        return ParseResult(None, "invalid point")
    if "value" not in data:
        return ParseResult(None, "missing value")
    if "unit" not in data:
        return ParseResult(None, "missing unit")

    numeric, value_error = _number(data.get("value"))
    if value_error:
        return ParseResult(None, value_error)
    unit = _normalize_unit(data.get("unit"))
    if unit is None:
        return ParseResult(None, "invalid unit")
    quality, quality_error = _quality(data)
    if quality_error:
        return ParseResult(None, quality_error)
    assert quality is not None

    # Impossible temps (999 °F, DS18B20 -127) become BAD so they are not shown live.
    if numeric is not None and not _in_range(unit, numeric):
        quality = Quality.BAD
    if numeric is None and quality is Quality.GOOD:
        quality = Quality.BAD

    device_timestamp, time_source, time_error = _timestamp(data.get("timestamp"), received_at)
    if time_error:
        return ParseResult(None, time_error)
    assert device_timestamp is not None and time_source is not None

    return ParseResult(
        StoredReading(
            point_id=point,
            node_id=node_id,
            value=numeric,
            unit=unit,
            quality=quality,
            device_timestamp=device_timestamp,
            received_at=received_at,
            time_source=time_source,
        ),
        None,
    )


def _number(value: object) -> tuple[float | None, str | None]:
    """Parse the JSON value field. None is allowed (bad probe). bool/NaN/Inf are not."""
    if value is None:
        return None, None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None, "invalid value"
    if not math.isfinite(float(value)):
        return None, "invalid value"
    return float(value), None


def _normalize_unit(value: object) -> str | None:
    """Map °F / fahrenheit / F onto F so the page and rules share one spelling."""
    if not isinstance(value, str):
        return None
    key = value.strip().replace(" ", "").lower()
    if key in _UNIT_ALIASES:
        return _UNIT_ALIASES[key]
    cleaned = value.strip()
    if not cleaned or len(cleaned) > 16:
        return None
    return cleaned


def _quality(data: dict) -> tuple[Quality | None, str | None]:
    """Read quality. Missing is UNKNOWN, not GOOD — we never assume a sample is fine."""
    if "quality" not in data or data["quality"] is None:
        return Quality.UNKNOWN, None
    raw = data["quality"]
    if not isinstance(raw, str):
        return None, "invalid quality"
    try:
        return Quality(raw.strip().lower()), None
    except ValueError:
        return None, "invalid quality"


def _in_range(unit: str, value: float) -> bool:
    """True if value is plausible for F or C. Unknown units have no range check yet."""
    bounds = _RANGES.get(unit)
    if bounds is None:
        return True
    low, high = bounds
    return low <= value <= high


def _timestamp(
    raw: object, received_at: datetime
) -> tuple[datetime | None, str | None, str | None]:
    """Parse the node's timestamp, or fall back to the hub clock.

    null timestamp -> use received_at and time_source 'hub' (no NTP yet).
    A bad string is an error so we do not store a nonsense clock.
    """
    if raw is None:
        return received_at, "hub", None
    if not isinstance(raw, str):
        return None, None, "invalid timestamp"
    try:
        return parse_timestamp(raw), "device", None
    except ValueError:
        return None, None, "invalid timestamp"
