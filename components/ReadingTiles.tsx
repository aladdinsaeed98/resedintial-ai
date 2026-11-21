/**
 * One glass tile per point. Shared by Live (and Home's compact strip).
 *
 * A number is shown only when status === "live" and value is a number. Stale
 * tiles say "Stale" and go grey via CSS. This cannot command equipment.
 */

import type { LivePointJson } from "./useReadings";

const STATUS_TEXT = {
  missing: "No reading",
  stale: "Stale",
  bad: "Bad reading",
  unknown: "Unknown quality",
};

/** One decimal place, with a degree sign for F/C. Hub already hid non-live values. */
export function formatReading(value: number, unit: string): string {
  if (unit === "bool") return value >= 0.5 ? "On" : "Off";
  if (unit === "code") return String(Math.round(value));
  const shown = (Math.round(value * 10) / 10).toFixed(1);
  if (unit === "F" || unit === "C") return shown + " \u00b0" + unit;
  return shown + " " + unit;
}

function toneFor(point: LivePointJson, status: string, points: LivePointJson[]): string {
  if (status === "bad") return "fault";
  if (status === "stale" || status === "missing" || status === "unknown") return "stale";
  const ret = points.find((item) => item.point_id === "return_air_temp");
  const sup = points.find((item) => item.point_id === "supply_air_temp");
  if (
    (point.point_id === "return_air_temp" || point.point_id === "supply_air_temp") &&
    ret?.status === "live" &&
    sup?.status === "live" &&
    typeof ret.value === "number" &&
    typeof sup.value === "number"
  ) {
    const delta = ret.value - sup.value;
    if (delta >= 2) return "cooling";
    if (delta <= -2) return "heating";
  }
  return "live";
}

export function ReadingTiles({
  points,
  effectiveStatus,
  hubAge,
}: {
  points: LivePointJson[];
  effectiveStatus: (point: LivePointJson) => string;
  hubAge: (point: LivePointJson) => number | null;
}) {
  const classified = points.map((point) => ({
    point,
    status: effectiveStatus(point),
  }));

  return (
    <div className="grid" id="points">
      {classified.map(({ point, status }) => {
        const age = hubAge(point);
        let valueText: string;
        let metaText: string;
        if (status === "live" && typeof point.value === "number") {
          valueText = formatReading(point.value, point.unit);
          metaText = point.node_id + " · " + Math.floor(age ?? 0) + "s ago";
        } else {
          valueText = STATUS_TEXT[status as keyof typeof STATUS_TEXT] || "No reading";
          metaText =
            age == null
              ? point.node_id
              : point.node_id + " · last heard " + Math.floor(age) + "s ago";
        }
        return (
          <article
            key={point.point_id}
            className="tile glass"
            data-point={point.point_id}
            data-status={status}
            data-tone={toneFor(point, status, classified.map((row) => ({ ...row.point, status: row.status })))}
          >
            <div className="name">{point.name}</div>
            <div className="value">{valueText}</div>
            <div className="meta">{metaText}</div>
          </article>
        );
      })}
    </div>
  );
}
