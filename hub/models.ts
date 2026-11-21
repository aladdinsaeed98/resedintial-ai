/**
 * Reading types shared with the rest of the hub.
 *
 * These are the nouns the rest of the hub passes around: a Point (a named
 * sensor), a PointValue (one sample), Quality, and StoredReading (one SQLite
 * row). The hub is monitor-only. Adapters refuse writes by raising
 * WriteNotSupported — that is the safety gate, not a TODO.
 *
 * If a future adapter grows a write() that does not raise, that is a bug.
 */

/** How much we trust a sample. UNKNOWN is not a pass; only GOOD is current. */
export enum Quality {
  GOOD = "good",
  BAD = "bad",
  UNKNOWN = "unknown",
}

/** True only for Quality.GOOD. UNKNOWN is not good. Never silently promote it. */
export function qualityIsGood(quality: Quality): boolean {
  return quality === Quality.GOOD;
}

/** Connection or contract failure. Base for UnknownPoint. */
export class GatewayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GatewayError";
  }
}

/** The profile and the store have never seen this point. Do not invent one. */
export class UnknownPoint extends GatewayError {
  constructor(message: string) {
    super(message);
    this.name = "UnknownPoint";
  }
}

/**
 * Raised by adapters that have no write path. Safe by omission.
 *
 * BuildingGateway.write() always raises this so a monitor adapter cannot
 * send a setpoint or a relay command even if a caller asks.
 */
export class WriteNotSupported extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WriteNotSupported";
  }
}

/** A configured sensor. writable is always False on this hub. */
export interface Point {
  id: string;
  name: string;
  equipment_id: string;
  unit: string;
  writable: boolean;
  description?: string;
}

/** One reading as returned by gateway.read(). value may be null when not live. */
export class PointValue {
  point_id: string;
  value: number | null;
  unit: string;
  quality: Quality;
  timestamp: Date;
  raw: Record<string, unknown>;

  constructor(fields: {
    point_id: string;
    value: number | null;
    unit: string;
    quality: Quality;
    timestamp: Date;
    raw?: Record<string, unknown>;
  }) {
    this.point_id = fields.point_id;
    this.value = fields.value;
    this.unit = fields.unit;
    this.quality = fields.quality;
    this.timestamp = fields.timestamp;
    this.raw = fields.raw ?? {};
  }

  /** True when this number may be shown or used as current. Stale/null fail. */
  trustworthy(): boolean {
    return qualityIsGood(this.quality) && this.value !== null;
  }
}

/**
 * One SQLite row: the node's stamp plus the hub's receive time.
 *
 * time_source is 'device' when the payload had a timestamp, 'hub' when we
 * filled it in (ESP32 had no NTP yet). received_at is what stale uses.
 */
export interface StoredReading {
  point_id: string;
  node_id: string;
  value: number | null;
  unit: string;
  quality: Quality;
  device_timestamp: Date;
  received_at: Date;
  time_source: string;
}

/**
 * Read port. The default write is refused so a monitor adapter stays safe.
 *
 * Concrete adapters (MqttGateway) implement connect, close, list*, and
 * read. They inherit write() unless they override it — and they must not.
 */
export abstract class BuildingGateway {
  backend_name = "";
  adapter_kind = "unknown";
  supports_write = false;

  connect(): void {
    throw new Error("not implemented");
  }

  close(): void {
    throw new Error("not implemented");
  }

  listEquipment(): string[] {
    throw new Error("not implemented");
  }

  listPoints(_equipmentId?: string | null): Point[] {
    throw new Error("not implemented");
  }

  read(_pointId: string): PointValue {
    throw new Error("not implemented");
  }

  /** Read several points. Default is a loop over read(); no writes involved. */
  readMany(pointIds: Iterable<string>): Record<string, PointValue> {
    const out: Record<string, PointValue> = {};
    for (const pointId of pointIds) {
      out[pointId] = this.read(pointId);
    }
    return out;
  }

  /** Always refuse. This is the no-write-path rule, not an unfinished method. */
  write(_pointId: string, _value: unknown): never {
    throw new WriteNotSupported(
      `${this.constructor.name} does not support writes (supports_write=${this.supports_write})`,
    );
  }
}
