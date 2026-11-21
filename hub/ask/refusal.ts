/**
 * Control-intent refusal for Ask. Monitor-only: never coach on/off, setpoints,
 * or resets as actions the app can take. Logs control_refused for audit.
 */

const CONTROL_PATTERNS: RegExp[] = [
  /\b(turn|switch|shut)\s+(the\s+)?(ac|a\/c|furnace|heat|system|unit|compressor|blower|fan)\s+(on|off)\b/i,
  /\b(turn|switch)\s+(on|off)\s+(the\s+)?(ac|a\/c|furnace|heat|system|unit)\b/i,
  /\bset\s+(the\s+)?(temp|temperature|setpoint|thermostat)\b/i,
  /\bchange\s+(the\s+)?(setpoint|temperature)\b/i,
  /\b(raise|lower|increase|decrease)\s+(the\s+)?(setpoint|temperature)\b/i,
  /\breset\s+(the\s+)?(board|furnace|system|unit|thermostat)\b/i,
  /\b(command|control|actuate)\b/i,
  /\bignore\s+(your\s+)?(rules|safety|guardrails)\b/i,
];

const REFERRAL_PATTERNS: RegExp[] = [
  /\brefrigerant\b/i,
  /\badd\s+freon\b/i,
  /\bcapacitor\b/i,
  /\bcontactor\b/i,
  /\bline[- ]?voltage\b/i,
  /\bgas\s+valve\b/i,
  /\bopen\s+the\s+(panel|cabinet|unit)\b/i,
];

export type ControlLog = (event: {
  kind: "control_refused";
  question: string;
  reason: string;
}) => void;

const logs: Array<{ kind: string; question: string; reason: string; at: string }> = [];

/** In-memory audit for tests and local runs. Never sends to equipment. */
export function logControlRefused(question: string, reason: string): void {
  logs.push({
    kind: "control_refused",
    question,
    reason,
    at: new Date().toISOString(),
  });
}

export function getControlRefusalLog(): readonly {
  kind: string;
  question: string;
  reason: string;
  at: string;
}[] {
  return logs;
}

export function clearControlRefusalLog(): void {
  logs.length = 0;
}

export function detectControlIntent(question: string): string | null {
  for (const pattern of CONTROL_PATTERNS) {
    if (pattern.test(question)) {
      return `Matched control pattern: ${pattern.source}`;
    }
  }
  return null;
}

export function detectTechReferral(question: string): string | null {
  for (const pattern of REFERRAL_PATTERNS) {
    if (pattern.test(question)) {
      return pattern.source;
    }
  }
  return null;
}

export const CONTROL_REFUSAL_TEXT =
  "I can't turn equipment on or off, change setpoints, or reset boards. This app is monitor-only. Check Live readings and Alerts, and call a licensed technician for control or repair work.";

export const TECH_REFERRAL_TEXT =
  "Refrigerant, capacitors, contactors, line-voltage, and gas work are technician-only. I can list safe homeowner checks from the knowledge base, but a licensed tech should do that work.";
