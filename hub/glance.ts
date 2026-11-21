/**
 * Home-screen status from the same snapshot Live uses.
 *
 * Hero copy is plain English: "Running normally" or "Needs attention".
 * Kind still encodes cooling / heating / fault for styling. We do not guess
 * Idle or Fan — those need thermostat calls (later phase). Stale still hides
 * the number in hub/live.ts; this file never puts it back.
 */

export type GlanceKind = "cooling" | "heating" | "live" | "stale" | "fault" | "missing";

export interface GlancePoint {
  point_id: string;
  status: string;
  value: number | null;
}

export interface Glance {
  kind: GlanceKind;
  label: string;
  deltaT: number | null;
}

const COOLING_DELTA = 2;
const HEATING_DELTA = -2;

function point(points: GlancePoint[], id: string): GlancePoint | undefined {
  return points.find((item) => item.point_id === id);
}

function statusLabel(kind: GlanceKind): string {
  if (kind === "cooling" || kind === "heating" || kind === "live") {
    return "Running normally";
  }
  return "Needs attention";
}

/** Plain-language Home hero. Equipment-off modes wait for call sensors. */
export function glanceFromPoints(points: GlancePoint[]): Glance {
  if (points.length === 0) {
    return { kind: "missing", label: statusLabel("missing"), deltaT: null };
  }
  if (points.some((item) => item.status === "bad")) {
    return { kind: "fault", label: statusLabel("fault"), deltaT: null };
  }

  const ret = point(points, "return_air_temp");
  const sup = point(points, "supply_air_temp");
  const bothLive =
    ret?.status === "live" &&
    sup?.status === "live" &&
    typeof ret.value === "number" &&
    typeof sup.value === "number";
  const deltaT = bothLive ? ret.value! - sup.value! : null;

  const anyLive = points.some((item) => item.status === "live");
  if (!anyLive) {
    if (points.some((item) => item.status === "stale")) {
      return { kind: "stale", label: statusLabel("stale"), deltaT };
    }
    return { kind: "missing", label: statusLabel("missing"), deltaT };
  }

  if (deltaT != null && deltaT >= COOLING_DELTA) {
    return { kind: "cooling", label: statusLabel("cooling"), deltaT };
  }
  if (deltaT != null && deltaT <= HEATING_DELTA) {
    return { kind: "heating", label: statusLabel("heating"), deltaT };
  }
  return { kind: "live", label: statusLabel("live"), deltaT };
}
