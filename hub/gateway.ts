/**
 * MQTT subscriber for the ESP32 nodes.
 *
 * This is the only hub module that talks to the broker. It listens on
 * hvac/+/reading, parses each payload, and appends it to the store. It does
 * not publish. write() is the base refusal so a bug cannot command equipment.
 *
 * If readings never appear, check Mosquitto, then these logs for "dropped mqtt
 * payload" or "mqtt connect failed". A dropped payload leaves the last good
 * row in the store — that is on purpose.
 */

import mqtt, { type MqttClient } from "mqtt";

import { formatTimestamp, type Clock } from "./clock";
import type { Settings } from "./config";
import { livePointFor } from "./live";
import {
  BuildingGateway,
  type Point,
  PointValue,
  Quality,
  UnknownPoint,
} from "./models";
import { parseReading } from "./parsing";
import type { ReadingLookup } from "./store";
import { READING_SUBSCRIBE } from "./topics";

/**
 * Read-only MQTT adapter. One instance per hub process.
 *
 * supports_write stays false. The inherited write() raises WriteNotSupported
 * so there is no code path that could publish a command to a node.
 */
export class MqttGateway extends BuildingGateway {
  backend_name = "mqtt";
  adapter_kind = "mqtt";
  supports_write = false;
  /** + is MQTT's single-level wildcard: any node id, readings only. */
  subscribe_topic = READING_SUBSCRIBE;

  settings: Settings;
  store: ReadingLookup;
  clock: Clock;
  private client: MqttClient | null = null;

  constructor(settings: Settings, store: ReadingLookup, clock: Clock) {
    super();
    this.settings = settings;
    this.store = store;
    this.clock = clock;
  }

  /** True only when the mqtt.js client exists and the broker session is up. */
  get connected(): boolean {
    return this.client !== null && this.client.connected;
  }

  /**
   * Start a background MQTT client that only receives.
   *
   * clean=true so we do not replay a backlog of old readings as if they were
   * current. keepalive=30 s is a dead-broker detect, not a command. A connect
   * error is logged and swallowed so the HTTP page still serves stale/missing
   * tiles instead of crashing.
   *
   * This method never calls publish.
   */
  connect(): void {
    if (this.client !== null) {
      return;
    }
    try {
      const client = mqtt.connect(`mqtt://${this.settings.mqtt_host}:${this.settings.mqtt_port}`, {
        clientId: "hvac-hub",
        protocolId: "MQTT",
        protocolVersion: 4,
        clean: true,
        keepalive: 30,
        reconnectPeriod: 1000,
        connectTimeout: 10_000,
      });
      client.on("connect", () => {
        client.subscribe(this.subscribe_topic, (error) => {
          if (error) {
            console.error("mqtt subscribe failed:", error);
            return;
          }
          console.info(`mqtt subscribed to ${this.subscribe_topic}`);
        });
      });
      client.on("error", (error) => {
        console.error("mqtt connect failed:", error.message);
      });
      client.on("message", (topic, payload) => {
        try {
          this.handleMessage(topic, payload);
        } catch (error) {
          console.error("mqtt handler failed", error);
        }
      });
      this.client = client;
    } catch (error) {
      console.error("mqtt loop failed to start", error);
    }
  }

  /** Stop reconnects and disconnect. Safe to call twice. */
  close(): void {
    const client = this.client;
    this.client = null;
    if (client === null) {
      return;
    }
    client.end(true);
  }

  /**
   * Parse one MQTT message and store it if it is a valid reading.
   *
   * Returns true when a row was stored, false when the payload was dropped
   * (bad JSON, wrong topic, etc.). Tests call this directly so they do not
   * need a live broker. Extra JSON keys are ignored — a "command" field is
   * data, not an instruction.
   */
  handleMessage(topic: string, payload: Buffer | string | Uint8Array): boolean {
    const result = parseReading(topic, payload, this.clock.now());
    if (result.reading === null) {
      console.warn(`dropped mqtt payload on ${topic}: ${result.error}`);
      return false;
    }
    this.store.add(result.reading);
    const reading = result.reading;
    console.info(
      `reading ${reading.point_id}=${reading.value} ${reading.unit} quality=${reading.quality} node=${reading.node_id}`,
    );
    return true;
  }

  /** Node ids from points.json, in first-seen order. Phase 1 is just 'bench'. */
  listEquipment(): string[] {
    const equipment: string[] = [];
    for (const spec of this.settings.points) {
      if (!equipment.includes(spec.node_id)) {
        equipment.push(spec.node_id);
      }
    }
    return equipment;
  }

  /** Configured points, always writable=false. Optional filter by node id. */
  listPoints(equipmentId?: string | null): Point[] {
    const points: Point[] = [];
    for (const spec of this.settings.points) {
      if (equipmentId !== undefined && equipmentId !== null && spec.node_id !== equipmentId) {
        continue;
      }
      points.push({
        id: spec.id,
        name: spec.name,
        equipment_id: spec.node_id,
        unit: spec.unit,
        writable: false,
      });
    }
    return points;
  }

  /**
   * Latest classified value for one point.
   *
   * UnknownPoint is raised if the id is not in config and has never been
   * stored — we do not invent a heat-pump point on an AC-only bench.
   * Quality follows the live-page status so a stale or bad number is
   * never returned as trustworthy current data.
   */
  read(pointId: string): PointValue {
    const live = livePointFor(this.settings, this.store, pointId, this.clock.now());
    if (live === null) {
      throw new UnknownPoint(`unknown point ${pointId}`);
    }
    let quality: Quality;
    if (live.status === "live") {
      quality = Quality.GOOD;
    } else if (live.status === "bad") {
      quality = Quality.BAD;
    } else {
      quality = Quality.UNKNOWN;
    }
    return new PointValue({
      point_id: live.point_id,
      value: live.value,
      unit: live.unit,
      quality,
      timestamp: live.device_timestamp ?? this.clock.now(),
      raw: {
        status: live.status,
        node_id: live.node_id,
        age_seconds: live.age_seconds,
        received_at: live.received_at ? formatTimestamp(live.received_at) : null,
        time_source: live.time_source,
      },
    });
  }
}
