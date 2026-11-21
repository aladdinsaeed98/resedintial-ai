/**
 * Publish two changing temperatures every 10 seconds. Retain is off.
 *
 * Desk stand-in for the bench ESP32 until the board is flashed. Same topic
 * (hvac/bench/reading) and same JSON as the firmware. Retain must stay off
 * so stopping this process lets the hub mark tiles stale.
 *
 * If you see "broker ... not up yet", Mosquitto is not listening on 1883.
 */

import mqtt, { type MqttClient } from "mqtt";

import { formatTimestamp } from "../hub/clock";
import { readingTopic } from "../hub/topics";

export const DEFAULT_INTERVAL_SECONDS = 10;
export const MQTT_RETAIN = false;

/** Two temps that bump 0.1 °F every six steps, then wrap. */
export function temperatures(step: number): Record<string, number> {
  const bump = (step % 6) * 0.1;
  return {
    return_air_temp: round2(74.0 + bump),
    supply_air_temp: round2(56.0 + bump),
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Wire JSON {point, value, unit, timestamp, quality}. Compact, like the ESP32.
 * Extra keys are never added; this is not a command.
 */
export function buildPayload(
  point: string,
  value: number | null,
  when: Date,
  quality = "good",
  unit = "F",
): string {
  const body = {
    point,
    value,
    unit,
    timestamp: formatTimestamp(when),
    quality,
  };
  return JSON.stringify(body);
}

/** Block until Mosquitto accepts us, retrying every 2 s like the Python sim. */
export async function connectClient(host: string, port: number): Promise<MqttClient> {
  for (;;) {
    try {
      const client = await mqtt.connectAsync(`mqtt://${host}:${port}`, {
        clientId: "hvac-bench-sim",
        protocolId: "MQTT",
        protocolVersion: 4,
        keepalive: 30,
        reconnectPeriod: 1000,
        connectTimeout: 5000,
      });
      return client;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`broker ${host}:${port} not up yet (${message})`);
      await sleep(2000);
    }
  }
}

/** Publish both bench points once. qos 0, retain off. */
export async function publishOnce(
  client: MqttClient,
  nodeId: string,
  step: number,
  when: Date,
): Promise<Record<string, number>> {
  const temps = temperatures(step);
  for (const [point, value] of Object.entries(temps)) {
    await client.publishAsync(readingTopic(nodeId), buildPayload(point, value, when), {
      qos: 0,
      retain: MQTT_RETAIN,
    });
  }
  return temps;
}

export async function run(options: {
  host: string;
  port: number;
  interval: number;
  nodeId: string;
  once: boolean;
}): Promise<void> {
  const client = await connectClient(options.host, options.port);
  let step = 0;
  try {
    for (;;) {
      const temps = await publishOnce(client, options.nodeId, step, new Date());
      console.info("published", temps);
      if (options.once) {
        return;
      }
      step += 1;
      await sleep(options.interval * 1000);
    }
  } finally {
    // Graceful end so qos 0 packets are flushed. end(true) dropped --once publishes
    // before Mosquitto saw them.
    await client.endAsync();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
