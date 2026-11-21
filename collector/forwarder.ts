/**
 * POST readings to the Vercel ingest route. Outbound HTTPS only.
 *
 * This module never talks MQTT and never publishes. A failed POST leaves
 * the batch in the local buffer. The JSON response is treated as
 * { accepted } only — extra keys are ignored so a compromised server
 * cannot smuggle a command back to the collector.
 */

import { ingestResponse, serializeReadingForIngest } from "../hub/ingest";
import type { StoredReading } from "../hub/models";
import type { PendingBuffer } from "./buffer";

export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
  },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface ForwardResult {
  ok: boolean;
  status: number;
  accepted: number;
  retried: boolean;
}

/**
 * One flush: take a batch, POST it, ack on success. Heartbeat (empty
 * readings) keeps collector_status fresh when the node is quiet.
 */
export async function flushOnce(
  buffer: PendingBuffer,
  options: {
    ingestUrl: string;
    ingestSecret: string;
    mqttConnected: boolean;
    fetchImpl?: FetchLike;
    batchSize?: number;
  },
): Promise<ForwardResult> {
  const fetchImpl = options.fetchImpl ?? (fetch as FetchLike);
  const batch = buffer.takeBatch(options.batchSize ?? 20);
  const body = {
    readings: batch.map((item) => serializeReadingForIngest(item.reading)),
    mqtt_connected: options.mqttConnected,
  };
  let status = 0;
  try {
    const response = await fetchImpl(options.ingestUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${options.ingestSecret}`,
      },
      body: JSON.stringify(body),
    });
    status = response.status;
    if (!response.ok) {
      return { ok: false, status, accepted: 0, retried: true };
    }
    // Only { accepted } is meaningful. Ignore everything else.
    const json = (await response.json()) as { accepted?: unknown };
    const accepted =
      typeof json.accepted === "number" ? json.accepted : ingestResponse(batch.length).accepted;
    buffer.remove(batch.map((item) => item.id));
    return { ok: true, status, accepted, retried: false };
  } catch {
    return { ok: false, status, accepted: 0, retried: true };
  }
}

/** Enqueue one parsed reading. Used by tests without MQTT. */
export function enqueue(buffer: PendingBuffer, reading: StoredReading): void {
  buffer.add(reading);
}
