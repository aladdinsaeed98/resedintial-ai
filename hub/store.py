"""Append-only reading log. The live page reads only the latest row per point."""

from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path

from hub.clock import format_timestamp, parse_timestamp
from hub.models import Quality, StoredReading


class ReadingStore:
    def __init__(self, path: Path | str) -> None:
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
        with self._lock:
            try:
                self._conn.close()
            except sqlite3.ProgrammingError:
                pass


def _to_reading(row: sqlite3.Row) -> StoredReading:
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
