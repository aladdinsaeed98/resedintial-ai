/**
 * Local demo mode. Serves realistic fake readings and alerts so the UI can
 * be reviewed without MQTT, the collector, or Postgres.
 *
 * Off by default. Impossible in production (NODE_ENV or VERCEL_ENV).
 * Set HVAC_DEMO=1 in .env.local only. Never enables a write path.
 */

import { formatTimestamp } from "./clock";
import { loadSettings, type PointSpec, type Settings } from "./config";
import type { PublicSnapshot } from "./live";
import { loadRules } from "./rules";

/** True only when HVAC_DEMO=1 and we are not in a production deploy. */
export function isDemoMode(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.NODE_ENV === "production" || env.VERCEL_ENV === "production") {
    return false;
  }
  return String(env.HVAC_DEMO ?? "").trim() === "1";
}

export interface DemoPointExtras {
  plain_label: string;
  description: string;
  sparkline: number[];
}

export interface DemoAlertRow {
  id: string;
  rule_id: string;
  subject: string;
  rules_version: number;
  severity: string;
  title: string;
  system_name: string;
  opened_at: string;
  last_seen_at: string;
  cleared_at: string | null;
  occurrence: number;
  detail: Record<string, unknown>;
  hint: string;
}

export interface DemoHistoryRow {
  id: string;
  recorded_at: string;
  kind: string;
  severity: string;
  title: string;
  detail: string;
  point_id: string | null;
  value: number | null;
  unit: string | null;
}

const PLAIN: Record<string, { plain: string; description: string }> = {
  return_air_temp: {
    plain: "Air coming in",
    description: "Temperature of air entering the furnace from the return duct.",
  },
  supply_air_temp: {
    plain: "Air coming out",
    description: "Temperature of air leaving the coil into the supply plenum.",
  },
  call_y: {
    plain: "Cooling request",
    description: "Thermostat Y call — the thermostat is asking for cooling.",
  },
  call_g: {
    plain: "Fan request",
    description: "Thermostat G call — the thermostat is asking for the blower.",
  },
  compressor_amps: {
    plain: "Compressor draw",
    description: "Current on one compressor conductor. Near zero means not running.",
  },
  blower_amps: {
    plain: "Blower draw",
    description: "Current on one blower conductor. Near zero means the fan is off.",
  },
  led_code: {
    plain: "Board status light",
    description: "Furnace board LED pattern as a number. Zero means normal.",
  },
};

const ALERT_HINTS: Record<string, string> = {
  high_delta_t:
    "Check the filter and return vents for blockage. If airflow looks fine, have a technician check the blower and coil.",
  low_delta_t:
    "Confirm the outdoor unit is running and the filter is clean. Persistent low delta-T is technician work.",
  call_no_compressor:
    "Check the outdoor disconnect and breaker. Do not open the unit — call a licensed technician.",
  call_no_blower:
    "Check the furnace switch and filter. If the blower still will not start, call a technician.",
  short_cycling:
    "Note how often it starts. A technician should check the start components and charge.",
  long_run:
    "Check filters and registers. Long runs with weak cooling need a technician visit.",
  board_fault:
    "Write down the LED pattern from the board label. Power-cycle only if the label says it is safe; otherwise call a technician.",
  stale_sensor:
    "Confirm the sensor node has power and Wi-Fi. Restart the collector if the rest of the house is online.",
  node_offline:
    "Check power and Wi-Fi at the sensor node. The collector must be running next to Mosquitto.",
};

function metaFor(spec: PointSpec): { plain: string; description: string } {
  return (
    PLAIN[spec.id] ?? {
      plain: spec.name,
      description: `Configured sensor ${spec.id} (${spec.unit}).`,
    }
  );
}

/** Slow sine drift so tiles feel live without jumping. */
function drift(seed: number, nowMs: number, amplitude: number): number {
  const t = nowMs / 60_000;
  return Math.sin(t * 1.7 + seed) * amplitude + Math.sin(t * 0.4 + seed * 2) * amplitude * 0.35;
}

function sparkline(base: number, seed: number, nowMs: number, amplitude: number): number[] {
  const out: number[] = [];
  for (let i = 23; i >= 0; i -= 1) {
    const at = nowMs - i * 60_000;
    out.push(Math.round((base + drift(seed, at, amplitude)) * 10) / 10);
  }
  return out;
}

function demoValue(spec: PointSpec, nowMs: number): number {
  switch (spec.id) {
    case "return_air_temp":
      return Math.round((74.2 + drift(1, nowMs, 0.6)) * 10) / 10;
    case "supply_air_temp":
      return Math.round((56.8 + drift(2, nowMs, 0.5)) * 10) / 10;
    case "call_y":
      return 1;
    case "call_g":
      return 1;
    case "compressor_amps":
      return Math.round((8.4 + drift(3, nowMs, 0.35)) * 10) / 10;
    case "blower_amps":
      return Math.round((2.1 + drift(4, nowMs, 0.12)) * 10) / 10;
    case "led_code":
      return 0;
    default:
      if (spec.unit === "bool") return 1;
      if (spec.unit === "code") return 0;
      if (spec.unit === "A") return Math.round((3 + drift(5, nowMs, 0.2)) * 10) / 10;
      return Math.round((70 + drift(6, nowMs, 1)) * 10) / 10;
  }
}

function amplitudeFor(spec: PointSpec): number {
  if (spec.unit === "F" || spec.unit === "C") return 0.8;
  if (spec.unit === "A") return 0.4;
  return 0.2;
}

/** Snapshot shaped like GET /api/readings, plus demo extras on each point. */
export function demoReadingsPayload(
  now: Date = new Date(),
  settings: Settings = loadSettings(),
): PublicSnapshot & {
  mqtt_connected: boolean;
  demo: true;
  points: Array<Record<string, unknown>>;
} {
  const nowMs = now.getTime();
  const points = settings.points.map((spec, index) => {
    const value = demoValue(spec, nowMs);
    const meta = metaFor(spec);
    const amp = amplitudeFor(spec);
    const series =
      spec.unit === "bool" || spec.unit === "code"
        ? []
        : sparkline(value, index + 1, nowMs, amp);
    return {
      point_id: spec.id,
      name: spec.name,
      plain_label: meta.plain,
      description: meta.description,
      node_id: spec.node_id,
      unit: spec.unit,
      status: "live",
      quality: "good",
      value,
      age_seconds: 2 + (index % 4),
      device_timestamp: formatTimestamp(now),
      received_at: formatTimestamp(now),
      time_source: "demo",
      sparkline: series,
    };
  });

  return {
    system_name: settings.system_name + " (demo)",
    server_time: formatTimestamp(now),
    stale_after_seconds: settings.stale_after_seconds,
    mqtt_connected: true,
    demo: true,
    points,
  };
}

/** One active warning and one cleared alert for the Alerts screen. */
export function demoAlertsPayload(now: Date = new Date()): {
  alerts: DemoAlertRow[];
  active_count: number;
  rules_version: number;
  demo: true;
} {
  let rulesVersion = 1;
  try {
    rulesVersion = loadRules().version;
  } catch {
    rulesVersion = 1;
  }
  const system = loadSettings().system_name + " (demo)";
  const opened = new Date(now.getTime() - 18 * 60_000);
  const clearedOpen = new Date(now.getTime() - 3 * 60 * 60_000);
  const clearedAt = new Date(now.getTime() - 90 * 60_000);

  const active: DemoAlertRow = {
    id: "demo-active-high-delta-t",
    rule_id: "high_delta_t",
    subject: "bench",
    rules_version: rulesVersion,
    severity: "warning",
    title: "High delta-T",
    system_name: system,
    opened_at: opened.toISOString(),
    last_seen_at: now.toISOString(),
    cleared_at: null,
    occurrence: 1,
    detail: { delta_t_f: 25.2, note: "demo" },
    hint: ALERT_HINTS.high_delta_t,
  };

  const cleared: DemoAlertRow = {
    id: "demo-cleared-stale-sensor",
    rule_id: "stale_sensor",
    subject: "supply_air_temp",
    rules_version: rulesVersion,
    severity: "warning",
    title: "Sensor not reporting",
    system_name: system,
    opened_at: clearedOpen.toISOString(),
    last_seen_at: clearedAt.toISOString(),
    cleared_at: clearedAt.toISOString(),
    occurrence: 1,
    detail: { point_id: "supply_air_temp", note: "demo" },
    hint: ALERT_HINTS.stale_sensor,
  };

  return {
    alerts: [active, cleared],
    active_count: 1,
    rules_version: rulesVersion,
    demo: true,
  };
}

/** Sortable history rows for the History screen in demo mode. */
export function demoHistoryPayload(now: Date = new Date()): {
  rows: DemoHistoryRow[];
  demo: true;
} {
  const rows: DemoHistoryRow[] = [];
  for (let i = 0; i < 12; i += 1) {
    const at = new Date(now.getTime() - i * 15 * 60_000);
    const ret = Math.round((74 + drift(1, at.getTime(), 0.6)) * 10) / 10;
    const sup = Math.round((57 + drift(2, at.getTime(), 0.5)) * 10) / 10;
    rows.push({
      id: `demo-hist-dt-${i}`,
      recorded_at: at.toISOString(),
      kind: "delta_t",
      severity: ret - sup > 24 ? "warning" : "ok",
      title: "Delta-T sample",
      detail: `Return ${ret} °F · Supply ${sup} °F · ΔT ${(ret - sup).toFixed(1)} °F`,
      point_id: null,
      value: Math.round((ret - sup) * 10) / 10,
      unit: "F",
    });
  }
  rows.push({
    id: "demo-hist-alert",
    recorded_at: new Date(now.getTime() - 3 * 60 * 60_000).toISOString(),
    kind: "alert",
    severity: "warning",
    title: "Sensor not reporting",
    detail: "supply_air_temp went stale, then recovered",
    point_id: "supply_air_temp",
    value: null,
    unit: null,
  });
  return { rows, demo: true };
}

export function alertHint(ruleId: string): string {
  return (
    ALERT_HINTS[ruleId] ??
    "Review the readings on Live. Owner checks first (filter, breakers, thermostat); anything inside the unit is technician work."
  );
}
