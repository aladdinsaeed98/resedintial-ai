/**
 * Turn a collector POST body into StoredReadings.
 *
 * The Vercel route calls this after the secret check. received_at is always
 * the server clock so a delayed retry does not look older than it is.
 * Extra JSON keys (including "command") are ignored. The JSON we return to
 * the collector is only { accepted } — never a setpoint or a relay command.
 */

import { formatTimestamp } from "./clock";
import type { StoredReading } from "./models";
import { parseReading } from "./parsing";
import { readingTopic } from "./topics";

export const MAX_INGEST_READINGS = 100;
export const COLLECTOR_FRESH_SECONDS = 60;

export interface IngestAccepted {
  accepted: number;
}

export interface IngestFailure {
  error: string;
}

export interface ParsedIngest {
  readings: StoredReading[];
  mqtt_connected: boolean;
}

/**
 * Validate one collector batch. Fake a topic hvac/<node>/reading so we reuse
 * the same parser the MQTT gateway uses. Server received_at wins.
 */
export function parseIngestBody(
  body: unknown,
  receivedAt: Date,
): ParsedIngest | IngestFailure {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { error: "payload must be an object" };
  }
  const data = body as Record<string, unknown>;
  if ("command" in data && data.readings === undefined) {
    return { error: "payload must include readings" };
  }
  const list = data.readings;
  if (!Array.isArray(list)) {
    return { error: "readings must be an array" };
  }
  if (list.length > MAX_INGEST_READINGS) {
    return { error: "too many readings" };
  }

  const readings: StoredReading[] = [];
  for (const item of list) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      return { error: "each reading must be an object" };
    }
    const row = item as Record<string, unknown>;
    const nodeId = typeof row.node_id === "string" ? row.node_id : "";
    let topic: string;
    try {
      topic = readingTopic(nodeId);
    } catch {
      return { error: "invalid node_id" };
    }
    const wire = {
      point: row.point,
      value: row.value,
      unit: row.unit,
      timestamp: row.timestamp,
      quality: row.quality,
    };
    const parsed = parseReading(topic, JSON.stringify(wire), receivedAt);
    if (parsed.reading === null) {
      return { error: parsed.error ?? "invalid reading" };
    }
    readings.push(parsed.reading);
  }

  const mqttConnected = data.mqtt_connected === true;
  return { readings, mqtt_connected: mqttConnected };
}

/** The only JSON the collector is allowed to act on. */
export function ingestResponse(accepted: number): IngestAccepted {
  return { accepted };
}

export function serializeReadingForIngest(reading: StoredReading): Record<string, unknown> {
  return {
    point: reading.point_id,
    node_id: reading.node_id,
    value: reading.value,
    unit: reading.unit,
    timestamp: formatTimestamp(reading.device_timestamp),
    quality: reading.quality,
  };
}

/** Collector is "up" when ingest heard from it recently. */
export function collectorIsFresh(lastIngestAt: Date | null, now: Date, maxAgeSeconds = COLLECTOR_FRESH_SECONDS): boolean {
  if (!lastIngestAt) {
    return false;
  }
  return (now.getTime() - lastIngestAt.getTime()) / 1000 < maxAgeSeconds;
}
