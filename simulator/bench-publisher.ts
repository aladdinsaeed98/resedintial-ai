/**
 * Publish bench readings every 10 seconds. Retain is off.
 *
 * Desk stand-in for the ESP32 until the board is flashed. Same topic
 * (hvac/bench/reading) and same JSON as the firmware. Extra Phase B points
 * (calls, amps, LED) are published here so the rules engine can be exercised.
 * Firmware still sends only the two temps. Retain must stay off so stopping
 * this process lets the hub mark tiles stale.
 *
 * --fault <id> holds a signature so you can watch Alerts without breaking
 * a real furnace. If you see "broker ... not up yet", Mosquitto is not
 * listening on 1883.
 */

import mqtt, { type MqttClient } from "mqtt";

import { formatTimestamp } from "../hub/clock";
import { readingTopic } from "../hub/topics";

export const DEFAULT_INTERVAL_SECONDS = 10;
export const MQTT_RETAIN = false;

export const FAULT_IDS = [
  "none",
  "call_no_compressor",
  "call_no_blower",
  "low_delta_t",
  "high_delta_t",
  "short_cycling",
  "long_run",
  "board_fault",
  "stale_sensor",
  "node_offline",
] as const;

export type FaultId = (typeof FAULT_IDS)[number];

export interface SimPoint {
  point: string;
  value: number;
  unit: string;
}

const UNITS: Record<string, string> = {
  return_air_temp: "F",
  supply_air_temp: "F",
  call_y: "bool",
  call_g: "bool",
  compressor_amps: "A",
  blower_amps: "A",
  led_code: "code",
};

/** Two temps that bump 0.1 °F every six steps, then wrap. Healthy delta ~18 °F. */
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

function point(id: string, value: number): SimPoint {
  return { point: id, value, unit: UNITS[id] ?? "F" };
}

/**
 * One step of simulated points. `none` is idle (calls off, amps near 0, LED 0)
 * so a long run of the simulator does not false-alarm. Fault ids hold the
 * signature; timing rules still need the engine to see enough elapsed time.
 */
export function benchReadings(step: number, fault: FaultId = "none"): SimPoint[] {
  const temps = temperatures(step);
  let returnAir = temps.return_air_temp;
  let supplyAir = temps.supply_air_temp;
  let callY = 0;
  let callG = 0;
  let compressor = 0.1;
  let blower = 0.1;
  let led = 0;
  let omitSupply = false;

  if (fault === "node_offline") {
    return [];
  }
  if (fault === "stale_sensor") {
    omitSupply = true;
  }
  if (fault === "call_no_compressor") {
    callY = 1;
    compressor = 0.1;
    blower = 2.4;
  } else if (fault === "call_no_blower") {
    callY = 1;
    callG = 1;
    compressor = 5.2;
    blower = 0.1;
  } else if (fault === "low_delta_t" || fault === "long_run") {
    callY = 1;
    compressor = 5.2;
    blower = 2.4;
    returnAir = 70;
    supplyAir = 62;
  } else if (fault === "high_delta_t") {
    callY = 1;
    compressor = 5.2;
    blower = 2.4;
    returnAir = 80;
    supplyAir = 50;
  } else if (fault === "short_cycling") {
    callY = 1;
    blower = 2.4;
    compressor = step % 2 === 0 ? 0.1 : 8.0;
  } else if (fault === "board_fault") {
    led = 3;
  }

  const out: SimPoint[] = [
    point("return_air_temp", returnAir),
    ...(omitSupply ? [] : [point("supply_air_temp", supplyAir)]),
    point("call_y", callY),
    point("call_g", callG),
    point("compressor_amps", compressor),
    point("blower_amps", blower),
    point("led_code", led),
  ];
  return out;
}

/**
 * Wire JSON {point, value, unit, timestamp, quality}. Compact, like the ESP32.
 * Extra keys are never added; this is not a command.
 */
export function buildPayload(
  pointName: string,
  value: number | null,
  when: Date,
  quality = "good",
  unit = "F",
): string {
  const body = {
    point: pointName,
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

/** Publish one step of bench points. qos 0, retain off. */
export async function publishOnce(
  client: MqttClient,
  nodeId: string,
  step: number,
  when: Date,
  fault: FaultId = "none",
): Promise<Record<string, number>> {
  const readings = benchReadings(step, fault);
  const published: Record<string, number> = {};
  for (const item of readings) {
    await client.publishAsync(
      readingTopic(nodeId),
      buildPayload(item.point, item.value, when, "good", item.unit),
      { qos: 0, retain: MQTT_RETAIN },
    );
    published[item.point] = item.value;
  }
  return published;
}

export async function run(options: {
  host: string;
  port: number;
  interval: number;
  nodeId: string;
  once: boolean;
  fault: FaultId;
}): Promise<void> {
  const client = await connectClient(options.host, options.port);
  let step = 0;
  try {
    for (;;) {
      const published = await publishOnce(
        client,
        options.nodeId,
        step,
        new Date(),
        options.fault,
      );
      console.info("published", options.fault === "none" ? published : { fault: options.fault, ...published });
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
