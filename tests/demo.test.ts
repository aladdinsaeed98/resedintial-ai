/**
 * Demo mode: realistic fake data locally, hard-blocked in production.
 */

import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, test } from "vitest";

import { GET as getAlerts } from "../app/api/alerts/route";
import { GET as getHistory } from "../app/api/history/route";
import { GET as getReadings } from "../app/api/readings/route";
import { loadSettings } from "../hub/config";
import {
  demoAlertsPayload,
  demoHistoryPayload,
  demoReadingsPayload,
  isDemoMode,
} from "../hub/demo";

const savedEnv: Record<string, string | undefined> = {};

function setEnv(key: string, value: string | undefined): void {
  if (!(key in savedEnv)) savedEnv[key] = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
    delete savedEnv[key];
  }
});

test("demo mode is off by default", () => {
  setEnv("HVAC_DEMO", undefined);
  setEnv("NODE_ENV", "development");
  setEnv("VERCEL_ENV", undefined);
  expect(isDemoMode()).toBe(false);
});

test("demo mode is blocked in production even when HVAC_DEMO=1", () => {
  setEnv("HVAC_DEMO", "1");
  setEnv("NODE_ENV", "production");
  setEnv("VERCEL_ENV", undefined);
  expect(isDemoMode()).toBe(false);

  setEnv("NODE_ENV", "development");
  setEnv("VERCEL_ENV", "production");
  expect(isDemoMode()).toBe(false);
});

test("demo mode enables only when HVAC_DEMO=1 outside production", () => {
  setEnv("HVAC_DEMO", "1");
  setEnv("NODE_ENV", "development");
  setEnv("VERCEL_ENV", "preview");
  expect(isDemoMode()).toBe(true);
});

test("demo readings cover every points.json sensor with live values", () => {
  const settings = loadSettings({});
  const body = demoReadingsPayload(new Date("2026-11-21T12:00:00Z"), settings);
  expect(body.demo).toBe(true);
  expect(body.mqtt_connected).toBe(true);
  expect(body.points.map((point) => point.point_id)).toEqual(
    settings.points.map((point) => point.id),
  );
  for (const point of body.points) {
    expect(point.status).toBe("live");
    expect(typeof point.value).toBe("number");
    expect(point.plain_label).toBeTruthy();
    expect(point.description).toBeTruthy();
  }
});

test("demo alerts include one active warning and one cleared alert", () => {
  const body = demoAlertsPayload(new Date("2026-11-21T12:00:00Z"));
  expect(body.demo).toBe(true);
  expect(body.active_count).toBe(1);
  expect(body.alerts).toHaveLength(2);
  expect(body.alerts.filter((row) => row.cleared_at === null)).toHaveLength(1);
  expect(body.alerts.filter((row) => row.cleared_at !== null)).toHaveLength(1);
  expect(body.alerts.every((row) => row.hint.length > 10)).toBe(true);
});

test("demo history returns sortable rows", () => {
  const body = demoHistoryPayload(new Date("2026-11-21T12:00:00Z"));
  expect(body.demo).toBe(true);
  expect(body.rows.length).toBeGreaterThan(5);
  expect(body.rows.some((row) => row.severity === "warning")).toBe(true);
});

test("API routes serve demo payloads when HVAC_DEMO=1", async () => {
  setEnv("HVAC_DEMO", "1");
  setEnv("NODE_ENV", "test");
  setEnv("VERCEL_ENV", undefined);
  setEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "");
  setEnv("CLERK_SECRET_KEY", "");

  const readings = await getReadings();
  expect(readings.status).toBe(200);
  const readingsBody = (await readings.json()) as {
    demo?: boolean;
    points: Array<{ point_id: string; status: string }>;
  };
  expect(readingsBody.demo).toBe(true);
  expect(readingsBody.points.every((point) => point.status === "live")).toBe(true);

  const alerts = await getAlerts();
  expect(alerts.status).toBe(200);
  const alertsBody = (await alerts.json()) as {
    demo?: boolean;
    active_count: number;
    alerts: unknown[];
  };
  expect(alertsBody.demo).toBe(true);
  expect(alertsBody.active_count).toBe(1);

  const history = await getHistory();
  expect(history.status).toBe(200);
  const historyBody = (await history.json()) as { demo?: boolean; rows: unknown[] };
  expect(historyBody.demo).toBe(true);
  expect(historyBody.rows.length).toBeGreaterThan(0);
});

test(".env.example documents HVAC_DEMO and production stays empty", () => {
  const example = fs.readFileSync(path.join(process.cwd(), ".env.example"), "utf8");
  const production = fs.readFileSync(path.join(process.cwd(), ".env.production"), "utf8");
  expect(example).toContain("HVAC_DEMO");
  expect(example).toContain("Blocked when NODE_ENV or VERCEL_ENV is production");
  expect(production).toMatch(/^HVAC_DEMO=$/m);
});
