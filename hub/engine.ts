/**
 * Pure fault rules engine. State in, readings in, alerts out.
 *
 * No I/O, no timers, no MQTT. Tests pass a frozen `now` and a series of
 * StoredReading rows. The ingest route and the cron route call this, then
 * persist. A missing installed point skips that rule instead of guessing.
 *
 * Monitor-only: this module never writes to equipment.
 */

import type { PointSpec } from "./config";
import { Quality, qualityIsGood, type StoredReading } from "./models";

export type Severity = "critical" | "warning";

export interface RuleDef {
  id: string;
  title: string;
  severity: Severity;
  enabled: boolean;
  params: Record<string, number>;
}

export interface RulesFile {
  version: number;
  constants: {
    compressor_running_amps: number;
    blower_running_amps: number;
    same_occurrence_window_s: number;
    startup_grace_s: number;
  };
  rules: RuleDef[];
}

export interface LedCodes {
  normal_values: number[];
  faults?: Record<string, { severity?: Severity; title?: string }>;
}

export interface ProposedAlert {
  ruleId: string;
  subject: string;
  title: string;
  severity: Severity;
  rulesVersion: number;
  systemName: string;
  detail: Record<string, unknown>;
}

export interface SkippedRule {
  ruleId: string;
  reason: string;
}

export interface EvaluateInput {
  now: Date;
  systemName: string;
  installed: readonly PointSpec[];
  series: readonly StoredReading[];
  rules: RulesFile;
  ledCodes?: LedCodes;
  staleAfterSeconds?: number;
}

export interface EvaluateResult {
  active: ProposedAlert[];
  skipped: SkippedRule[];
}

export function alertKey(ruleId: string, subject: string): string {
  return subject ? `${ruleId}:${subject}` : ruleId;
}

/** Seconds of history the runner should load so short_cycling / long_run can see a full window. */
export function historyWindowSeconds(rules: RulesFile): number {
  let max = 0;
  for (const rule of rules.rules) {
    for (const value of Object.values(rule.params)) {
      if (Number.isFinite(value) && value > max) max = value;
    }
  }
  return Math.max(max, 3600) + rules.constants.startup_grace_s + 60;
}

function installedIds(points: readonly PointSpec[]): Set<string> {
  return new Set(points.map((point) => point.id));
}

function installedNodes(points: readonly PointSpec[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const point of points) {
    if (seen.has(point.node_id)) continue;
    seen.add(point.node_id);
    out.push(point.node_id);
  }
  return out;
}

function hasAll(ids: Set<string>, needed: string[]): boolean {
  return needed.every((id) => ids.has(id));
}

function hasAny(ids: Set<string>, needed: string[]): boolean {
  return needed.some((id) => ids.has(id));
}

function secondsBetween(start: Date, end: Date): number {
  return (end.getTime() - start.getTime()) / 1000;
}

function readingAt(
  series: readonly StoredReading[],
  pointId: string,
  at: Date,
): StoredReading | null {
  let best: StoredReading | null = null;
  const t = at.getTime();
  for (const row of series) {
    if (row.point_id !== pointId) continue;
    const received = row.received_at.getTime();
    if (received > t) continue;
    if (!best || received > best.received_at.getTime()) best = row;
  }
  return best;
}

/** Last good numeric value at `at`. Stale or bad quality is not current. */
function goodNumberAt(
  series: readonly StoredReading[],
  pointId: string,
  at: Date,
  freshS: number | null,
): number | null {
  const row = readingAt(series, pointId, at);
  if (!row || row.value === null || !qualityIsGood(row.quality)) return null;
  if (freshS != null && secondsBetween(row.received_at, at) > freshS) return null;
  return row.value;
}

function isOn(value: number | null): boolean {
  return value != null && value >= 0.5;
}

function running(amps: number | null, threshold: number): boolean {
  return amps != null && amps > threshold;
}

function eventTimes(series: readonly StoredReading[], now: Date): Date[] {
  const seen = new Set<number>();
  const out: Date[] = [now];
  seen.add(now.getTime());
  for (const row of series) {
    const t = row.received_at.getTime();
    if (t > now.getTime() || seen.has(t)) continue;
    seen.add(t);
    out.push(row.received_at);
  }
  out.sort((a, b) => b.getTime() - a.getTime());
  return out;
}

function heldSeconds(
  now: Date,
  series: readonly StoredReading[],
  pred: (at: Date) => boolean,
): number {
  if (!pred(now)) return 0;
  let start = now;
  for (const t of eventTimes(series, now)) {
    if (!pred(t)) break;
    start = t;
  }
  return secondsBetween(start, now);
}

function earliestReading(series: readonly StoredReading[], now: Date): Date | null {
  let first: Date | null = null;
  const t = now.getTime();
  for (const row of series) {
    const received = row.received_at.getTime();
    if (received > t) continue;
    if (!first || received < first.getTime()) first = row.received_at;
  }
  return first;
}

function lastNodeReading(
  series: readonly StoredReading[],
  nodeId: string,
  now: Date,
): StoredReading | null {
  let best: StoredReading | null = null;
  const t = now.getTime();
  for (const row of series) {
    if (row.node_id !== nodeId) continue;
    const received = row.received_at.getTime();
    if (received > t) continue;
    if (!best || received > best.received_at.getTime()) best = row;
  }
  return best;
}

function compressorStarts(
  series: readonly StoredReading[],
  now: Date,
  windowS: number,
  threshold: number,
): number {
  const windowStart = now.getTime() - windowS * 1000;
  const samples = series
    .filter((row) => row.point_id === "compressor_amps" && row.received_at.getTime() <= now.getTime())
    .sort((a, b) => a.received_at.getTime() - b.received_at.getTime());
  let prevRunning = false;
  let starts = 0;
  for (const row of samples) {
    const isRun =
      row.value !== null && qualityIsGood(row.quality) && row.value > threshold;
    const inWindow = row.received_at.getTime() >= windowStart;
    if (inWindow && isRun && !prevRunning) starts += 1;
    prevRunning = isRun;
  }
  return starts;
}

function deltaT(
  series: readonly StoredReading[],
  at: Date,
  freshS: number,
): number | null {
  const ret = goodNumberAt(series, "return_air_temp", at, freshS);
  const sup = goodNumberAt(series, "supply_air_temp", at, freshS);
  if (ret === null || sup === null) return null;
  return ret - sup;
}

function propose(
  rule: RuleDef,
  rules: RulesFile,
  systemName: string,
  subject: string,
  detail: Record<string, unknown>,
  severity: Severity = rule.severity,
  title: string = rule.title,
): ProposedAlert {
  return {
    ruleId: rule.id,
    subject,
    title,
    severity,
    rulesVersion: rules.version,
    systemName,
    detail,
  };
}

function findRule(rules: RulesFile, id: string): RuleDef | undefined {
  return rules.rules.find((rule) => rule.id === id);
}

/**
 * Evaluate every enabled rule against `series` at `now`.
 * Missing required points skip. Output is currently-true alerts, not DB rows.
 */
export function evaluate(input: EvaluateInput): EvaluateResult {
  const { now, systemName, installed, series, rules } = input;
  const ledCodes = input.ledCodes ?? { normal_values: [0] };
  const freshS = input.staleAfterSeconds ?? 120;
  const ids = installedIds(installed);
  const c = rules.constants;
  const active: ProposedAlert[] = [];
  const skipped: SkippedRule[] = [];

  const skip = (ruleId: string, reason: string) => {
    skipped.push({ ruleId, reason });
  };

  const callNoCompressor = findRule(rules, "call_no_compressor");
  if (callNoCompressor) {
    if (!callNoCompressor.enabled) {
      skip(callNoCompressor.id, "disabled");
    } else if (!hasAll(ids, ["call_y", "compressor_amps"])) {
      skip(callNoCompressor.id, "point not installed");
    } else {
      const afterS = callNoCompressor.params.after_s;
      const pred = (at: Date) => {
        const y = goodNumberAt(series, "call_y", at, freshS);
        const amps = goodNumberAt(series, "compressor_amps", at, freshS);
        return isOn(y) && amps !== null && amps <= c.compressor_running_amps;
      };
      const held = heldSeconds(now, series, pred);
      if (held >= afterS) {
        active.push(
          propose(callNoCompressor, rules, systemName, "", {
            call_y: goodNumberAt(series, "call_y", now, freshS),
            compressor_amps: goodNumberAt(series, "compressor_amps", now, freshS),
            held_s: held,
            after_s: afterS,
          }),
        );
      }
    }
  }

  const callNoBlower = findRule(rules, "call_no_blower");
  if (callNoBlower) {
    if (!callNoBlower.enabled) {
      skip(callNoBlower.id, "disabled");
    } else if (!ids.has("blower_amps") || !hasAny(ids, ["call_g", "call_y"])) {
      skip(callNoBlower.id, "point not installed");
    } else {
      const afterS = callNoBlower.params.after_s;
      const pred = (at: Date) => {
        const g = ids.has("call_g") ? goodNumberAt(series, "call_g", at, freshS) : 0;
        const y = ids.has("call_y") ? goodNumberAt(series, "call_y", at, freshS) : 0;
        const amps = goodNumberAt(series, "blower_amps", at, freshS);
        return (isOn(g) || isOn(y)) && amps !== null && amps <= c.blower_running_amps;
      };
      const held = heldSeconds(now, series, pred);
      if (held >= afterS) {
        active.push(
          propose(callNoBlower, rules, systemName, "", {
            call_g: ids.has("call_g") ? goodNumberAt(series, "call_g", now, freshS) : null,
            call_y: ids.has("call_y") ? goodNumberAt(series, "call_y", now, freshS) : null,
            blower_amps: goodNumberAt(series, "blower_amps", now, freshS),
            held_s: held,
            after_s: afterS,
          }),
        );
      }
    }
  }

  const lowDelta = findRule(rules, "low_delta_t");
  if (lowDelta) {
    if (!lowDelta.enabled) {
      skip(lowDelta.id, "disabled");
    } else if (!hasAll(ids, ["compressor_amps", "return_air_temp", "supply_air_temp"])) {
      skip(lowDelta.id, "point not installed");
    } else {
      const minRun = lowDelta.params.min_run_s;
      const below = lowDelta.params.below_f;
      const runHeld = heldSeconds(now, series, (at) =>
        running(goodNumberAt(series, "compressor_amps", at, freshS), c.compressor_running_amps),
      );
      const dt = deltaT(series, now, freshS);
      if (runHeld >= minRun && dt !== null && dt < below) {
        active.push(
          propose(lowDelta, rules, systemName, "", {
            delta_t: dt,
            below_f: below,
            run_s: runHeld,
            min_run_s: minRun,
            compressor_amps: goodNumberAt(series, "compressor_amps", now, freshS),
          }),
        );
      }
    }
  }

  const highDelta = findRule(rules, "high_delta_t");
  if (highDelta) {
    if (!highDelta.enabled) {
      skip(highDelta.id, "disabled");
    } else if (!hasAll(ids, ["compressor_amps", "return_air_temp", "supply_air_temp"])) {
      skip(highDelta.id, "point not installed");
    } else {
      const minRun = highDelta.params.min_run_s;
      const above = highDelta.params.above_f;
      const runHeld = heldSeconds(now, series, (at) =>
        running(goodNumberAt(series, "compressor_amps", at, freshS), c.compressor_running_amps),
      );
      const dt = deltaT(series, now, freshS);
      if (runHeld >= minRun && dt !== null && dt > above) {
        active.push(
          propose(highDelta, rules, systemName, "", {
            delta_t: dt,
            above_f: above,
            run_s: runHeld,
            min_run_s: minRun,
            compressor_amps: goodNumberAt(series, "compressor_amps", now, freshS),
          }),
        );
      }
    }
  }

  const shortCycling = findRule(rules, "short_cycling");
  if (shortCycling) {
    if (!shortCycling.enabled) {
      skip(shortCycling.id, "disabled");
    } else if (!ids.has("compressor_amps")) {
      skip(shortCycling.id, "point not installed");
    } else {
      const windowS = shortCycling.params.window_s;
      const maxStarts = shortCycling.params.max_starts;
      const starts = compressorStarts(series, now, windowS, c.compressor_running_amps);
      if (starts > maxStarts) {
        active.push(
          propose(shortCycling, rules, systemName, "", {
            starts,
            max_starts: maxStarts,
            window_s: windowS,
          }),
        );
      }
    }
  }

  const longRun = findRule(rules, "long_run");
  if (longRun) {
    if (!longRun.enabled) {
      skip(longRun.id, "disabled");
    } else if (!hasAll(ids, ["compressor_amps", "return_air_temp", "supply_air_temp"])) {
      skip(longRun.id, "point not installed");
    } else {
      const runS = longRun.params.run_s;
      const below = longRun.params.below_f;
      const runHeld = heldSeconds(now, series, (at) =>
        running(goodNumberAt(series, "compressor_amps", at, freshS), c.compressor_running_amps),
      );
      const dt = deltaT(series, now, freshS);
      if (runHeld >= runS && dt !== null && dt < below) {
        active.push(
          propose(longRun, rules, systemName, "", {
            delta_t: dt,
            below_f: below,
            run_s: runHeld,
            need_run_s: runS,
            compressor_amps: goodNumberAt(series, "compressor_amps", now, freshS),
          }),
        );
      }
    }
  }

  const boardFault = findRule(rules, "board_fault");
  if (boardFault) {
    if (!boardFault.enabled) {
      skip(boardFault.id, "disabled");
    } else if (!ids.has("led_code")) {
      skip(boardFault.id, "point not installed");
    } else {
      const afterS = boardFault.params.after_s;
      const normal = new Set(ledCodes.normal_values);
      const codeNow = goodNumberAt(series, "led_code", now, freshS);
      const pred = (at: Date) => {
        const code = goodNumberAt(series, "led_code", at, freshS);
        return code !== null && !normal.has(code);
      };
      const held = heldSeconds(now, series, pred);
      if (codeNow !== null && !normal.has(codeNow) && held >= afterS) {
        const decoded = ledCodes.faults?.[String(codeNow)];
        const unknown = !decoded;
        active.push(
          propose(
            boardFault,
            rules,
            systemName,
            "",
            {
              led_code: codeNow,
              held_s: held,
              after_s: afterS,
              unknown,
            },
            unknown ? "warning" : (decoded.severity ?? boardFault.severity),
            decoded?.title ?? boardFault.title,
          ),
        );
      }
    }
  }

  const staleSensor = findRule(rules, "stale_sensor");
  if (staleSensor) {
    if (!staleSensor.enabled) {
      skip(staleSensor.id, "disabled");
    } else if (installed.length === 0) {
      skip(staleSensor.id, "point not installed");
    } else {
      const afterS = staleSensor.params.after_s;
      const first = earliestReading(series, now);
      const pastGrace =
        first !== null && secondsBetween(first, now) >= c.startup_grace_s;
      for (const point of installed) {
        const row = readingAt(series, point.id, now);
        if (row === null) {
          if (!pastGrace) continue;
          active.push(
            propose(staleSensor, rules, systemName, point.id, {
              point_id: point.id,
              missing: true,
              after_s: afterS,
            }),
          );
          continue;
        }
        const age = secondsBetween(row.received_at, now);
        const qualityOk = qualityIsGood(row.quality);
        if (age >= afterS || !qualityOk) {
          active.push(
            propose(staleSensor, rules, systemName, point.id, {
              point_id: point.id,
              age_s: age,
              quality: row.quality,
              after_s: afterS,
            }),
          );
        }
      }
    }
  }

  const nodeOffline = findRule(rules, "node_offline");
  if (nodeOffline) {
    if (!nodeOffline.enabled) {
      skip(nodeOffline.id, "disabled");
    } else {
      const afterS = nodeOffline.params.after_s;
      const nodes = installedNodes(installed);
      if (nodes.length === 0) {
        skip(nodeOffline.id, "point not installed");
      } else {
        const first = earliestReading(series, now);
        const pastGrace =
          first !== null && secondsBetween(first, now) >= c.startup_grace_s;
        for (const nodeId of nodes) {
          const row = lastNodeReading(series, nodeId, now);
          if (row === null) {
            if (!pastGrace) continue;
            active.push(
              propose(nodeOffline, rules, systemName, nodeId, {
                node_id: nodeId,
                missing: true,
                after_s: afterS,
              }),
            );
            continue;
          }
          const age = secondsBetween(row.received_at, now);
          if (age >= afterS) {
            active.push(
              propose(nodeOffline, rules, systemName, nodeId, {
                node_id: nodeId,
                age_s: age,
                after_s: afterS,
              }),
            );
          }
        }
      }
    }
  }

  return { active, skipped };
}

/** Quality.BAD is not "current". Re-export for tests that want the same gate. */
export { Quality };
