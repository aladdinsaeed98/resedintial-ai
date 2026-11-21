/**
 * Test/local helper that builds a SQLite store + MQTT gateway.
 *
 * The Vercel app does not call createRuntime(). Production GET /api/readings
 * talks to Prisma. Tests call setRuntime() so the route handlers reuse the
 * same ManualClock and temp database as the Phase 1 suite.
 *
 * This module must never start MQTT on its own — that would try to connect
 * from a serverless function.
 */

import type { Clock } from "./clock";
import { SystemClock } from "./clock";
import type { Settings } from "./config";
import { loadSettings } from "./config";
import { MqttGateway } from "./gateway";
import { clearRuntime, getRuntime, setRuntime } from "./runtime-slot";
import type { HubRuntime } from "./runtime-types";
import { ReadingStore } from "./store";

export type { HubRuntime } from "./runtime-types";
export { getRuntime, setRuntime };

export interface RuntimeOptions {
  settings?: Settings;
  store?: ReadingStore;
  clock?: Clock;
  startMqtt?: boolean;
}

/** Build a runtime. Tests pass startMqtt=false. */
export function createRuntime(options: RuntimeOptions = {}): HubRuntime {
  const settings = options.settings ?? loadSettings();
  const clock = options.clock ?? new SystemClock();
  const ownsStore = options.store === undefined;
  const store = options.store ?? new ReadingStore(settings.database_path);
  const gateway = new MqttGateway(settings, store, clock);
  if (options.startMqtt) {
    gateway.connect();
  }
  return { settings, store, clock, gateway, ownsStore };
}

/** Disconnect MQTT and close SQLite when this process owns them. */
export function stopRuntime(runtime?: HubRuntime): void {
  const current = runtime ?? getRuntime();
  if (!current) {
    return;
  }
  current.gateway.close();
  if (current.ownsStore) {
    current.store.close();
  }
  if (!runtime || current === getRuntime()) {
    clearRuntime();
  }
}
