/**
 * Custom Node server: MQTT subscriber + Next.js HTTP on one process.
 *
 * Why this instead of a Next.js route handler or a separate worker:
 * - MQTT must be subscribed the moment the hub starts, before anyone opens
 *   the page. App Router handlers are request-scoped and can go idle.
 * - One process, one better-sqlite3 connection. WAL is enough; a second
 *   worker would also work, but then mqtt_connected has to be shared too.
 * - The live page and GET /api/readings stay App Router. This file only
 *   starts MQTT, then hands every GET/HEAD to Next.js.
 *
 * Write methods are rejected with 405 before Next.js sees them. The hub
 * never publishes on MQTT.
 *
 * Run: npm run hub   (production, after npm run build)
 *      npm run dev   (tsx server.ts --dev)
 */

import { createMonitorServer } from "./hub/http";
import { loadSettings } from "./hub/config";
import { startRuntime, stopRuntime } from "./hub/runtime";

async function main(): Promise<void> {
  const dev = process.argv.includes("--dev");

  const settings = loadSettings();
  const runtime = startRuntime({ settings, startMqtt: true });

  const { default: next } = await import("next");
  const app = next({
    dev,
    dir: process.cwd(),
    hostname: settings.host === "0.0.0.0" ? "localhost" : settings.host,
    port: settings.port,
  });
  const handle = app.getRequestHandler();
  await app.prepare();

  const server = createMonitorServer((req, res) => {
    void handle(req, res);
  });

  const shutdown = () => {
    stopRuntime(runtime);
    server.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  server.listen(settings.port, settings.host, () => {
    console.info(
      `Monitor-only hub listening on ${settings.host}:${settings.port}. Open http://127.0.0.1:${settings.port}`,
    );
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
