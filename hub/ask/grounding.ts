/**
 * Number grounding for Ask answers.
 *
 * Every number spoken must match a supplied context fact (±0.05, or integer
 * rounding). Failures are dropped or replaced — never left as hallucinations.
 */

export interface GroundingFact {
  key: string;
  label: string;
  value: number;
  unit?: string;
}

// Allow trailing punctuation (e.g. "412.") so grounding still sees the number.
const NUMBER_RE = /(?<![\w.])(-?\d+(?:\.\d+)?)(?!\d)/g;

function matchesFact(num: number, fact: GroundingFact): boolean {
  const delta = Math.abs(num - fact.value);
  if (delta <= 0.05) return true;
  if (Number.isInteger(Math.round(num)) && Math.round(num) === Math.round(fact.value)) {
    return Math.abs(Math.round(num) - fact.value) <= 0.5;
  }
  return false;
}

export interface GroundingResult {
  text: string;
  dropped: number[];
  ok: boolean;
}

/**
 * Walk numbers in `text`. Keep those that match a fact; replace others with
 * "[unavailable]" and record them in dropped.
 */
export function groundAnswerNumbers(
  text: string,
  facts: readonly GroundingFact[],
): GroundingResult {
  const dropped: number[] = [];
  const rewritten = text.replace(NUMBER_RE, (raw) => {
    const num = Number(raw);
    if (!Number.isFinite(num)) return raw;
    // Years / common non-reading integers that appear in copy stay if 1–3 digits
    // only when a fact matches; otherwise drop.
    if (facts.some((fact) => matchesFact(num, fact))) {
      return raw;
    }
    dropped.push(num);
    return "[unavailable]";
  });
  return { text: rewritten, dropped, ok: dropped.length === 0 };
}

/** Pull numeric facts from a readings-like payload. */
export function factsFromPoints(
  points: ReadonlyArray<{
    point_id: string;
    name?: string;
    value: number | null;
    status?: string;
    unit?: string;
  }>,
): GroundingFact[] {
  const out: GroundingFact[] = [];
  for (const point of points) {
    if (point.status && point.status !== "live") continue;
    if (typeof point.value !== "number" || !Number.isFinite(point.value)) continue;
    out.push({
      key: point.point_id,
      label: point.name ?? point.point_id,
      value: point.value,
      unit: point.unit,
    });
  }
  return out;
}

/** Collect every finite number in a JSON-like value as grounding facts. */
export function factsFromJson(value: unknown, prefix = "ctx"): GroundingFact[] {
  const out: GroundingFact[] = [];
  const walk = (node: unknown, path: string) => {
    if (typeof node === "number" && Number.isFinite(node)) {
      out.push({ key: path, label: path, value: node });
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    if (typeof node === "object" && node !== null) {
      for (const [key, child] of Object.entries(node)) {
        walk(child, `${path}.${key}`);
      }
    }
  };
  walk(value, prefix);
  return out;
}
