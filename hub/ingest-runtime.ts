/**
 * Where ingest writes. Prisma in production; a fake sink in tests.
 *
 * App Router POST /api/ingest calls getIngestSink(). Tests replace it with
 * an in-memory list so we can assert received_at without Postgres.
 */

import type { StoredReading } from "./models";
import { PrismaReadingStore } from "./prisma-store";
import { databaseConfigured, getPrisma } from "../lib/prisma";

export interface IngestSink {
  addMany(readings: StoredReading[]): Promise<number>;
  recordCollector(mqttConnected: boolean, at: Date): Promise<void>;
}

const GLOBAL_KEY = "__hvacIngestSink";

type GlobalSink = typeof globalThis & {
  [GLOBAL_KEY]?: IngestSink;
};

/** Tests inject a memory sink. Pass undefined to restore Prisma. */
export function setIngestSink(sink: IngestSink | undefined): void {
  const g = globalThis as GlobalSink;
  if (sink) {
    g[GLOBAL_KEY] = sink;
  } else {
    delete g[GLOBAL_KEY];
  }
}

export function getIngestSink(): IngestSink | null {
  const override = (globalThis as GlobalSink)[GLOBAL_KEY];
  if (override) {
    return override;
  }
  if (!databaseConfigured()) {
    return null;
  }
  return new PrismaReadingStore(getPrisma());
}

/** In-memory ingest target for Vitest. */
export class MemoryIngestSink implements IngestSink {
  readings: StoredReading[] = [];
  mqttConnected = false;
  lastIngestAt: Date | null = null;

  async addMany(readings: StoredReading[]): Promise<number> {
    this.readings.push(...readings);
    return readings.length;
  }

  async recordCollector(mqttConnected: boolean, at: Date): Promise<void> {
    this.mqttConnected = mqttConnected;
    this.lastIngestAt = at;
  }
}
