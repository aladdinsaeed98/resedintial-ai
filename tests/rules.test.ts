/**
 * Phase B fault rules. One case per rule: fire, no-fire, and the timing
 * threshold. Simulated series, frozen clock. Modeled on PLAN R1–R7.
 */

import { expect, test } from "vitest";

import { diffAlerts, type AlertRecord } from "../hub/alerts";
import { loadSettings, type PointSpec } from "../hub/config";
import { evaluate, type ProposedAlert } from "../hub/engine";
import { Quality, type StoredReading } from "../hub/models";
import { loadLedCodes, loadRules } from "../hub/rules";
import { benchReadings } from "../simulator/bench-publisher";

const NOW = new Date("2026-11-21T12:00:00Z");
const RULES = loadRules();
const LED = loadLedCodes();
const INSTALLED = loadSettings({}).points;

function at(secondsAgo: number): Date {
  return new Date(NOW.getTime() - secondsAgo * 1000);
}

function unitFor(pointId: string): string {
  if (pointId.endsWith("_temp")) return "F";
  if (pointId.endsWith("_amps")) return "A";
  if (pointId.startsWith("call_")) return "bool";
  if (pointId === "led_code") return "code";
  return "F";
}

function sample(
  pointId: string,
  value: number,
  secondsAgo: number,
  extra?: Partial<StoredReading>,
): StoredReading {
  const when = at(secondsAgo);
  return {
    point_id: pointId,
    node_id: extra?.node_id ?? "bench",
    value,
    unit: extra?.unit ?? unitFor(pointId),
    quality: extra?.quality ?? Quality.GOOD,
    device_timestamp: extra?.device_timestamp ?? when,
    received_at: extra?.received_at ?? when,
    time_source: extra?.time_source ?? "hub",
  };
}

const HEALTHY = {
  return_air_temp: 74,
  supply_air_temp: 56,
  call_y: 0,
  call_g: 0,
  compressor_amps: 0.1,
  blower_amps: 0.1,
  led_code: 0,
};

function tick(
  secondsAgo: number,
  over: Partial<typeof HEALTHY> = {},
  extra?: { quality?: Quality; node_id?: string; omit?: string[] },
): StoredReading[] {
  const values = { ...HEALTHY, ...over };
  const omit = new Set(extra?.omit ?? []);
  const out: StoredReading[] = [];
  for (const [pointId, value] of Object.entries(values)) {
    if (omit.has(pointId)) continue;
    out.push(
      sample(pointId, value, secondsAgo, {
        quality: extra?.quality,
        node_id: extra?.node_id,
      }),
    );
  }
  return out;
}

function hold(
  fromAgo: number,
  toAgo: number,
  over: Partial<typeof HEALTHY> | ((ago: number) => Partial<typeof HEALTHY>) = {},
  step = 10,
): StoredReading[] {
  const series: StoredReading[] = [];
  for (let ago = fromAgo; ago >= toAgo; ago -= step) {
    const patch = typeof over === "function" ? over(ago) : over;
    series.push(...tick(ago, patch));
  }
  return series;
}

function run(
  series: StoredReading[],
  installed: readonly PointSpec[] = INSTALLED,
) {
  return evaluate({
    now: NOW,
    systemName: "Bench",
    installed,
    series,
    rules: RULES,
    ledCodes: LED,
    staleAfterSeconds: 120,
  });
}

function activeIds(series: StoredReading[], installed?: readonly PointSpec[]): string[] {
  return run(series, installed).active.map((row) =>
    row.subject ? `${row.ruleId}:${row.subject}` : row.ruleId,
  );
}

function proposed(ruleId: string): ProposedAlert {
  return {
    ruleId,
    subject: "",
    title: "Cooling call, compressor not running",
    severity: "critical",
    rulesVersion: 1,
    systemName: "Bench",
    detail: { held_s: 180 },
  };
}

test("shipped rules.json matches the reference placeholders", () => {
  expect(RULES.version).toBe(1);
  expect(RULES.constants).toEqual({
    compressor_running_amps: 2.0,
    blower_running_amps: 0.8,
    same_occurrence_window_s: 1800,
    startup_grace_s: 120,
  });
  expect(RULES.rules.map((rule) => rule.id)).toEqual([
    "call_no_compressor",
    "call_no_blower",
    "low_delta_t",
    "high_delta_t",
    "short_cycling",
    "long_run",
    "board_fault",
    "stale_sensor",
    "node_offline",
  ]);
  expect(LED.normal_values).toEqual([0]);
});

test("R1 normal cooling day fires no alerts", () => {
  const series = hold(650, 0, {
    call_y: 1,
    compressor_amps: 5.2,
    blower_amps: 2.4,
  });
  expect(run(series).active).toEqual([]);
});

test("call_no_compressor fire, no-fire, and 180s threshold", () => {
  const signature = { call_y: 1, compressor_amps: 0.1, blower_amps: 2.4 };
  expect(activeIds(hold(180, 0, { call_y: 0, compressor_amps: 0.1 }))).not.toContain(
    "call_no_compressor",
  );
  expect(activeIds(hold(180, 0, { call_y: 1, compressor_amps: 5.2, blower_amps: 2.4 }))).not.toContain(
    "call_no_compressor",
  );
  expect(activeIds(hold(170, 0, signature))).not.toContain("call_no_compressor");
  expect(activeIds(hold(180, 0, signature))).toContain("call_no_compressor");
});

test("call_no_blower fire, no-fire, and 120s threshold", () => {
  const signature = { call_y: 0, call_g: 1, compressor_amps: 5.2, blower_amps: 0.1 };
  expect(activeIds(hold(120, 0, { call_y: 0, call_g: 0, blower_amps: 0.1 }))).not.toContain(
    "call_no_blower",
  );
  expect(activeIds(hold(120, 0, { call_y: 1, compressor_amps: 5.2, blower_amps: 2.4 }))).not.toContain(
    "call_no_blower",
  );
  expect(activeIds(hold(110, 0, signature))).not.toContain("call_no_blower");
  expect(activeIds(hold(120, 0, signature))).toContain("call_no_blower");
  expect(
    activeIds(hold(120, 0, { call_y: 1, call_g: 0, compressor_amps: 5.2, blower_amps: 0.1 })),
  ).toContain("call_no_blower");
});

test("low_delta_t fire, no-fire, and 600s threshold", () => {
  const low = {
    call_y: 1,
    compressor_amps: 5.2,
    blower_amps: 2.4,
    return_air_temp: 70,
    supply_air_temp: 62,
  };
  const healthyDt = { call_y: 1, compressor_amps: 5.2, blower_amps: 2.4 };
  expect(activeIds(hold(600, 0, { ...low, compressor_amps: 0.1 }))).not.toContain("low_delta_t");
  expect(activeIds(hold(600, 0, healthyDt))).not.toContain("low_delta_t");
  expect(activeIds(hold(590, 0, low))).not.toContain("low_delta_t");
  expect(activeIds(hold(600, 0, low))).toContain("low_delta_t");
});

test("high_delta_t fire, no-fire, and 600s threshold", () => {
  const high = {
    call_y: 1,
    compressor_amps: 5.2,
    blower_amps: 2.4,
    return_air_temp: 80,
    supply_air_temp: 50,
  };
  const healthyDt = { call_y: 1, compressor_amps: 5.2, blower_amps: 2.4 };
  expect(activeIds(hold(600, 0, healthyDt))).not.toContain("high_delta_t");
  expect(activeIds(hold(590, 0, high))).not.toContain("high_delta_t");
  expect(activeIds(hold(600, 0, high))).toContain("high_delta_t");
});

test("short_cycling fire, no-fire, and more-than-4-starts threshold", () => {
  function pulses(starts: number): StoredReading[] {
    const series: StoredReading[] = [];
    series.push(...tick(3590, { compressor_amps: 0.1 }));
    for (let i = 0; i < starts; i += 1) {
      const ago = 3400 - i * 600;
      series.push(...tick(ago + 10, { compressor_amps: 0.1 }));
      series.push(...tick(ago, { compressor_amps: 8.0 }));
      series.push(...tick(ago - 10, { compressor_amps: 0.1 }));
    }
    series.push(...tick(0, { compressor_amps: 0.1 }));
    return series;
  }
  expect(activeIds(pulses(4))).not.toContain("short_cycling");
  expect(activeIds(pulses(5))).toContain("short_cycling");
});

test("long_run fire, no-fire, and 3600s threshold", () => {
  const stuck = {
    call_y: 1,
    compressor_amps: 5.2,
    blower_amps: 2.4,
    return_air_temp: 70,
    supply_air_temp: 62,
  };
  const recovered = { call_y: 1, compressor_amps: 5.2, blower_amps: 2.4 };
  expect(activeIds(hold(3600, 0, recovered))).not.toContain("long_run");
  expect(activeIds(hold(3590, 0, stuck))).not.toContain("long_run");
  expect(activeIds(hold(3600, 0, stuck))).toContain("long_run");
});

test("board_fault fire, no-fire, 30s threshold, unknown is warning", () => {
  expect(activeIds(hold(30, 0, { led_code: 0 }))).not.toContain("board_fault");
  expect(activeIds(hold(20, 0, { led_code: 3 }))).not.toContain("board_fault");
  const fired = run(hold(30, 0, { led_code: 3 })).active.find((row) => row.ruleId === "board_fault");
  expect(fired).toBeTruthy();
  expect(fired?.severity).toBe("warning");
  expect(fired?.detail.unknown).toBe(true);
  expect(fired?.detail.led_code).toBe(3);
});

test("stale_sensor fire, no-fire, and 120s threshold", () => {
  expect(activeIds(hold(200, 0)).some((id) => id.startsWith("stale_sensor"))).toBe(false);

  const silentAt = (stopAgo: number): StoredReading[] => {
    const series: StoredReading[] = [];
    for (let ago = 200; ago >= 0; ago -= 10) {
      series.push(...tick(ago, {}, { omit: ago < stopAgo ? ["supply_air_temp"] : [] }));
    }
    return series;
  };
  expect(activeIds(silentAt(110))).not.toContain("stale_sensor:supply_air_temp");
  expect(activeIds(silentAt(120))).toContain("stale_sensor:supply_air_temp");

  const bad = hold(200, 0).map((row) =>
    row.point_id === "return_air_temp" && row.received_at.getTime() === NOW.getTime()
      ? { ...row, quality: Quality.BAD }
      : row,
  );
  expect(activeIds(bad)).toContain("stale_sensor:return_air_temp");

  const missingPastGrace: StoredReading[] = [];
  for (let ago = 130; ago >= 0; ago -= 10) {
    missingPastGrace.push(...tick(ago, {}, { omit: ["led_code"] }));
  }
  expect(activeIds(missingPastGrace)).toContain("stale_sensor:led_code");
});

test("node_offline fire, no-fire, and 60s threshold", () => {
  expect(activeIds(hold(200, 50))).not.toContain("node_offline:bench");
  expect(activeIds(hold(200, 60))).toContain("node_offline:bench");

  const installed: PointSpec[] = [
    { id: "return_air_temp", name: "Return air", unit: "F", node_id: "bench" },
    { id: "compressor_amps", name: "Compressor amps", unit: "A", node_id: "outdoor" },
  ];
  const series: StoredReading[] = [];
  for (let ago = 200; ago >= 0; ago -= 10) {
    series.push(sample("return_air_temp", 74, ago, { node_id: "bench" }));
    if (ago >= 60) {
      series.push(sample("compressor_amps", 5.2, ago, { node_id: "outdoor" }));
    }
  }
  const ids = activeIds(series, installed);
  expect(ids).toContain("node_offline:outdoor");
  expect(ids).not.toContain("node_offline:bench");
});

test("rule skips cleanly when its point is not installed", () => {
  const tempsOnly = INSTALLED.filter(
    (point) => point.id === "return_air_temp" || point.id === "supply_air_temp",
  );
  const series = hold(200, 0, { call_y: 1, compressor_amps: 0.1, blower_amps: 0.1 });
  const result = run(series, tempsOnly);
  expect(result.skipped.some((row) => row.ruleId === "call_no_compressor" && row.reason === "point not installed")).toBe(
    true,
  );
  expect(result.active.map((row) => row.ruleId)).not.toContain("call_no_compressor");
  expect(result.active.map((row) => row.ruleId)).not.toContain("call_no_blower");
  expect(result.active.map((row) => row.ruleId)).not.toContain("board_fault");
});

test("dedupe inside and outside the 30-min window", () => {
  const windowS = RULES.constants.same_occurrence_window_s;
  expect(windowS).toBe(1800);
  const fire = [proposed("call_no_compressor")];
  const opened = diffAlerts(NOW, [], fire, windowS);
  expect(opened).toHaveLength(1);
  expect(opened[0].type).toBe("create");
  if (opened[0].type !== "create") throw new Error("expected create");

  const openRow: AlertRecord = { id: "a1", ...opened[0].record };
  const clearedAt = new Date(NOW.getTime() + 60_000);
  const clears = diffAlerts(clearedAt, [openRow], [], windowS);
  expect(clears).toEqual([{ type: "clear", id: "a1", clearedAt }]);

  const closed: AlertRecord = { ...openRow, clearedAt };
  const inside = new Date(clearedAt.getTime() + 1_799_000);
  const reopen = diffAlerts(inside, [closed], fire, windowS);
  expect(reopen).toHaveLength(1);
  expect(reopen[0].type).toBe("reopen");
  if (reopen[0].type !== "reopen") throw new Error("expected reopen");
  expect(reopen[0].occurrence).toBe(2);

  const outside = new Date(clearedAt.getTime() + 1_801_000);
  const fresh = diffAlerts(outside, [closed], fire, windowS);
  expect(fresh).toHaveLength(1);
  expect(fresh[0].type).toBe("create");
});

test("simulator can hold each fault signature", () => {
  const noComp = benchReadings(0, "call_no_compressor");
  expect(noComp.find((row) => row.point === "call_y")?.value).toBe(1);
  expect(noComp.find((row) => row.point === "compressor_amps")?.value).toBeLessThanOrEqual(2);
  expect(benchReadings(0, "board_fault").find((row) => row.point === "led_code")?.value).toBe(3);
  expect(benchReadings(0, "stale_sensor").some((row) => row.point === "supply_air_temp")).toBe(false);
  expect(benchReadings(0, "node_offline")).toEqual([]);
  const low = benchReadings(0, "low_delta_t");
  const ret = low.find((row) => row.point === "return_air_temp")?.value ?? 0;
  const sup = low.find((row) => row.point === "supply_air_temp")?.value ?? 0;
  expect(ret - sup).toBeLessThan(14);
});
