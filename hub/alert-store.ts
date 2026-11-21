/**
 * Alert row store. Prisma in production; a memory list in tests.
 *
 * Same idea as ingest-runtime: tests inject MemoryAlertStore so engine
 * persistence can run without Postgres.
 */

import type { Prisma, PrismaClient } from "@prisma/client";

import {
  diffAlerts,
  lifecycleFor,
  notifyAlert,
  type AlertMutation,
  type AlertRecord,
} from "./alerts";
import type { ProposedAlert } from "./engine";
import { databaseConfigured, getPrisma } from "../lib/prisma";

export interface AlertStore {
  list(limit?: number): Promise<AlertRecord[]>;
  allLatest(): Promise<AlertRecord[]>;
  apply(mutations: AlertMutation[]): Promise<AlertRecord[]>;
}

const GLOBAL_KEY = "__hvacAlertStore";

type GlobalStore = typeof globalThis & {
  [GLOBAL_KEY]?: AlertStore;
};

export function setAlertStore(store: AlertStore | undefined): void {
  const g = globalThis as GlobalStore;
  if (store) {
    g[GLOBAL_KEY] = store;
  } else {
    delete g[GLOBAL_KEY];
  }
}

export function getAlertStore(): AlertStore | null {
  const override = (globalThis as GlobalStore)[GLOBAL_KEY];
  if (override) return override;
  if (!databaseConfigured()) return null;
  return new PrismaAlertStore(getPrisma());
}

function detailOf(value: Prisma.JsonValue): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function toRecord(row: {
  id: string;
  ruleId: string;
  subject: string;
  rulesVersion: number;
  severity: string;
  title: string;
  systemName: string;
  openedAt: Date;
  lastSeenAt: Date;
  clearedAt: Date | null;
  occurrence: number;
  detail: Prisma.JsonValue;
}): AlertRecord {
  return {
    id: row.id,
    ruleId: row.ruleId,
    subject: row.subject,
    rulesVersion: row.rulesVersion,
    severity: row.severity,
    title: row.title,
    systemName: row.systemName,
    openedAt: row.openedAt,
    lastSeenAt: row.lastSeenAt,
    clearedAt: row.clearedAt,
    occurrence: row.occurrence,
    detail: detailOf(row.detail),
  };
}

export class PrismaAlertStore implements AlertStore {
  constructor(private readonly prisma: PrismaClient) {}

  async list(limit = 50): Promise<AlertRecord[]> {
    const rows = await this.prisma.alert.findMany({
      orderBy: [{ clearedAt: "asc" }, { lastSeenAt: "desc" }],
      take: limit,
    });
    return rows.map(toRecord);
  }

  async allLatest(): Promise<AlertRecord[]> {
    const rows = await this.prisma.alert.findMany({
      orderBy: { lastSeenAt: "desc" },
    });
    return rows.map(toRecord);
  }

  async apply(mutations: AlertMutation[]): Promise<AlertRecord[]> {
    const out: AlertRecord[] = [];
    for (const mutation of mutations) {
      if (mutation.type === "create") {
        const row = await this.prisma.alert.create({
          data: {
            ruleId: mutation.record.ruleId,
            subject: mutation.record.subject,
            rulesVersion: mutation.record.rulesVersion,
            severity: mutation.record.severity,
            title: mutation.record.title,
            systemName: mutation.record.systemName,
            openedAt: mutation.record.openedAt,
            lastSeenAt: mutation.record.lastSeenAt,
            clearedAt: mutation.record.clearedAt,
            occurrence: mutation.record.occurrence,
            detail: mutation.record.detail as Prisma.InputJsonValue,
          },
        });
        out.push(toRecord(row));
        continue;
      }
      if (mutation.type === "update") {
        const row = await this.prisma.alert.update({
          where: { id: mutation.id },
          data: {
            lastSeenAt: mutation.lastSeenAt,
            detail: mutation.detail as Prisma.InputJsonValue,
            severity: mutation.severity,
            title: mutation.title,
          },
        });
        out.push(toRecord(row));
        continue;
      }
      if (mutation.type === "reopen") {
        const row = await this.prisma.alert.update({
          where: { id: mutation.id },
          data: {
            lastSeenAt: mutation.lastSeenAt,
            clearedAt: null,
            occurrence: mutation.occurrence,
            detail: mutation.detail as Prisma.InputJsonValue,
            rulesVersion: mutation.rulesVersion,
            severity: mutation.severity,
            title: mutation.title,
          },
        });
        out.push(toRecord(row));
        continue;
      }
      const row = await this.prisma.alert.update({
        where: { id: mutation.id },
        data: { clearedAt: mutation.clearedAt },
      });
      out.push(toRecord(row));
    }
    return out;
  }
}

export class MemoryAlertStore implements AlertStore {
  records: AlertRecord[] = [];
  private nextId = 1;

  async list(limit = 50): Promise<AlertRecord[]> {
    const sorted = [...this.records].sort((a, b) => {
      const aOpen = a.clearedAt === null ? 0 : 1;
      const bOpen = b.clearedAt === null ? 0 : 1;
      if (aOpen !== bOpen) return aOpen - bOpen;
      return b.lastSeenAt.getTime() - a.lastSeenAt.getTime();
    });
    return sorted.slice(0, limit);
  }

  async allLatest(): Promise<AlertRecord[]> {
    return [...this.records];
  }

  async apply(mutations: AlertMutation[]): Promise<AlertRecord[]> {
    const out: AlertRecord[] = [];
    for (const mutation of mutations) {
      if (mutation.type === "create") {
        const record: AlertRecord = { id: `a${this.nextId}`, ...mutation.record };
        this.nextId += 1;
        this.records.push(record);
        out.push(record);
        continue;
      }
      const idx = this.records.findIndex((row) => row.id === mutation.id);
      if (idx < 0) continue;
      if (mutation.type === "update") {
        const next = {
          ...this.records[idx],
          lastSeenAt: mutation.lastSeenAt,
          detail: mutation.detail,
          severity: mutation.severity,
          title: mutation.title,
        };
        this.records[idx] = next;
        out.push(next);
        continue;
      }
      if (mutation.type === "reopen") {
        const next = {
          ...this.records[idx],
          lastSeenAt: mutation.lastSeenAt,
          clearedAt: null,
          occurrence: mutation.occurrence,
          detail: mutation.detail,
          rulesVersion: mutation.rulesVersion,
          severity: mutation.severity,
          title: mutation.title,
        };
        this.records[idx] = next;
        out.push(next);
        continue;
      }
      const next = { ...this.records[idx], clearedAt: mutation.clearedAt };
      this.records[idx] = next;
      out.push(next);
    }
    return out;
  }
}

export async function persistProposed(
  store: AlertStore,
  now: Date,
  proposed: readonly ProposedAlert[],
  windowS: number,
  readingWindow?: unknown,
): Promise<AlertMutation[]> {
  const existing = await store.allLatest();
  const mutations = diffAlerts(now, existing, proposed, windowS);
  if (mutations.length === 0) return [];
  const applied = await store.apply(mutations);
  for (const mutation of mutations) {
    const ruleId =
      mutation.type === "create" ? mutation.record.ruleId : (existing.find((row) => row.id === mutation.id)?.ruleId ?? "");
    const subject =
      mutation.type === "create"
        ? mutation.record.subject
        : (existing.find((row) => row.id === mutation.id)?.subject ?? "");
    const severity =
      mutation.type === "create"
        ? mutation.record.severity
        : mutation.type === "clear"
          ? (existing.find((row) => row.id === mutation.id)?.severity ?? "")
          : mutation.severity;
    const title =
      mutation.type === "create"
        ? mutation.record.title
        : mutation.type === "clear"
          ? (existing.find((row) => row.id === mutation.id)?.title ?? "")
          : mutation.title;
    notifyAlert({
      lifecycle: lifecycleFor(mutation),
      ruleId,
      subject,
      severity,
      title,
    });
  }

  // Capture incident snapshots on create/reopen (append-only). Failures never
  // block alert persistence or ingest { accepted }.
  try {
    const { getIncidentStore } = await import("./ask/incidents");
    const incidents = getIncidentStore();
    if (incidents && readingWindow !== undefined) {
      for (const mutation of mutations) {
        if (mutation.type !== "create" && mutation.type !== "reopen") continue;
        const record =
          mutation.type === "reopen"
            ? applied.find((row) => row.id === mutation.id)
            : applied.find(
                (row) =>
                  row.ruleId === mutation.record.ruleId &&
                  row.subject === mutation.record.subject &&
                  row.clearedAt === null,
              );
        if (!record) continue;
        await incidents.save({
          alertId: record.id,
          ruleId: record.ruleId,
          subject: record.subject,
          openedAt: record.lastSeenAt,
          readings: readingWindow,
        });
      }
    }
  } catch (error) {
    console.error("incident snapshot failed", error);
  }

  return mutations;
}
