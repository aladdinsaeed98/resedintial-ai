/**
 * Cloud split: ingest secret, Clerk on the dashboard, collector retry.
 *
 * These sit on top of the original 19 Phase 1 cases. They prove Vercel can
 * store readings without talking MQTT, and that the collector never publishes.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, expect, test } from "vitest";

import { POST as ingestPost } from "../app/api/ingest/route";
import { GET as getReadings } from "../app/api/readings/route";
import { PendingBuffer } from "../collector/buffer";
import { flushOnce } from "../collector/forwarder";
import { clerkKeysConfigured } from "../hub/clerk-keys";
import { loadSettings } from "../hub/config";
import { verifyIngestSecret } from "../hub/auth";
import { MemoryIngestSink, setIngestSink } from "../hub/ingest-runtime";
import { publicSnapshotFromMap } from "../hub/live";
import { Quality, type StoredReading } from "../hub/models";
import { setAuthLookup } from "../hub/session";
import { setRuntime } from "../hub/runtime-slot";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const START = new Date("2026-10-17T12:00:00Z");
const SECRET = "test-ingest-secret-value";

const savedEnv: Record<string, string | undefined> = {};

function setEnv(key: string, value: string | undefined): void {
  if (!(key in savedEnv)) {
    savedEnv[key] = process.env[key];
  }
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

afterEach(() => {
  setIngestSink(undefined);
  setAuthLookup(undefined);
  setRuntime(undefined);
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
    delete savedEnv[key];
  }
});

function sampleReading(): Record<string, unknown> {
  return {
    point: "return_air_temp",
    node_id: "bench",
    value: 72.4,
    unit: "F",
    timestamp: "2026-10-17T12:00:00Z",
    quality: "good",
  };
}

function ingestRequest(headers: Record<string, string>, body: unknown): Request {
  return new Request("http://localhost:3000/api/ingest", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

test("ingest rejects a missing or bad secret", async () => {
  setEnv("INGEST_SECRET", SECRET);
  const sink = new MemoryIngestSink();
  setIngestSink(sink);

  const missing = await ingestPost(ingestRequest({}, { readings: [sampleReading()] }));
  expect(missing.status).toBe(401);
  expect(await missing.json()).toEqual({ error: "missing ingest secret" });

  const bad = await ingestPost(
    ingestRequest({ authorization: "Bearer wrong-secret-value-xxx" }, { readings: [sampleReading()] }),
  );
  expect(bad.status).toBe(401);
  expect(await bad.json()).toEqual({ error: "invalid ingest secret" });
  expect(sink.readings).toHaveLength(0);

  expect(verifyIngestSecret(null, SECRET).ok).toBe(false);
  expect(verifyIngestSecret("Bearer " + SECRET, SECRET).ok).toBe(true);
});

test("ingest stores a valid reading with received_at", async () => {
  setEnv("INGEST_SECRET", SECRET);
  const sink = new MemoryIngestSink();
  setIngestSink(sink);
  const before = Date.now();

  const response = await ingestPost(
    ingestRequest({ authorization: `Bearer ${SECRET}` }, { readings: [sampleReading()], mqtt_connected: true }),
  );
  expect(response.status).toBe(200);
  const json = (await response.json()) as Record<string, unknown>;
  expect(json).toEqual({ accepted: 1 });
  expect(json.command).toBeUndefined();

  expect(sink.readings).toHaveLength(1);
  const stored = sink.readings[0];
  expect(stored.point_id).toBe("return_air_temp");
  expect(stored.value).toBeCloseTo(72.4);
  expect(stored.received_at.getTime()).toBeGreaterThanOrEqual(before - 1000);
  expect(stored.received_at.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  expect(sink.mqttConnected).toBe(true);
  expect(sink.lastIngestAt).not.toBeNull();
});

test("dashboard route without a Clerk session is 401", async () => {
  setEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_" + "a".repeat(24));
  setEnv("CLERK_SECRET_KEY", "sk_test_" + "b".repeat(24));
  expect(clerkKeysConfigured()).toBe(true);
  setAuthLookup(async () => ({ userId: null }));

  const response = await getReadings();
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: "unauthorized" });
});

test("stale hiding still works from database-shaped data", () => {
  const settings = loadSettings({});
  const now = new Date(START.getTime() + 120_000);
  const latest: Record<string, StoredReading> = {
    return_air_temp: {
      point_id: "return_air_temp",
      node_id: "bench",
      value: 72.4,
      unit: "F",
      quality: Quality.GOOD,
      device_timestamp: START,
      received_at: START,
      time_source: "hub",
    },
    supply_air_temp: {
      point_id: "supply_air_temp",
      node_id: "bench",
      value: 56.2,
      unit: "F",
      quality: Quality.GOOD,
      device_timestamp: START,
      received_at: START,
      time_source: "hub",
    },
  };
  const snap = publicSnapshotFromMap(settings, latest, now);
  const text = JSON.stringify(snap);
  expect(snap.points[0].status).toBe("stale");
  expect(snap.points[0].value).toBeNull();
  expect(text).not.toContain("72.4");
  expect(text).not.toContain("56.2");

  const liveNow = publicSnapshotFromMap(settings, latest, START);
  expect(liveNow.points[0].status).toBe("live");
  expect(liveNow.points[0].value).toBeCloseTo(72.4);
});

test("collector forwards, retries when offline, and never publishes", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hvac-collector-"));
  const buffer = new PendingBuffer(path.join(tmp, "pending.db"));
  try {
    buffer.add({
      point_id: "return_air_temp",
      node_id: "bench",
      value: 72.4,
      unit: "F",
      quality: Quality.GOOD,
      device_timestamp: START,
      received_at: START,
      time_source: "hub",
    });
    expect(buffer.size()).toBe(1);

    const failed = await flushOnce(buffer, {
      ingestUrl: "https://example.invalid/api/ingest",
      ingestSecret: SECRET,
      mqttConnected: true,
      fetchImpl: async () => {
        throw new Error("offline");
      },
    });
    expect(failed.ok).toBe(false);
    expect(failed.retried).toBe(true);
    expect(buffer.size()).toBe(1);

    let postedBody = "";
    const ok = await flushOnce(buffer, {
      ingestUrl: "https://example.test/api/ingest",
      ingestSecret: SECRET,
      mqttConnected: true,
      fetchImpl: async (_url, init) => {
        postedBody = init.body;
        return {
          ok: true,
          status: 200,
          json: async () => ({ accepted: 1, command: "off", setpoint: 60 }),
        };
      },
    });
    expect(ok.ok).toBe(true);
    expect(ok.accepted).toBe(1);
    expect(buffer.size()).toBe(0);
    const sent = JSON.parse(postedBody) as { readings: unknown[]; command?: unknown };
    expect(sent.readings).toHaveLength(1);
    expect(sent.command).toBeUndefined();
  } finally {
    buffer.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  const gateway = fs.readFileSync(path.join(REPO, "hub", "gateway.ts"), "utf8");
  expect(gateway).not.toContain("this.client.publish");
  expect(gateway).not.toContain("client.publish(");
  const collector = [
    fs.readFileSync(path.join(REPO, "collector", "cli.ts"), "utf8"),
    fs.readFileSync(path.join(REPO, "collector", "forwarder.ts"), "utf8"),
    fs.readFileSync(path.join(REPO, "server.ts"), "utf8"),
  ].join("\n");
  expect(collector).not.toContain(".publish(");
  expect(collector).toContain("Never publishes");
});
