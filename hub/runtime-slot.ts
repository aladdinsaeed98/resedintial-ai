/**
 * Test-only runtime slot on globalThis.
 *
 * App Router files import getRuntime from here so Vercel never pulls
 * better-sqlite3 or mqtt.js into the serverless bundle. Tests still call
 * setRuntime() with a SQLite store and a ManualClock.
 */

import type { HubRuntime } from "./runtime-types";

const GLOBAL_KEY = "__hvacHubRuntime";

type GlobalRuntime = typeof globalThis & {
  [GLOBAL_KEY]?: HubRuntime;
};

/** Tests inject a ManualClock and a temp database through this. */
export function setRuntime(runtime: HubRuntime | undefined): void {
  const g = globalThis as GlobalRuntime;
  if (runtime) {
    g[GLOBAL_KEY] = runtime;
  } else {
    delete g[GLOBAL_KEY];
  }
}

/** Injected runtime, or undefined in production on Vercel. */
export function getRuntime(): HubRuntime | undefined {
  return (globalThis as GlobalRuntime)[GLOBAL_KEY];
}

export function clearRuntime(): void {
  delete (globalThis as GlobalRuntime)[GLOBAL_KEY];
}
