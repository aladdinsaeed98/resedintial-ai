/**
 * Postgres reading log used by the Vercel app.
 *
 * Same nouns as the SQLite store the tests and collector buffer use.
 * latestMap is the only query the live page needs. Writes are ingest only.
 */

import type { PrismaClient } from "@prisma/client";

import type { StoredReading } from "./models";
import { Quality } from "./models";

export class PrismaReadingStore {
  constructor(private readonly prisma: PrismaClient) {}

  async add(reading: StoredReading): Promise<void> {
    await this.prisma.reading.create({
      data: {
        pointId: reading.point_id,
        nodeId: reading.node_id,
        value: reading.value,
        unit: reading.unit,
        quality: reading.quality,
        deviceTimestamp: reading.device_timestamp,
        receivedAt: reading.received_at,
        timeSource: reading.time_source,
      },
    });
  }

  async addMany(readings: StoredReading[]): Promise<number> {
    if (readings.length === 0) {
      return 0;
    }
    const result = await this.prisma.reading.createMany({
      data: readings.map((reading) => ({
        pointId: reading.point_id,
        nodeId: reading.node_id,
        value: reading.value,
        unit: reading.unit,
        quality: reading.quality,
        deviceTimestamp: reading.device_timestamp,
        receivedAt: reading.received_at,
        timeSource: reading.time_source,
      })),
    });
    return result.count;
  }

  async latest(pointId: string): Promise<StoredReading | null> {
    const row = await this.prisma.reading.findFirst({
      where: { pointId },
      orderBy: { id: "desc" },
    });
    return row ? toReading(row) : null;
  }

  async latestMap(): Promise<Record<string, StoredReading>> {
    const grouped = await this.prisma.reading.groupBy({
      by: ["pointId"],
      _max: { id: true },
    });
    const ids = grouped
      .map((row) => row._max.id)
      .filter((id): id is number => id !== null);
    if (ids.length === 0) {
      return {};
    }
    const rows = await this.prisma.reading.findMany({
      where: { id: { in: ids } },
    });
    const out: Record<string, StoredReading> = {};
    for (const row of rows) {
      out[row.pointId] = toReading(row);
    }
    return out;
  }

  async recordCollector(mqttConnected: boolean, at: Date): Promise<void> {
    await this.prisma.collectorStatus.upsert({
      where: { id: 1 },
      create: { id: 1, mqttConnected, lastIngestAt: at },
      update: { mqttConnected, lastIngestAt: at },
    });
  }

  async collectorStatus(): Promise<{ mqttConnected: boolean; lastIngestAt: Date } | null> {
    return this.prisma.collectorStatus.findUnique({ where: { id: 1 } });
  }
}

function toReading(row: {
  pointId: string;
  nodeId: string;
  value: number | null;
  unit: string;
  quality: string;
  deviceTimestamp: Date;
  receivedAt: Date;
  timeSource: string;
}): StoredReading {
  return {
    point_id: row.pointId,
    node_id: row.nodeId,
    value: row.value,
    unit: row.unit,
    quality: row.quality as Quality,
    device_timestamp: row.deviceTimestamp,
    received_at: row.receivedAt,
    time_source: row.timeSource,
  };
}
