"""Append-only reading log. The live page reads only the latest row per point.

This is SQLite behind the gateway. Every accepted MQTT payload becomes one
row. History for later phases will read the same table; Phase 1 only needs
the newest row per point_id.

The database path is outside the iCloud repo folder (see hub/config.py).
If the page forgets readings after a reboot, check HVAC_DB and that this
file is being opened, not a second empty database.
"""

from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path

from hub.clock import format_timestamp, parse_timestamp
from hub.models import Quality, StoredReading


class ReadingStore:
    """Thread-safe SQLite log of readings. MQTT and HTTP may hit it together."""

    def __init__(self, path: Path | str) -> None:
        """Open (or create) the database at path and ensure the readings table exists.

        WAL mode lets the MQTT thread write while the page reads. The lock
        still serializes Python-side access because sqlite3 connections are
        not freely shared across threads without it.
        """
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(self.path, check_same_thread=False, timeout=5)
        self._conn.row_factory = sqlite3.Row
        try:
            self._conn.execute("PRAGMA journal_mode=WAL")
        except sqlite3.DatabaseError:
            pass
        self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS readings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                point_id TEXT NOT NULL,
                node_id TEXT NOT NULL,
                value_json TEXT,
                unit TEXT NOT NULL,
                quality TEXT NOT NULL,
                device_timestamp TEXT NOT NULL,
                received_at TEXT NOT NULL,
                time_source TEXT NOT NULL
            )
            """
        )
        self._conn.commit()

    def add(self, reading: StoredReading) -> None:
        """Append one reading. Never updates an old row — history stays intact.

        value is stored as JSON so None (disconnected probe) round-trips as
        null, not the string "None".
        """
        with self._lock:
            self._conn.execute(
                """
                INSERT INTO readings (
                    point_id, node_id, value_json, unit, quality,
                    device_timestamp, received_at, time_source
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    reading.point_id,
                    reading.node_id,
                    json.dumps(reading.value),
                    reading.unit,
                    reading.quality.value,
                    format_timestamp(reading.device_timestamp),
                    format_timestamp(reading.received_at),
                    reading.time_source,
                ),
            )
            self._conn.commit()

    def latest(self, point_id: str) -> StoredReading | None:
        """Newest row for one point, or None if that point has never reported."""
        with self._lock:
            row = self._conn.execute(
                """
                SELECT point_id, node_id, value_json, unit, quality,
                       device_timestamp, received_at, time_source
                FROM readings
                WHERE point_id = ?
                ORDER BY id DESC
                LIMIT 1
                """,
                (point_id,),
            ).fetchone()
        if row is None:
            return None
        return _to_reading(row)

    def latest_map(self) -> dict[str, StoredReading]:
        """Newest row for every point_id, keyed by id. Used to build the live page."""
        with self._lock:
            rows = self._conn.execute(
                """
                SELECT r.point_id, r.node_id, r.value_json, r.unit, r.quality,
                       r.device_timestamp, r.received_at, r.time_source
                FROM readings r
                JOIN (
                    SELECT point_id, MAX(id) AS id
                    FROM readings
                    GROUP BY point_id
                ) newest ON newest.id = r.id
                """
            ).fetchall()
        return {row["point_id"]: _to_reading(row) for row in rows}

    def close(self) -> None:
        """Close the SQLite connection. Ignores a double-close from tests."""
        with self._lock:
            try:
                self._conn.close()
            except sqlite3.ProgrammingError:
                pass


def _to_reading(row: sqlite3.Row) -> StoredReading:
    """Turn one SQLite row back into a StoredReading. value_json may be JSON null."""
    return StoredReading(
        point_id=row["point_id"],
        node_id=row["node_id"],
        value=json.loads(row["value_json"]),
        unit=row["unit"],
        quality=Quality(row["quality"]),
        device_timestamp=parse_timestamp(row["device_timestamp"]),
        received_at=parse_timestamp(row["received_at"]),
        time_source=row["time_source"],
    )
