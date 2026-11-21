/**
 * Local retry queue for the collector.
 *
 * MQTT samples land here first, then the forwarder POSTs them to Vercel.
 * If the house internet is down, rows stay until the next successful ingest.
 * This file lives on the Windows PC; it is not the cloud database.
 */

import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import type { StoredReading } from "../hub/models";
import { Quality } from "../hub/models";
import { formatTimestamp, parseTimestamp } from "../hub/clock";

interface PendingRow {
  id: number;
  payload_json: string;
}

export interface PendingItem {
  id: number;
  reading: StoredReading;
}

export class PendingBuffer {
  readonly path: string;
  private readonly db: Database.Database;
  private readonly insertStmt: Database.Statement;
  private readonly takeStmt: Database.Statement;
  private readonly deleteStmt: Database.Statement;
  private readonly countStmt: Database.Statement;

  constructor(dbPath: string) {
    this.path = dbPath;
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pending (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        payload_json TEXT NOT NULL
      )
    `);
    this.insertStmt = this.db.prepare("INSERT INTO pending (payload_json) VALUES (?)");
    this.takeStmt = this.db.prepare("SELECT id, payload_json FROM pending ORDER BY id ASC LIMIT ?");
    this.deleteStmt = this.db.prepare("DELETE FROM pending WHERE id = ?");
    this.countStmt = this.db.prepare("SELECT COUNT(*) AS n FROM pending");
  }

  /** Same shape as ReadingStore.add so MqttGateway can write here. */
  add(reading: StoredReading): void {
    this.insertStmt.run(JSON.stringify(serialize(reading)));
  }

  takeBatch(limit: number): PendingItem[] {
    const rows = this.takeStmt.all(limit) as PendingRow[];
    return rows.map((row) => ({
      id: row.id,
      reading: deserialize(JSON.parse(row.payload_json) as Record<string, unknown>),
    }));
  }

  remove(ids: number[]): void {
    const del = this.db.transaction((list: number[]) => {
      for (const id of list) {
        this.deleteStmt.run(id);
      }
    });
    del(ids);
  }

  size(): number {
    const row = this.countStmt.get() as { n: number };
    return row.n;
  }

  latest(_pointId: string): StoredReading | null {
    return null;
  }

  latestMap(): Record<string, StoredReading> {
    return {};
  }

  close(): void {
    this.db.close();
  }
}

function serialize(reading: StoredReading): Record<string, unknown> {
  return {
    point_id: reading.point_id,
    node_id: reading.node_id,
    value: reading.value,
    unit: reading.unit,
    quality: reading.quality,
    device_timestamp: formatTimestamp(reading.device_timestamp),
    received_at: formatTimestamp(reading.received_at),
    time_source: reading.time_source,
  };
}

function deserialize(row: Record<string, unknown>): StoredReading {
  return {
    point_id: String(row.point_id),
    node_id: String(row.node_id),
    value: (row.value as number | null) ?? null,
    unit: String(row.unit),
    quality: row.quality as Quality,
    device_timestamp: parseTimestamp(String(row.device_timestamp)),
    received_at: parseTimestamp(String(row.received_at)),
    time_source: String(row.time_source),
  };
}
