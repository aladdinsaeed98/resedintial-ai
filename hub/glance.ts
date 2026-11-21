/**
 * Home-screen status from the same snapshot Live uses.
 *
 * We do not guess fan or off — those need thermostat calls (later phase).
 * Cooling vs heating is only a display of live return vs supply delta-T.
 * Stale still hides the number in hub/live.ts; this file never puts it back.
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

/** One word for the Home hero. Equipment-off modes wait for call sensors. */
export function glanceFromPoints(points: GlancePoint[]): Glance {
  if (points.length === 0) {
    return { kind: "missing", label: "No reading", deltaT: null };
  }
  if (points.some((item) => item.status === "bad")) {
    return { kind: "fault", label: "Fault", deltaT: null };
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
      return { kind: "stale", label: "Stale", deltaT };
    }
    return { kind: "missing", label: "No reading", deltaT };
  }

  if (deltaT != null && deltaT >= COOLING_DELTA) {
    return { kind: "cooling", label: "Cooling", deltaT };
  }
  if (deltaT != null && deltaT <= HEATING_DELTA) {
    return { kind: "heating", label: "Heating", deltaT };
  }
  return { kind: "live", label: "Live", deltaT };
}
