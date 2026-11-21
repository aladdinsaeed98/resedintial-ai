/**
 * Incident snapshots: when an alert opens, store the nearby readings window.
 * Read + append only. Never commands equipment.
 */

import type { Prisma, PrismaClient } from "@prisma/client";

import { databaseConfigured, getPrisma } from "../../lib/prisma";
import type { StoredReading } from "../models";

export interface IncidentSnapshotRecord {
  id: string;
  alertId: string;
  ruleId: string;
  subject: string;
  openedAt: Date;
  readings: unknown;
  createdAt: Date;
}

export interface IncidentStore {
  save(input: {
    alertId: string;
    ruleId: string;
    subject: string;
    openedAt: Date;
    readings: unknown;
  }): Promise<IncidentSnapshotRecord>;
  listRecent(limit?: number): Promise<IncidentSnapshotRecord[]>;
  listForAlert(alertId: string): Promise<IncidentSnapshotRecord[]>;
}

const GLOBAL_KEY = "__hvacIncidentStore";

type GlobalStore = typeof globalThis & {
  [GLOBAL_KEY]?: IncidentStore;
};

export function setIncidentStore(store: IncidentStore | undefined): void {
  const g = globalThis as GlobalStore;
  if (store) g[GLOBAL_KEY] = store;
  else delete g[GLOBAL_KEY];
}

export function getIncidentStore(): IncidentStore | null {
  const override = (globalThis as GlobalStore)[GLOBAL_KEY];
  if (override) return override;
  if (!databaseConfigured()) return null;
  return new PrismaIncidentStore(getPrisma());
}

export class PrismaIncidentStore implements IncidentStore {
  constructor(private readonly prisma: PrismaClient) {}

  async save(input: {
    alertId: string;
    ruleId: string;
    subject: string;
    openedAt: Date;
    readings: unknown;
  }): Promise<IncidentSnapshotRecord> {
    const row = await this.prisma.incidentSnapshot.create({
      data: {
        alertId: input.alertId,
        ruleId: input.ruleId,
        subject: input.subject,
        openedAt: input.openedAt,
        readings: input.readings as Prisma.InputJsonValue,
      },
    });
    return row;
  }

  async listRecent(limit = 10): Promise<IncidentSnapshotRecord[]> {
    return this.prisma.incidentSnapshot.findMany({
      orderBy: { openedAt: "desc" },
      take: limit,
    });
  }

  async listForAlert(alertId: string): Promise<IncidentSnapshotRecord[]> {
    return this.prisma.incidentSnapshot.findMany({
      where: { alertId },
      orderBy: { openedAt: "desc" },
    });
  }
}

export class MemoryIncidentStore implements IncidentStore {
  rows: IncidentSnapshotRecord[] = [];
  private next = 1;

  async save(input: {
    alertId: string;
    ruleId: string;
    subject: string;
    openedAt: Date;
    readings: unknown;
  }): Promise<IncidentSnapshotRecord> {
    const row: IncidentSnapshotRecord = {
      id: `i${this.next++}`,
      alertId: input.alertId,
      ruleId: input.ruleId,
      subject: input.subject,
      openedAt: input.openedAt,
      readings: input.readings,
      createdAt: new Date(),
    };
    this.rows.unshift(row);
    return row;
  }

  async listRecent(limit = 10): Promise<IncidentSnapshotRecord[]> {
    return this.rows.slice(0, limit);
  }

  async listForAlert(alertId: string): Promise<IncidentSnapshotRecord[]> {
    return this.rows.filter((row) => row.alertId === alertId);
  }
}

/** Compact reading window for storage next to an alert open. */
export function serializeReadingWindow(
  series: readonly StoredReading[],
): Array<Record<string, unknown>> {
  return series.slice(-200).map((row) => ({
    point_id: row.point_id,
    node_id: row.node_id,
    value: row.value,
    unit: row.unit,
    quality: row.quality,
    device_timestamp: row.device_timestamp.toISOString(),
    received_at: row.received_at.toISOString(),
  }));
}
