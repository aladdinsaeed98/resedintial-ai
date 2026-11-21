/**
 * Evaluate committed rules against the reading log, then persist alerts.
 *
 * Called from POST /api/ingest (after store), GET /api/cron/rules, and
 * lazily from GET /api/alerts (30 s throttle). Failures are swallowed by
 * ingest so it still returns { accepted }.
 * Alerts never go back to devices.
 */

import { persistProposed, getAlertStore } from "./alert-store";
import { serializeReadingWindow } from "./ask/incidents";
import { loadSettings } from "./config";
import { evaluate, historyWindowSeconds } from "./engine";
import { PrismaReadingStore } from "./prisma-store";
import { loadLedCodes, loadRules } from "./rules";
import { databaseConfigured, getPrisma } from "../lib/prisma";

export interface RulesRunResult {
  evaluated: boolean;
  active: number;
  mutations: number;
}

const LAZY_EVAL_MS = 30_000;
let lastEvalMs = 0;

/** Tests reset the 30 s GET /api/alerts throttle. */
export function resetRulesEvalThrottle(): void {
  lastEvalMs = 0;
}

/**
 * Same as runRulesNow, but at most once per minIntervalMs.
 * GET /api/alerts uses this so opening the screen is current without
 * evaluating on every 5 s poll.
 */
export async function runRulesIfDue(
  now: Date,
  minIntervalMs: number = LAZY_EVAL_MS,
): Promise<RulesRunResult | { skipped: true }> {
  if (now.getTime() - lastEvalMs < minIntervalMs) {
    return { skipped: true };
  }
  lastEvalMs = now.getTime();
  return runRulesNow(now);
}

export async function runRulesNow(now: Date): Promise<RulesRunResult> {
  const alertStore = getAlertStore();
  if (!alertStore) {
    return { evaluated: false, active: 0, mutations: 0 };
  }

  const settings = loadSettings();
  const rules = loadRules();
  const ledCodes = loadLedCodes();
  const series = await loadSeries(now, historyWindowSeconds(rules));
  const result = evaluate({
    now,
    systemName: settings.system_name,
    installed: settings.points,
    series,
    rules,
    ledCodes,
    staleAfterSeconds: settings.stale_after_seconds,
  });
  const mutations = await persistProposed(
    alertStore,
    now,
    result.active,
    rules.constants.same_occurrence_window_s,
    serializeReadingWindow(series),
  );
  return { evaluated: true, active: result.active.length, mutations: mutations.length };
}

const SERIES_KEY = "__hvacReadingSeries";

type GlobalSeries = typeof globalThis & {
  [SERIES_KEY]?: () => Promise<import("./models").StoredReading[]>;
};

/** Tests inject a reading series so cron/ingest eval can run without Postgres. */
export function setReadingSeriesLoader(
  loader: (() => Promise<import("./models").StoredReading[]>) | undefined,
): void {
  const g = globalThis as GlobalSeries;
  if (loader) g[SERIES_KEY] = loader;
  else delete g[SERIES_KEY];
}

async function loadSeries(now: Date, windowS: number): Promise<import("./models").StoredReading[]> {
  const override = (globalThis as GlobalSeries)[SERIES_KEY];
  if (override) return override();
  if (!databaseConfigured()) return [];
  const store = new PrismaReadingStore(getPrisma());
  const since = new Date(now.getTime() - windowS * 1000);
  return store.historySince(since);
}
