"""Hub settings. Thresholds and point names live in config, not in scattered code."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping

from hub.topics import NODE_RE, POINT_RE

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_POINTS_FILE = ROOT / "config" / "points.json"
DEFAULT_WEB_DIR = ROOT / "web"
DEFAULT_STALE_AFTER_SECONDS = 120
DEFAULT_MQTT_HOST = "127.0.0.1"
DEFAULT_MQTT_PORT = 1883
DEFAULT_SYSTEM_NAME = "Bench"
DEFAULT_HTTP_HOST = "0.0.0.0"
DEFAULT_HTTP_PORT = 8000


@dataclass(frozen=True)
class PointSpec:
    id: str
    name: str
    unit: str
    node_id: str


@dataclass(frozen=True)
class Settings:
    mqtt_host: str
    mqtt_port: int
    database_path: Path
    stale_after_seconds: int
    system_name: str
    points: tuple[PointSpec, ...]
    web_dir: Path
    host: str
    port: int


def default_db_path() -> Path:
    """Keep SQLite off iCloud. The repo itself lives in iCloud Drive."""
    local = os.environ.get("LOCALAPPDATA")
    if local:
        return Path(local) / "hvac-monitor" / "hvac.db"
    return Path.home() / ".local" / "share" / "hvac-monitor" / "hvac.db"


def load_points(path: Path) -> tuple[PointSpec, ...]:
    data = json.loads(path.read_text(encoding="utf-8"))
    points: list[PointSpec] = []
    seen: set[str] = set()
    for item in data["points"]:
        spec = PointSpec(
            id=str(item["id"]),
            name=str(item["name"]),
            unit=str(item["unit"]),
            node_id=str(item["node_id"]),
        )
        if not POINT_RE.match(spec.id):
            raise ValueError(f"invalid point id {spec.id}")
        if not NODE_RE.match(spec.node_id):
            raise ValueError(f"invalid node id {spec.node_id}")
        if spec.id in seen:
            raise ValueError(f"duplicate point id {spec.id}")
        if not spec.name.strip() or not spec.unit.strip():
            raise ValueError(f"point {spec.id} needs a name and unit")
        seen.add(spec.id)
        points.append(spec)
    if not points:
        raise ValueError(f"{path} has no points")
    return tuple(points)


def _positive_int(source: Mapping[str, str], key: str, default: int) -> int:
    text = source.get(key, str(default))
    try:
        value = int(text)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{key} must be an integer") from exc
    if value <= 0:
        raise ValueError(f"{key} must be positive")
    return value


def load_settings(env: Mapping[str, str] | None = None) -> Settings:
    source = os.environ if env is None else env
    points_file = Path(source.get("HVAC_POINTS_FILE", str(DEFAULT_POINTS_FILE)))
    database = source.get("HVAC_DB")
    system_name = source.get("HVAC_SYSTEM_NAME", DEFAULT_SYSTEM_NAME).strip()
    return Settings(
        mqtt_host=source.get("HVAC_MQTT_HOST", DEFAULT_MQTT_HOST).strip() or DEFAULT_MQTT_HOST,
        mqtt_port=_positive_int(source, "HVAC_MQTT_PORT", DEFAULT_MQTT_PORT),
        database_path=Path(database) if database else default_db_path(),
        stale_after_seconds=_positive_int(
            source, "HVAC_STALE_AFTER_SECONDS", DEFAULT_STALE_AFTER_SECONDS
        ),
        system_name=system_name or DEFAULT_SYSTEM_NAME,
        points=load_points(points_file),
        web_dir=Path(source.get("HVAC_WEB_DIR", str(DEFAULT_WEB_DIR))),
        host=source.get("HVAC_HOST", DEFAULT_HTTP_HOST).strip() or DEFAULT_HTTP_HOST,
        port=_positive_int(source, "HVAC_PORT", DEFAULT_HTTP_PORT),
    )
