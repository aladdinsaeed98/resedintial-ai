/**
 * Alert persistence helpers: 30-minute occurrence window and a Phase C hook.
 *
 * The engine only says which faults are true right now. This file turns that
 * into open / reopen / clear mutations. A fault that clears and returns
 * inside same_occurrence_window_s is the same occurrence, not a new row.
 *
 * notifyAlert is intentionally empty until Phase C (ntfy / email / healthchecks).
 */

import { alertKey, type ProposedAlert } from "./engine";

export interface AlertRecord {
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
  detail: Record<string, unknown>;
}

export type AlertMutation =
  | { type: "create"; record: Omit<AlertRecord, "id"> }
  | {
      type: "update";
      id: string;
      lastSeenAt: Date;
      detail: Record<string, unknown>;
      severity: string;
      title: string;
    }
  | {
      type: "reopen";
      id: string;
      lastSeenAt: Date;
      occurrence: number;
      detail: Record<string, unknown>;
      rulesVersion: number;
      severity: string;
      title: string;
    }
  | { type: "clear"; id: string; clearedAt: Date };

export type AlertLifecycle = "opened" | "updated" | "reopened" | "cleared";

export interface AlertNotifyEvent {
  lifecycle: AlertLifecycle;
  ruleId: string;
  subject: string;
  severity: string;
  title: string;
}

/**
 * Phase C hook. Do not send ntfy, email, or healthchecks from here yet.
 * Ingest still returns { accepted } only; this never talks to devices.
 */
export function notifyAlert(_event: AlertNotifyEvent): void {
  // Phase C: ntfy, email, healthchecks, audit log.
}

export function latestByKey(records: readonly AlertRecord[]): Map<string, AlertRecord> {
  const map = new Map<string, AlertRecord>();
  for (const row of records) {
    const key = alertKey(row.ruleId, row.subject);
    const prev = map.get(key);
    if (!prev || row.lastSeenAt.getTime() > prev.lastSeenAt.getTime()) {
      map.set(key, row);
    }
  }
  return map;
}

/**
 * Compare currently-true faults to stored alerts.
 * `windowS` is rules.constants.same_occurrence_window_s (1800).
 */
export function diffAlerts(
  now: Date,
  existing: readonly AlertRecord[],
  proposed: readonly ProposedAlert[],
  windowS: number,
): AlertMutation[] {
  const latest = latestByKey(existing);
  const mutations: AlertMutation[] = [];
  const seen = new Set<string>();

  for (const item of proposed) {
    const key = alertKey(item.ruleId, item.subject);
    seen.add(key);
    const prev = latest.get(key);
    if (prev && prev.clearedAt === null) {
      mutations.push({
        type: "update",
        id: prev.id,
        lastSeenAt: now,
        detail: item.detail,
        severity: item.severity,
        title: item.title,
      });
      continue;
    }
    if (prev && prev.clearedAt !== null) {
      const sinceClear = (now.getTime() - prev.clearedAt.getTime()) / 1000;
      if (sinceClear < windowS) {
        mutations.push({
          type: "reopen",
          id: prev.id,
          lastSeenAt: now,
          occurrence: prev.occurrence + 1,
          detail: item.detail,
          rulesVersion: item.rulesVersion,
          severity: item.severity,
          title: item.title,
        });
        continue;
      }
    }
    mutations.push({
      type: "create",
      record: {
        ruleId: item.ruleId,
        subject: item.subject,
        rulesVersion: item.rulesVersion,
        severity: item.severity,
        title: item.title,
        systemName: item.systemName,
        openedAt: now,
        lastSeenAt: now,
        clearedAt: null,
        occurrence: 1,
        detail: item.detail,
      },
    });
  }

  for (const [key, prev] of latest) {
    if (prev.clearedAt !== null) continue;
    if (seen.has(key)) continue;
    mutations.push({ type: "clear", id: prev.id, clearedAt: now });
  }

  return mutations;
}

export function lifecycleFor(mutation: AlertMutation): AlertLifecycle {
  if (mutation.type === "create") return "opened";
  if (mutation.type === "reopen") return "reopened";
  if (mutation.type === "clear") return "cleared";
  return "updated";
}
