/**
 * How a live value is written on a tile. Used by the Live page.
 *
 * Bool calls are On/Off. LED 0 is Normal; any other value is an unknown
 * code (no guessed brand table). Temps keep a degree sign.
 */

export function formatLedCode(value: number): string {
  const code = Math.round(value);
  if (code === 0) return "Normal";
  return "Unknown code " + String(code);
}

/** One decimal place, with a degree sign for F/C. Hub already hid non-live values. */
export function formatReading(value: number, unit: string): string {
  if (unit === "bool") return value >= 0.5 ? "On" : "Off";
  if (unit === "code") return formatLedCode(value);
  const shown = (Math.round(value * 10) / 10).toFixed(1);
  if (unit === "F" || unit === "C") return shown + " \u00b0" + unit;
  return shown + " " + unit;
}
