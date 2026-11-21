/**
 * Process-wide hub runtime: one store, one MQTT gateway, one clock.
 *
 * Next.js App Router can evaluate modules more than once (dev HMR, a custom
 * server plus a bundled route). We keep the live objects on globalThis so
 * GET /api/readings and the MQTT subscriber share the same SQLite connection.
 *
 * server.ts calls startRuntime() before listening. Tests call createRuntime()
 * with startMqtt=false and a temp database.
 */

import type { Clock } from "./clock";
import { SystemClock } from "./clock";
import type { Settings } from "./config";
import { loadSettings } from "./config";
import { MqttGateway } from "./gateway";
import { ReadingStore } from "./store";

export interface HubRuntime {
  settings: Settings;
  store: ReadingStore;
  clock: Clock;
  gateway: MqttGateway;
  ownsStore: boolean;
}

export interface RuntimeOptions {
  settings?: Settings;
  store?: ReadingStore;
  clock?: Clock;
  startMqtt?: boolean;
}

const GLOBAL_KEY = "__hvacHubRuntime";

type GlobalRuntime = typeof globalThis & {
  [GLOBAL_KEY]?: HubRuntime;
};

/** Build a runtime. Does not store it globally unless startRuntime() is used. */
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

/** Start (or reuse) the process-wide runtime and subscribe to MQTT. */
export function startRuntime(options: RuntimeOptions = {}): HubRuntime {
  const g = globalThis as GlobalRuntime;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = createRuntime({ startMqtt: true, ...options });
  }
  return g[GLOBAL_KEY];
}

/** The runtime the App Router routes use. Lazily starts MQTT if needed. */
export function getRuntime(): HubRuntime {
  const g = globalThis as GlobalRuntime;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = createRuntime({ startMqtt: true });
  }
  return g[GLOBAL_KEY];
}

/** Tests inject a ManualClock and a temp database through this. */
export function setRuntime(runtime: HubRuntime | undefined): void {
  const g = globalThis as GlobalRuntime;
  if (runtime) {
    g[GLOBAL_KEY] = runtime;
  } else {
    delete g[GLOBAL_KEY];
  }
}

/** Disconnect MQTT and close SQLite when this process owns them. */
export function stopRuntime(runtime?: HubRuntime): void {
  const g = globalThis as GlobalRuntime;
  const current = runtime ?? g[GLOBAL_KEY];
  if (!current) {
    return;
  }
  current.gateway.close();
  if (current.ownsStore) {
    current.store.close();
  }
  if (!runtime || current === g[GLOBAL_KEY]) {
    delete g[GLOBAL_KEY];
  }
}
