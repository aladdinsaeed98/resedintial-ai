/**
 * Append-only reading log. The live page reads only the latest row per point.
 *
 * SQLite WAL, one file, better-sqlite3 (synchronous). If the page is empty
 * after a restart, the rows are still here — live.py / live.ts will mark
 * them stale from received_at. Do not delete this file to "fix" stale tiles.
 */

import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { formatTimestamp, parseTimestamp } from "./clock";
import { Quality, type StoredReading } from "./models";

/** Anything MqttGateway can append to. The collector buffer implements this. */
export interface ReadingLookup {
  add(reading: StoredReading): void;
  latest(pointId: string): StoredReading | null;
  latestMap(): Record<string, StoredReading>;
}

interface ReadingRow {
  point_id: string;
  node_id: string;
  value_json: string;
  unit: string;
  quality: string;
  device_timestamp: string;
  received_at: string;
  time_source: string;
}

export class ReadingStore implements ReadingLookup {
  readonly path: string;
  private readonly db: Database.Database;
  private readonly insertStmt: Database.Statement;
  private readonly latestStmt: Database.Statement;
  private readonly latestMapStmt: Database.Statement;
  private closed = false;

  constructor(dbPath: string) {
    this.path = dbPath;
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    try {
      this.db.pragma("journal_mode = WAL");
    } catch {
      // A corrupt file still lets us try the CREATE; tests open a fresh path.
    }
    this.db.exec(`
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
    `);
    this.insertStmt = this.db.prepare(`
      INSERT INTO readings (
        point_id, node_id, value_json, unit, quality,
        device_timestamp, received_at, time_source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.latestStmt = this.db.prepare(`
      SELECT point_id, node_id, value_json, unit, quality,
             device_timestamp, received_at, time_source
      FROM readings
      WHERE point_id = ?
      ORDER BY id DESC
      LIMIT 1
    `);
    this.latestMapStmt = this.db.prepare(`
      SELECT r.point_id, r.node_id, r.value_json, r.unit, r.quality,
             r.device_timestamp, r.received_at, r.time_source
      FROM readings r
      JOIN (
        SELECT point_id, MAX(id) AS id
        FROM readings
        GROUP BY point_id
      ) newest ON newest.id = r.id
    `);
  }

  /** Append one sample. The previous row stays; latest() uses MAX(id). */
  add(reading: StoredReading): void {
    this.insertStmt.run(
      reading.point_id,
      reading.node_id,
      JSON.stringify(reading.value),
      reading.unit,
      reading.quality,
      formatTimestamp(reading.device_timestamp),
      formatTimestamp(reading.received_at),
      reading.time_source,
    );
  }

  /** Newest row for one point, or null if this point has never been stored. */
  latest(pointId: string): StoredReading | null {
    const row = this.latestStmt.get(pointId) as ReadingRow | undefined;
    if (!row) {
      return null;
    }
    return toReading(row);
  }

  /** Newest row per point_id. Used to build the whole live snapshot. */
  latestMap(): Record<string, StoredReading> {
    const rows = this.latestMapStmt.all() as ReadingRow[];
    const out: Record<string, StoredReading> = {};
    for (const row of rows) {
      out[row.point_id] = toReading(row);
    }
    return out;
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    try {
      this.db.close();
    } catch {
      // Closing twice is harmless.
    }
  }
}

function toReading(row: ReadingRow): StoredReading {
  return {
    point_id: row.point_id,
    node_id: row.node_id,
    value: JSON.parse(row.value_json) as number | null,
    unit: row.unit,
    quality: row.quality as Quality,
    device_timestamp: parseTimestamp(row.device_timestamp),
    received_at: parseTimestamp(row.received_at),
    time_source: row.time_source,
  };
}
