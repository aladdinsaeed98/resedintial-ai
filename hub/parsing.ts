/**
 * Parse an ESP32 reading.
 *
 * Wire JSON is {point, value, unit, timestamp, quality}. Extra keys are
 * ignored — nothing in a payload is a command, including a "command" field.
 *
 * If the page never updates, look at the hub log for "dropped mqtt payload"
 * and the error string this module returned.
 */

import { parseTimestamp } from "./clock";
import { Quality, type StoredReading } from "./models";
import { POINT_RE, TOPIC_RE } from "./topics";

export const MAX_PAYLOAD_BYTES = 2048;

// DS18B20 usable range. The disconnect sentinel (-127) falls outside both.
const RANGES: Record<string, [number, number]> = {
  F: [-67.0, 257.0],
  C: [-55.0, 125.0],
};

const UNIT_ALIASES: Record<string, string> = {
  f: "F",
  "°f": "F",
  degf: "F",
  fahrenheit: "F",
  c: "C",
  "°c": "C",
  degc: "C",
  celsius: "C",
};

export interface ParseResult {
  reading: StoredReading | null;
  error: string | null;
}

/** Turn one MQTT topic + payload into a StoredReading, or explain why not. */
export function parseReading(
  topic: string,
  payload: Buffer | string | Uint8Array,
  receivedAt: Date,
): ParseResult {
  if (Number.isNaN(receivedAt.getTime())) {
    return { reading: null, error: "hub clock must be timezone-aware" };
  }
  const match = topic.trim().match(TOPIC_RE);
  if (!match) {
    return { reading: null, error: "unsupported topic" };
  }
  const nodeId = match[1];

  const raw = typeof payload === "string" ? Buffer.from(payload, "utf8") : Buffer.from(payload);
  if (raw.length > MAX_PAYLOAD_BYTES) {
    return { reading: null, error: "payload too large" };
  }
  let text: string;
  try {
    text = raw.toString("utf8");
  } catch {
    return { reading: null, error: "payload is not utf-8" };
  }
  // Buffer.toString never throws for utf8; catch invalid JSON next.
  let data: unknown;
  try {
    data = JSON.parse(text) as unknown;
  } catch {
    return { reading: null, error: "payload is not json" };
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { reading: null, error: "payload must be an object" };
  }
  const body = data as Record<string, unknown>;

  const point = body.point;
  if (typeof point !== "string" || !POINT_RE.test(point)) {
    return { reading: null, error: "invalid point" };
  }
  if (!("value" in body)) {
    return { reading: null, error: "missing value" };
  }
  if (!("unit" in body)) {
    return { reading: null, error: "missing unit" };
  }

  const [numeric, valueError] = parseNumber(body.value);
  if (valueError) {
    return { reading: null, error: valueError };
  }
  const unit = normalizeUnit(body.unit);
  if (unit === null) {
    return { reading: null, error: "invalid unit" };
  }
  const [qualityResult, qualityError] = parseQuality(body);
  if (qualityError) {
    return { reading: null, error: qualityError };
  }
  let quality = qualityResult as Quality;

  if (numeric !== null && !inRange(unit, numeric)) {
    quality = Quality.BAD;
  }
  if (numeric === null && quality === Quality.GOOD) {
    quality = Quality.BAD;
  }

  const [deviceTimestamp, timeSource, timeError] = parseDeviceTimestamp(
    body.timestamp,
    receivedAt,
  );
  if (timeError || !deviceTimestamp || !timeSource) {
    return { reading: null, error: timeError ?? "invalid timestamp" };
  }

  return {
    reading: {
      point_id: point,
      node_id: nodeId,
      value: numeric,
      unit,
      quality,
      device_timestamp: deviceTimestamp,
      received_at: receivedAt,
      time_source: timeSource,
    },
    error: null,
  };
}

function parseNumber(value: unknown): [number | null, string | null] {
  if (value === null) {
    return [null, null];
  }
  // JSON has no boolean-as-number trap the same way Python does, but reject
  // bools anyway so a true/false cannot become 1/0.
  if (typeof value === "boolean" || (typeof value !== "number" && typeof value !== "bigint")) {
    return [null, "invalid value"];
  }
  const numeric = typeof value === "bigint" ? Number(value) : value;
  if (!Number.isFinite(numeric)) {
    return [null, "invalid value"];
  }
  return [numeric, null];
}

function normalizeUnit(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const key = value.trim().replace(/ /g, "").toLowerCase();
  if (key in UNIT_ALIASES) {
    return UNIT_ALIASES[key];
  }
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > 16) {
    return null;
  }
  return cleaned;
}

function parseQuality(data: Record<string, unknown>): [Quality | null, string | null] {
  if (!("quality" in data) || data.quality === null || data.quality === undefined) {
    return [Quality.UNKNOWN, null];
  }
  const raw = data.quality;
  if (typeof raw !== "string") {
    return [null, "invalid quality"];
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === Quality.GOOD || normalized === Quality.BAD || normalized === Quality.UNKNOWN) {
    return [normalized as Quality, null];
  }
  return [null, "invalid quality"];
}

function inRange(unit: string, value: number): boolean {
  const bounds = RANGES[unit];
  if (!bounds) {
    return true;
  }
  const [low, high] = bounds;
  return low <= value && value <= high;
}

function parseDeviceTimestamp(
  raw: unknown,
  receivedAt: Date,
): [Date | null, string | null, string | null] {
  if (raw === null || raw === undefined) {
    return [receivedAt, "hub", null];
  }
  if (typeof raw !== "string") {
    return [null, null, "invalid timestamp"];
  }
  try {
    return [parseTimestamp(raw), "device", null];
  } catch {
    return [null, null, "invalid timestamp"];
  }
}
