/**
 * Timezone-aware clocks. Tests advance ManualClock instead of waiting.
 *
 * Stale is decided from the hub's receive time, not the node's clock, so
 * every timestamp we store or print is UTC with a Z suffix. If the page
 * ages look wrong, check formatTimestamp / parseTimestamp first.
 */

/** Throw if we were handed a Date that is not a real instant. */
function assertValidDate(moment: Date, message: string): void {
  if (!(moment instanceof Date) || Number.isNaN(moment.getTime())) {
    throw new Error(message);
  }
}

/**
 * UTC ISO-8601 with seconds, always Z. Matches the firmware and the old
 * Python hub: no milliseconds, so wire JSON stays stable.
 */
export function formatTimestamp(moment: Date): string {
  assertValidDate(moment, "timestamp must be timezone-aware");
  return moment.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Parse a payload or SQLite timestamp into a UTC Date.
 * A trailing Z, an offset, or a naive string (treated as UTC) are all accepted.
 * Naive ISO strings are UTC, matching the Python hub — JS Date would otherwise
 * treat them as local time.
 */
export function parseTimestamp(text: string): Date {
  let cleaned = text.trim();
  if (cleaned.endsWith("Z")) {
    cleaned = `${cleaned.slice(0, -1)}+00:00`;
  } else if (!/[+-]\d{2}:\d{2}$/.test(cleaned)) {
    cleaned = `${cleaned}+00:00`;
  }
  const parsed = new Date(cleaned);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("invalid timestamp");
  }
  return parsed;
}

export interface Clock {
  now(): Date;
}

/** Wall clock. Used in production so received_at is the hub's real time. */
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

/**
 * Frozen clock for tests. advance(120) jumps two minutes without sleeping,
 * which is how the stale tests stay fast.
 */
export class ManualClock implements Clock {
  private current: Date;

  constructor(start: Date) {
    assertValidDate(start, "clock start must be timezone-aware");
    this.current = new Date(start.getTime());
  }

  now(): Date {
    return new Date(this.current.getTime());
  }

  advance(seconds: number): void {
    this.current = new Date(this.current.getTime() + seconds * 1000);
  }
}
