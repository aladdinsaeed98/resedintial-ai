/**
 * Phase 1 pass, in software.
 *
 * A new sample replaces the previous one. The firmware and the simulator
 * publish every 10 seconds. A point with no sample for 120 seconds is stale,
 * and the number is not in the payload the page renders.
 *
 * These 19 cases keep the meaning of tests/test_phase1.py. A ManualClock and
 * a temp database mean no live Mosquitto is required.
 */

import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";

import mqtt from "mqtt";
import { afterEach, expect, test } from "vitest";

import { GET as getReadings } from "../app/api/readings/route";
import { ManualClock } from "../hub/clock";
import { loadSettings, type Settings } from "../hub/config";
import { MqttGateway } from "../hub/gateway";
import {
  createMonitorServer,
  openApiDocument,
  readingsPayload,
} from "../hub/http";
import { publicSnapshot } from "../hub/live";
import { Quality, UnknownPoint, WriteNotSupported } from "../hub/models";
import { parseReading } from "../hub/parsing";
import { setRuntime } from "../hub/runtime";
import { ReadingStore } from "../hub/store";
import { readingTopic } from "../hub/topics";
import {
  DEFAULT_INTERVAL_SECONDS,
  MQTT_RETAIN,
  buildPayload,
} from "../simulator/bench-publisher";

const START = new Date("2026-10-17T12:00:00Z");
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

class World {
  clock: ManualClock;
  settings: Settings;
  store: ReadingStore;
  gateway: MqttGateway;
  private readonly tmpDir: string;

  constructor() {
    this.tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hvac-phase1-"));
    this.clock = new ManualClock(START);
    this.settings = {
      mqtt_host: "127.0.0.1",
      mqtt_port: 1883,
      database_path: path.join(this.tmpDir, "hvac.db"),
      stale_after_seconds: 120,
      system_name: "Bench",
      points: loadSettings({}).points,
      host: "127.0.0.1",
      port: 3000,
      ingest_url: "http://localhost:3000/api/ingest",
      ingest_secret: "test-ingest-secret",
    };
    this.store = new ReadingStore(this.settings.database_path);
    this.gateway = new MqttGateway(this.settings, this.store, this.clock);
    setRuntime({
      settings: this.settings,
      store: this.store,
      clock: this.clock,
      gateway: this.gateway,
      ownsStore: false,
    });
  }

  close(): void {
    this.store.close();
    setRuntime(undefined);
    fs.rmSync(this.tmpDir, { recursive: true, force: true });
  }

  publish(pointId: string, value: number, quality = "good", when?: Date): void {
    const payload = buildPayload(pointId, value, when ?? this.clock.now(), quality);
    expect(this.gateway.handleMessage(readingTopic("bench"), payload)).toBe(true);
  }

  snapshot(): Record<string, unknown> {
    return publicSnapshot(this.settings, this.store, this.clock.now()) as unknown as Record<
      string,
      unknown
    >;
  }
}

let world: World | undefined;

afterEach(() => {
  world?.close();
  world = undefined;
});

function makeWorld(): World {
  world = new World();
  return world;
}

function point(snap: Record<string, unknown>, pointId: string): Record<string, unknown> {
  const points = snap.points as Array<Record<string, unknown>>;
  const item = points.find((entry) => entry.point_id === pointId);
  if (!item) {
    throw new Error(`missing point ${pointId}`);
  }
  return item;
}

test("shipped defaults match the bench pass", () => {
  const settings = loadSettings({});
  expect(settings.stale_after_seconds).toBe(120);
  expect(settings.points.map((item) => item.id)).toEqual([
    "return_air_temp",
    "supply_air_temp",
  ]);
  expect(DEFAULT_INTERVAL_SECONDS).toBe(10);
  expect(MQTT_RETAIN).toBe(false);
  const database = path.resolve(settings.database_path);
  const repo = path.resolve(REPO);
  expect(database).not.toBe(repo);
  expect(database.startsWith(repo + path.sep)).toBe(false);
});

test("firmware publishes readings and does not subscribe", () => {
  const source = fs.readFileSync(
    path.join(REPO, "firmware", "bench_node", "bench_node.ino"),
    "utf8",
  );
  expect(source).toContain("kPublishIntervalMs = 10000");
  expect(source).toContain("mqtt.publish(");
  expect(source).not.toContain("subscribe(");
  expect(source).not.toContain("digitalWrite(");
  expect(source).toContain("hvac/%s/reading");
  expect(source).toContain('\\"point\\"');
  expect(source).toContain('\\"quality\\"');
});

test("simulator payload uses the wire contract", () => {
  const payload = buildPayload("return_air_temp", 70.25, START);
  const body = JSON.parse(payload) as Record<string, unknown>;
  expect(new Set(Object.keys(body))).toEqual(
    new Set(["point", "value", "unit", "timestamp", "quality"]),
  );
  const result = parseReading(readingTopic("bench"), payload, START);
  expect(result.error).toBeNull();
  expect(result.reading).not.toBeNull();
  expect(result.reading?.value).toBeCloseTo(70.25);
  expect(result.reading?.quality).toBe(Quality.GOOD);
});

test("degree symbol counts as fahrenheit", () => {
  const w = makeWorld();
  const body = JSON.parse(buildPayload("return_air_temp", 70.0, START)) as Record<
    string,
    unknown
  >;
  body.unit = "°F";
  const result = parseReading(readingTopic("bench"), JSON.stringify(body), START);
  expect(result.reading).not.toBeNull();
  expect(result.reading?.unit).toBe("F");
  expect(w.settings.points).toHaveLength(2);
});

test("readings update on the next sample", () => {
  const w = makeWorld();
  w.publish("return_air_temp", 72.4);
  w.publish("supply_air_temp", 56.2);
  w.clock.advance(10);
  w.publish("return_air_temp", 73.0);
  w.publish("supply_air_temp", 57.1);
  const snap = w.snapshot();
  expect((snap.points as Array<Record<string, unknown>>).map((item) => item.point_id)).toEqual([
    "return_air_temp",
    "supply_air_temp",
  ]);
  expect(point(snap, "return_air_temp").value).toBeCloseTo(73.0);
  expect(point(snap, "return_air_temp").age_seconds).toBe(0);
  expect(point(snap, "supply_air_temp").status).toBe("live");
  const text = JSON.stringify(snap);
  expect(text).not.toContain("72.4");
  expect(text).not.toContain("56.2");
});

test("unplug marks both points stale at two minutes", () => {
  const w = makeWorld();
  w.publish("return_air_temp", 72.4);
  w.publish("supply_air_temp", 56.2);
  w.clock.advance(119);
  const stillLive = w.snapshot();
  expect(point(stillLive, "return_air_temp").status).toBe("live");
  expect(point(stillLive, "return_air_temp").value).toBeCloseTo(72.4);

  w.clock.advance(1);
  const stale = w.snapshot();
  const text = JSON.stringify(stale);
  for (const pointId of ["return_air_temp", "supply_air_temp"]) {
    const item = point(stale, pointId);
    expect(item.status).toBe("stale");
    expect(item.value).toBeNull();
    expect(item.quality).toBeNull();
  }
  expect(text).not.toContain("72.4");
  expect(text).not.toContain("56.2");
});

test("one probe can go stale while the other stays live", () => {
  const w = makeWorld();
  w.publish("return_air_temp", 72.4);
  w.publish("supply_air_temp", 56.2);
  w.clock.advance(120);
  w.publish("return_air_temp", 72.8);
  const snap = w.snapshot();
  expect(point(snap, "return_air_temp").status).toBe("live");
  expect(point(snap, "return_air_temp").value).toBeCloseTo(72.8);
  expect(point(snap, "supply_air_temp").status).toBe("stale");
  expect(point(snap, "supply_air_temp").value).toBeNull();
  expect(JSON.stringify(snap)).not.toContain("56.2");
});

test("a future device clock does not keep a silent probe live", () => {
  const w = makeWorld();
  const future = new Date(w.clock.now().getTime() + 10 * 60 * 1000);
  w.publish("return_air_temp", 71.5, "good", future);
  w.clock.advance(120);
  const item = point(w.snapshot(), "return_air_temp");
  expect(item.status).toBe("stale");
  expect(item.value).toBeNull();
});

test("a just arrived reading is live even if the device clock is old", () => {
  const w = makeWorld();
  const old = new Date(w.clock.now().getTime() - 60 * 60 * 1000);
  w.publish("return_air_temp", 71.5, "good", old);
  const item = point(w.snapshot(), "return_air_temp");
  expect(item.status).toBe("live");
  expect(item.value).toBeCloseTo(71.5);
  expect(item.age_seconds).toBe(0);
});

test("malformed payload does not replace the last good reading", () => {
  const w = makeWorld();
  w.publish("return_air_temp", 72.4);
  expect(w.gateway.handleMessage(readingTopic("bench"), "{")).toBe(false);
  expect(
    w.gateway.handleMessage("hvac/bench/set", buildPayload("return_air_temp", 1, START)),
  ).toBe(false);
  const item = point(w.snapshot(), "return_air_temp");
  expect(item.status).toBe("live");
  expect(item.value).toBeCloseTo(72.4);
});

test("a command key is data and there is no write path", () => {
  const w = makeWorld();
  const body = JSON.parse(buildPayload("return_air_temp", 70.0, START)) as Record<
    string,
    unknown
  >;
  body.command = "off";
  expect(w.gateway.handleMessage(readingTopic("bench"), JSON.stringify(body))).toBe(true);
  expect(() => w.gateway.write("return_air_temp", 60)).toThrow(WriteNotSupported);
  expect(w.gateway.supports_write).toBe(false);
  expect(w.gateway.listPoints().every((item) => item.writable === false)).toBe(true);
  expect(w.gateway.listEquipment()).toEqual(["bench"]);
  expect(w.gateway.subscribe_topic).toBe("hvac/+/reading");
});

test("impossible temperatures are stored and not shown", () => {
  const w = makeWorld();
  w.publish("return_air_temp", 999);
  w.publish("supply_air_temp", -127);
  const snap = w.snapshot();
  expect(point(snap, "return_air_temp").status).toBe("bad");
  expect(point(snap, "supply_air_temp").status).toBe("bad");
  expect(point(snap, "return_air_temp").value).toBeNull();
  const text = JSON.stringify(snap);
  expect(text).not.toContain("999");
  expect(text).not.toContain("-127");
  const stored = w.store.latest("supply_air_temp");
  expect(stored).not.toBeNull();
  expect(stored?.value).toBeCloseTo(-127);
  expect(stored?.quality).toBe(Quality.BAD);
  const reading = w.gateway.read("supply_air_temp");
  expect(reading.value).toBeNull();
  expect(reading.trustworthy()).toBe(false);
  expect(JSON.stringify(reading.raw)).not.toContain("-127");
});

test("missing quality is not treated as good", () => {
  const w = makeWorld();
  const body = JSON.parse(buildPayload("return_air_temp", 70.0, START)) as Record<
    string,
    unknown
  >;
  delete body.quality;
  expect(w.gateway.handleMessage(readingTopic("bench"), JSON.stringify(body))).toBe(true);
  const item = point(w.snapshot(), "return_air_temp");
  expect(item.status).toBe("unknown");
  expect(item.value).toBeNull();
  expect(JSON.stringify(item)).not.toContain("70.0");
});

test("point id alias is rejected", () => {
  const body = {
    point_id: "return_air_temp",
    value: 70,
    unit: "F",
    timestamp: "2026-10-17T12:00:00Z",
    quality: "good",
  };
  const result = parseReading(readingTopic("bench"), JSON.stringify(body), START);
  expect(result.reading).toBeNull();
});

test("unknown point is not invented", () => {
  const w = makeWorld();
  expect(() => w.gateway.read("heat_pump")).toThrow(UnknownPoint);
});

test("restart does not revive an old number", () => {
  const w = makeWorld();
  w.publish("return_air_temp", 72.4);
  w.publish("supply_air_temp", 56.2);
  const dbPath = w.settings.database_path;
  w.store.close();
  w.clock.advance(120);
  const reopened = new ReadingStore(dbPath);
  try {
    const snap = publicSnapshot(w.settings, reopened, w.clock.now()) as unknown as Record<
      string,
      unknown
    >;
    expect(point(snap, "return_air_temp").status).toBe("stale");
    expect(point(snap, "return_air_temp").value).toBeNull();
    expect(JSON.stringify(snap)).not.toContain("72.4");
  } finally {
    reopened.close();
  }
});

test("api is read only and hides stale numbers", async () => {
  const w = makeWorld();
  w.publish("return_air_temp", 72.4);
  w.publish("supply_air_temp", 56.2);

  const pageSource = [
    fs.readFileSync(path.join(REPO, "app", "page.tsx"), "utf8"),
    fs.readFileSync(path.join(REPO, "components", "LivePage.tsx"), "utf8"),
  ].join("\n");
  const scriptSource = fs.readFileSync(
    path.join(REPO, "components", "LivePage.tsx"),
    "utf8",
  );

  const server = createMonitorServer((req, res) => {
    const url = req.url ?? "/";
    const method = req.method ?? "GET";
    if (url.startsWith("/api/readings")) {
      const body = readingsPayload(w.settings, w.store, w.clock, w.gateway);
      const json = JSON.stringify(body);
      res.statusCode = 200;
      res.setHeader("cache-control", "no-store");
      res.setHeader("content-type", "application/json");
      if (method === "HEAD") {
        res.end();
        return;
      }
      res.end(json);
      return;
    }
    if (url.startsWith("/openapi.json")) {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(openApiDocument()));
      return;
    }
    if (url === "/" || url.startsWith("/?")) {
      res.statusCode = 200;
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(pageSource);
      return;
    }
    if (url.startsWith("/static/app.js") || url.startsWith("/components/LivePage.tsx")) {
      res.statusCode = 200;
      res.setHeader("content-type", "text/plain; charset=utf-8");
      res.end(scriptSource);
      return;
    }
    res.statusCode = 404;
    res.end();
  });

  const base = await listen(server);
  try {
    const spec = (await (await fetch(`${base}/openapi.json`)).json()) as {
      paths: Record<string, Record<string, unknown>>;
    };
    for (const [pathName, methods] of Object.entries(spec.paths)) {
      const names = Object.keys(methods);
      if (pathName === "/api/ingest") {
        expect(names).toEqual(["post"]);
        continue;
      }
      expect(names.every((name) => name === "get" || name === "head")).toBe(true);
    }

    const posted = await fetch(`${base}/api/readings`, { method: "POST" });
    expect(posted.status).toBe(405);

    const live = await fetch(`${base}/api/readings`);
    expect(live.status).toBe(200);
    expect(live.headers.get("cache-control")).toBe("no-store");
    const liveJson = (await live.json()) as {
      points: Array<{ value: number | null; status: string }>;
      mqtt_connected: boolean;
    };
    expect(liveJson.points[0].value).toBeCloseTo(72.4);
    expect(liveJson.mqtt_connected).toBe(false);

    w.clock.advance(120);
    const stale = await fetch(`${base}/api/readings`);
    const staleText = await stale.text();
    expect(staleText).not.toContain("72.4");
    expect(staleText).not.toContain("56.2");
    expect(JSON.parse(staleText).points[0].status).toBe("stale");

    const page = await fetch(`${base}/`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Read only");

    const script = await fetch(`${base}/static/app.js`);
    expect(script.status).toBe(200);
    const scriptText = await script.text();
    expect(scriptText).toContain('status === "live"');
    expect(scriptText).not.toContain("innerHTML");
    expect(scriptText).toContain("stale_after_seconds");

    const html = pageSource.toLowerCase();
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<button");

    // Same payload through the Next.js App Router GET handler.
    const routed = await getReadings();
    expect(routed.headers.get("cache-control")).toBe("no-store");
    const routedJson = (await routed.json()) as { points: Array<{ status: string }> };
    expect(routedJson.points[0].status).toBe("stale");
  } finally {
    await closeServer(server);
  }
});

test("mqtt.js client accepts MQTT 3.1.1 options", () => {
  // Python used paho-mqtt CallbackAPIVersion.VERSION2 / MQTTv311. The hub
  // now uses mqtt.js with protocolVersion 4 (MQTT 3.1.1). Meaning: the client
  // library we depend on can be constructed with our protocol settings.
  const client = mqtt.connect("mqtt://127.0.0.1:1883", {
    clientId: "test-hvac-hub",
    protocolId: "MQTT",
    protocolVersion: 4,
    clean: true,
    reconnectPeriod: 0,
    connectTimeout: 1,
    manualConnect: true,
  });
  expect(client).toBeTruthy();
  expect(client.options.protocolVersion).toBe(4);
  expect(client.options.clientId).toBe("test-hvac-hub");
  expect(client.options.clean).toBe(true);
  // manualConnect never opens a socket, so there is no stream to end().
});

test("page source marks a silent probe stale", () => {
  const css = fs.readFileSync(path.join(REPO, "app", "globals.css"), "utf8");
  const js = fs.readFileSync(path.join(REPO, "components", "LivePage.tsx"), "utf8");
  expect(css).toContain('[data-status="live"]');
  expect(js).toContain('stale: "Stale"');
  expect(js).toContain('typeof point.value === "number"');
});

function listen(server: http.Server): Promise<string> {
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo | null;
      if (!addr || typeof addr === "string") {
        reject(new Error("no listen address"));
        return;
      }
      resolve(`http://127.0.0.1:${addr.port}`);
    });
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
