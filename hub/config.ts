/**
 * Hub settings. Thresholds and point names live in config, not in scattered code.
 *
 * HVAC_* environment variables override defaults. The SQLite file is kept off
 * the repo (and off iCloud) so a sync client does not lock the database.
 * If the hub refuses to start, read the points.json error first.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { NODE_RE, POINT_RE } from "./topics";

export const DEFAULT_POINTS_FILE_NAME = path.join("config", "points.json");
export const DEFAULT_STALE_AFTER_SECONDS = 120;
export const DEFAULT_MQTT_HOST = "127.0.0.1";
export const DEFAULT_MQTT_PORT = 1883;
export const DEFAULT_SYSTEM_NAME = "Bench";
export const DEFAULT_HTTP_HOST = "0.0.0.0";
export const DEFAULT_HTTP_PORT = 3000;
export const DEFAULT_INGEST_URL = "http://localhost:3000/api/ingest";

/** One tile on the live page, loaded from config/points.json. */
export interface PointSpec {
  id: string;
  name: string;
  unit: string;
  node_id: string;
  /** Plain-language label for the UI (optional). */
  plain_label?: string;
  /** Tooltip / help text for the sensor (optional). */
  description?: string;
}

/** Frozen hub / collector settings for one process. */
export interface Settings {
  mqtt_host: string;
  mqtt_port: number;
  database_path: string;
  stale_after_seconds: number;
  system_name: string;
  points: readonly PointSpec[];
  host: string;
  port: number;
  ingest_url: string;
  ingest_secret: string;
  cron_secret: string;
}

/**
 * Walk up from a starting directory until we see package.json and
 * config/points.json. Next.js may run compiled files from .next/server.
 */
function findRepoRoot(start: string): string {
  let dir = start;
  for (;;) {
    const pkg = path.join(dir, "package.json");
    const points = path.join(dir, "config", "points.json");
    if (fs.existsSync(pkg) && fs.existsSync(points)) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return process.cwd();
    }
    dir = parent;
  }
}

/** Repo root. Used to find config/points.json. */
export function repoRoot(): string {
  if (process.env.HVAC_ROOT) {
    return path.resolve(process.env.HVAC_ROOT);
  }
  if (fs.existsSync(path.join(process.cwd(), "config", "points.json"))) {
    return process.cwd();
  }
  return findRepoRoot(path.dirname(fileURLToPath(import.meta.url)));
}

export const ROOT = repoRoot();
export const DEFAULT_POINTS_FILE = path.join(ROOT, DEFAULT_POINTS_FILE_NAME);

/**
 * Keep SQLite off iCloud. The repo itself may live in iCloud Drive.
 * LOCALAPPDATA is read from the real process environment even when tests
 * pass an empty env map, matching the Python hub.
 */
export function defaultDbPath(): string {
  const local = process.env.LOCALAPPDATA;
  if (local) {
    return path.join(local, "hvac-monitor", "hvac.db");
  }
  return path.join(os.homedir(), ".local", "share", "hvac-monitor", "hvac.db");
}

/** Load and validate the point list. Invalid ids make the hub refuse to start. */
export function loadPoints(filePath: string): PointSpec[] {
  const data = JSON.parse(fs.readFileSync(filePath, "utf8")) as {
    points?: Array<{
      id: unknown;
      name: unknown;
      unit: unknown;
      node_id: unknown;
      plain_label?: unknown;
      description?: unknown;
    }>;
  };
  const points: PointSpec[] = [];
  const seen = new Set<string>();
  for (const item of data.points ?? []) {
    const plain =
      item.plain_label == null ? undefined : String(item.plain_label).trim() || undefined;
    const description =
      item.description == null ? undefined : String(item.description).trim() || undefined;
    const spec: PointSpec = {
      id: String(item.id),
      name: String(item.name),
      unit: String(item.unit),
      node_id: String(item.node_id),
      ...(plain ? { plain_label: plain } : {}),
      ...(description ? { description } : {}),
    };
    if (!POINT_RE.test(spec.id)) {
      throw new Error(`invalid point id ${spec.id}`);
    }
    if (!NODE_RE.test(spec.node_id)) {
      throw new Error(`invalid node id ${spec.node_id}`);
    }
    if (seen.has(spec.id)) {
      throw new Error(`duplicate point id ${spec.id}`);
    }
    if (!spec.name.trim() || !spec.unit.trim()) {
      throw new Error(`point ${spec.id} needs a name and unit`);
    }
    seen.add(spec.id);
    points.push(spec);
  }
  if (points.length === 0) {
    throw new Error(`${filePath} has no points`);
  }
  return points;
}

function positiveInt(
  source: Record<string, string | undefined>,
  key: string,
  fallback: number,
): number {
  const text = source[key] ?? String(fallback);
  const trimmed = String(text).trim();
  // Python int() rejects "12px" and "12.5". Keep that: whole string, integer.
  if (!/^-?\d+$/.test(trimmed)) {
    throw new Error(`${key} must be an integer`);
  }
  const value = Number.parseInt(trimmed, 10);
  if (Number.isNaN(value)) {
    throw new Error(`${key} must be an integer`);
  }
  if (value <= 0) {
    throw new Error(`${key} must be positive`);
  }
  return value;
}

/**
 * Build settings from env vars plus points.json.
 * Pass env={} in tests to ignore the process environment (except defaultDbPath).
 */
export function loadSettings(
  env?: Record<string, string | undefined>,
): Settings {
  const source = env ?? process.env;
  const pointsFile = path.resolve(
    source.HVAC_POINTS_FILE ?? DEFAULT_POINTS_FILE,
  );
  const database = source.HVAC_DB;
  const systemName = (source.HVAC_SYSTEM_NAME ?? DEFAULT_SYSTEM_NAME).trim();
  return {
    mqtt_host: (source.HVAC_MQTT_HOST ?? DEFAULT_MQTT_HOST).trim() || DEFAULT_MQTT_HOST,
    mqtt_port: positiveInt(source, "HVAC_MQTT_PORT", DEFAULT_MQTT_PORT),
    database_path: database ? path.resolve(database) : defaultDbPath(),
    stale_after_seconds: positiveInt(
      source,
      "HVAC_STALE_AFTER_SECONDS",
      DEFAULT_STALE_AFTER_SECONDS,
    ),
    system_name: systemName || DEFAULT_SYSTEM_NAME,
    points: loadPoints(pointsFile),
    host: (source.HVAC_HOST ?? DEFAULT_HTTP_HOST).trim() || DEFAULT_HTTP_HOST,
    port: positiveInt(source, "HVAC_PORT", DEFAULT_HTTP_PORT),
    ingest_url: (source.HUB_INGEST_URL ?? DEFAULT_INGEST_URL).trim() || DEFAULT_INGEST_URL,
    ingest_secret: (source.INGEST_SECRET ?? "").trim(),
    cron_secret: (source.CRON_SECRET ?? "").trim(),
  };
}
