/**
 * Decide what the page is allowed to show for each point.
 *
 * Stale means the hub stopped hearing that point. A message that just arrived
 * is current even if the node's own clock is wrong. A stale or bad-quality
 * sample is not returned as a current value.
 *
 * Age is (now - received_at), never the device timestamp. After 120 seconds
 * the number is stripped so the last reading cannot linger as "current".
 */

import { formatTimestamp } from "./clock";
import type { PointSpec, Settings } from "./config";
import { Quality, type StoredReading } from "./models";
import type { ReadingLookup } from "./store";

export type LiveStatus = "missing" | "live" | "stale" | "bad" | "unknown";

export interface LivePoint {
  point_id: string;
  name: string;
  node_id: string;
  unit: string;
  status: LiveStatus;
  quality: string | null;
  value: number | null;
  age_seconds: number | null;
  device_timestamp: Date | null;
  received_at: Date | null;
  time_source: string | null;
}

export interface PublicSnapshot {
  system_name: string;
  server_time: string;
  stale_after_seconds: number;
  points: ReturnType<typeof asPublicDict>[];
  mqtt_connected?: boolean;
}

/** JSON the live page and GET /api/readings both consume. */
export function asPublicDict(point: LivePoint): Record<string, unknown> {
  return {
    point_id: point.point_id,
    name: point.name,
    node_id: point.node_id,
    unit: point.unit,
    status: point.status,
    quality: point.quality,
    value: point.value,
    age_seconds: point.age_seconds,
    device_timestamp: point.device_timestamp
      ? formatTimestamp(point.device_timestamp)
      : null,
    received_at: point.received_at ? formatTimestamp(point.received_at) : null,
    time_source: point.time_source,
  };
}

/** Same as collectLivePoints when you already have latestMap (Prisma is async). */
export function collectLivePointsFromMap(
  settings: Settings,
  latest: Record<string, StoredReading>,
  now: Date,
): LivePoint[] {
  const ordered = settings.points.map((spec) => spec.id);
  const extras = Object.keys(latest)
    .filter((pointId) => !ordered.includes(pointId))
    .sort();
  const specs = Object.fromEntries(settings.points.map((spec) => [spec.id, spec]));
  return [...ordered, ...extras].map((pointId) =>
    classify(
      specs[pointId],
      latest[pointId],
      now,
      settings.stale_after_seconds,
      pointId,
    ),
  );
}

/** One LivePoint per configured id, then any extra ids the store has seen. */
export function collectLivePoints(
  settings: Settings,
  store: ReadingLookup,
  now: Date,
): LivePoint[] {
  return collectLivePointsFromMap(settings, store.latestMap(), now);
}

/** Classify one point. Returns null only when the id is unknown and unstored. */
export function livePointFor(
  settings: Settings,
  store: ReadingLookup,
  pointId: string,
  now: Date,
): LivePoint | null {
  const spec = settings.points.find((item) => item.id === pointId);
  const reading = store.latest(pointId);
  if (!spec && !reading) {
    return null;
  }
  return classify(spec, reading ?? undefined, now, settings.stale_after_seconds, pointId);
}

/** Snapshot body without mqtt_connected (the gateway or collector status adds that). */
export function publicSnapshotFromMap(
  settings: Settings,
  latest: Record<string, StoredReading>,
  now: Date,
): PublicSnapshot {
  const points = collectLivePointsFromMap(settings, latest, now);
  return {
    system_name: settings.system_name,
    server_time: formatTimestamp(now),
    stale_after_seconds: settings.stale_after_seconds,
    points: points.map(asPublicDict),
  };
}

/** Snapshot body without mqtt_connected (the gateway adds that). */
export function publicSnapshot(
  settings: Settings,
  store: ReadingLookup,
  now: Date,
): PublicSnapshot {
  return publicSnapshotFromMap(settings, store.latestMap(), now);
}

/**
 * Apply the stale cutoff and quality rules.
 * value is only set when status is live; otherwise it is null so JSON cannot
 * leak a stale or bad number to the page.
 */
export function classify(
  spec: PointSpec | undefined,
  reading: StoredReading | undefined,
  now: Date,
  staleAfterSeconds: number,
  pointId: string,
): LivePoint {
  const name = spec?.name ?? pointId;
  const fallbackUnit = spec?.unit ?? "";
  const fallbackNode = spec?.node_id ?? "";
  if (!reading) {
    return {
      point_id: pointId,
      name,
      node_id: fallbackNode,
      unit: fallbackUnit,
      status: "missing",
      quality: null,
      value: null,
      age_seconds: null,
      device_timestamp: null,
      received_at: null,
      time_source: null,
    };
  }

  let age = Math.trunc((now.getTime() - reading.received_at.getTime()) / 1000);
  if (age < 0) {
    age = 0;
  }

  let status: LiveStatus;
  if (age >= staleAfterSeconds) {
    status = "stale";
  } else if (reading.quality === Quality.GOOD && reading.value !== null) {
    status = "live";
  } else if (reading.quality === Quality.BAD) {
    status = "bad";
  } else {
    status = "unknown";
  }

  const qualityByStatus: Record<string, string | undefined> = {
    live: "good",
    bad: "bad",
    unknown: "unknown",
  };
  const quality = qualityByStatus[status] ?? null;

  return {
    point_id: pointId,
    name,
    node_id: reading.node_id || fallbackNode,
    unit: reading.unit || fallbackUnit,
    status,
    quality,
    value: status === "live" ? reading.value : null,
    age_seconds: age,
    device_timestamp: reading.device_timestamp,
    received_at: reading.received_at,
    time_source: reading.time_source,
  };
}
