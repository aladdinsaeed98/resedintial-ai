/**
 * Alerts HTTP surface: Clerk on GET, 405 on writes, cron secret on the tick.
 */

import { afterEach, expect, test } from "vitest";

import { GET as getAlerts, POST as postAlerts } from "../app/api/alerts/route";
import { GET as cronGet } from "../app/api/cron/rules/route";
import { POST as ingestPost } from "../app/api/ingest/route";
import { POST as postReadings } from "../app/api/readings/route";
import { MemoryAlertStore, setAlertStore } from "../hub/alert-store";
import { clerkKeysConfigured } from "../hub/clerk-keys";
import { MemoryIngestSink, setIngestSink } from "../hub/ingest-runtime";
import { setReadingSeriesLoader } from "../hub/rules-runner";
import { setAuthLookup } from "../hub/session";

const SECRET = "test-ingest-secret-value";
const CRON = "test-cron-secret-value";

const savedEnv: Record<string, string | undefined> = {};

function setEnv(key: string, value: string | undefined): void {
  if (!(key in savedEnv)) savedEnv[key] = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

afterEach(() => {
  setAlertStore(undefined);
  setIngestSink(undefined);
  setReadingSeriesLoader(undefined);
  setAuthLookup(undefined);
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
    delete savedEnv[key];
  }
});

test("cron route rejects requests without CRON_SECRET", async () => {
  setEnv("CRON_SECRET", CRON);
  const missing = await cronGet(new Request("http://localhost:3000/api/cron/rules"));
  expect(missing.status).toBe(401);
  expect(await missing.json()).toEqual({ error: "missing cron secret" });

  const bad = await cronGet(
    new Request("http://localhost:3000/api/cron/rules", {
      headers: { authorization: "Bearer wrong-cron-secret-xxx" },
    }),
  );
  expect(bad.status).toBe(401);
  expect(await bad.json()).toEqual({ error: "invalid cron secret" });

  setEnv("CRON_SECRET", "");
  const unconfigured = await cronGet(
    new Request("http://localhost:3000/api/cron/rules", {
      headers: { authorization: `Bearer ${CRON}` },
    }),
  );
  expect(unconfigured.status).toBe(503);
});

test("cron with a valid secret evaluates without returning a command", async () => {
  setEnv("CRON_SECRET", CRON);
  setAlertStore(new MemoryAlertStore());
  setReadingSeriesLoader(async () => []);
  const response = await cronGet(
    new Request("http://localhost:3000/api/cron/rules", {
      headers: { authorization: `Bearer ${CRON}` },
    }),
  );
  expect(response.status).toBe(200);
  const json = (await response.json()) as Record<string, unknown>;
  expect(json.ok).toBe(true);
  expect(json.command).toBeUndefined();
});

test("writes to /api/readings and /api/alerts return 405", async () => {
  const readings = await postReadings();
  expect(readings.status).toBe(405);
  expect(readings.headers.get("allow")).toBe("GET, HEAD");

  const alerts = await postAlerts();
  expect(alerts.status).toBe(405);
  expect(alerts.headers.get("allow")).toBe("GET, HEAD");
});

test("GET /api/alerts requires a Clerk session when keys are real", async () => {
  setEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_" + "a".repeat(24));
  setEnv("CLERK_SECRET_KEY", "sk_test_" + "b".repeat(24));
  expect(clerkKeysConfigured()).toBe(true);
  setAuthLookup(async () => ({ userId: null }));
  const response = await getAlerts();
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: "unauthorized" });
});

test("ingest still returns only { accepted } after rules run", async () => {
  setEnv("INGEST_SECRET", SECRET);
  setIngestSink(new MemoryIngestSink());
  setAlertStore(new MemoryAlertStore());
  setReadingSeriesLoader(async () => []);
  const response = await ingestPost(
    new Request("http://localhost:3000/api/ingest", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` },
      body: JSON.stringify({
        readings: [
          {
            point: "return_air_temp",
            node_id: "bench",
            value: 72.4,
            unit: "F",
            timestamp: "2026-11-21T12:00:00Z",
            quality: "good",
          },
        ],
        mqtt_connected: true,
      }),
    }),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ accepted: 1 });
});
