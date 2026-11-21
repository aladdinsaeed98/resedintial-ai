/**
 * Load committed config/rules.json and config/led_codes.json.
 *
 * Bump rules.version on every threshold change; each alert stores the
 * version that fired it. LED meanings come only from led_codes.json —
 * never a guessed brand table.
 */

import fs from "node:fs";
import path from "node:path";

import { ROOT } from "./config";
import type { LedCodes, RulesFile, Severity } from "./engine";

export const DEFAULT_RULES_FILE = path.join(ROOT, "config", "rules.json");
export const DEFAULT_LED_CODES_FILE = path.join(ROOT, "config", "led_codes.json");

const SEVERITIES = new Set<Severity>(["critical", "warning"]);

export function loadRules(filePath: string = DEFAULT_RULES_FILE): RulesFile {
  const data = JSON.parse(fs.readFileSync(filePath, "utf8")) as RulesFile;
  if (!Number.isInteger(data.version) || data.version < 1) {
    throw new Error(`${filePath} needs a positive integer version`);
  }
  if (!data.constants || !Array.isArray(data.rules)) {
    throw new Error(`${filePath} needs constants and rules`);
  }
  for (const rule of data.rules) {
    if (!rule.id || !rule.title) {
      throw new Error(`${filePath} has a rule without id/title`);
    }
    if (!SEVERITIES.has(rule.severity)) {
      throw new Error(`rule ${rule.id} has invalid severity`);
    }
  }
  return data;
}

export function loadLedCodes(filePath: string = DEFAULT_LED_CODES_FILE): LedCodes {
  const data = JSON.parse(fs.readFileSync(filePath, "utf8")) as {
    normal_values?: unknown;
    faults?: LedCodes["faults"];
  };
  const normal = Array.isArray(data.normal_values)
    ? data.normal_values.filter((value): value is number => typeof value === "number")
    : [0];
  return { normal_values: normal, faults: data.faults ?? {} };
}
