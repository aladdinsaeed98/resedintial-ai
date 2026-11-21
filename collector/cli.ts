/**
 * Local collector: subscribe to Mosquitto, forward HTTPS to Vercel.
 *
 * Run on the Windows PC (or Pi) next to the broker. Port 1883 stays LAN-only.
 * This process never publishes on MQTT and never opens an inbound port.
 *
 *   npm run collector
 *
 * Needs HUB_INGEST_URL and INGEST_SECRET in .env.local (or the environment).
 */

import fs from "node:fs";
import path from "node:path";

import { SystemClock } from "../hub/clock";
import { loadSettings } from "../hub/config";
import { MqttGateway } from "../hub/gateway";
import { PendingBuffer } from "./buffer";
import { flushOnce } from "./forwarder";

const FLUSH_MS = 2000;

/** Load .env.local without adding a dotenv dependency. Shell env wins. */
function loadDotEnvLocal(): void {
  const file = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) {
    return;
  }
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq < 1) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export async function main(): Promise<void> {
  loadDotEnvLocal();
  const settings = loadSettings();
  if (!settings.ingest_secret) {
    console.error("INGEST_SECRET is empty. Copy .env.example to .env.local and fill it in.");
    process.exit(1);
  }

  const buffer = new PendingBuffer(settings.database_path);
  const clock = new SystemClock();
  const gateway = new MqttGateway(settings, buffer, clock);
  gateway.connect();
  console.info(
    `Collector subscribed to ${gateway.subscribe_topic}. Forwarding to ${settings.ingest_url}. Never publishes.`,
  );

  const tick = async () => {
    const result = await flushOnce(buffer, {
      ingestUrl: settings.ingest_url,
      ingestSecret: settings.ingest_secret,
      mqttConnected: gateway.connected,
    });
    if (result.ok && result.accepted > 0) {
      console.info(`forwarded ${result.accepted} reading(s)`);
    } else if (!result.ok) {
      console.warn(`ingest retry (status ${result.status || "network"}) buffer=${buffer.size()}`);
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, FLUSH_MS);
  void tick();

  const shutdown = () => {
    clearInterval(timer);
    gateway.close();
    buffer.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
