/**
 * One glass tile per configured point, grouped from points.json units.
 *
 * A value is shown only when status === "live" and value is a number. Stale
 * tiles say "Stale" and go grey via CSS. Missing points stay on screen as
 * "No data yet". This cannot command equipment.
 */

import { formatReading } from "@/hub/format-reading";
import { groupPoints } from "@/hub/tile-groups";
import type { LivePointJson } from "./useReadings";

const STATUS_TEXT = {
  missing: "No data yet",
  stale: "Stale",
  bad: "Bad reading",
  unknown: "Unknown quality",
};

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

function lastUpdated(status: string, age: number | null, nodeId: string): string {
  if (status === "missing" || age == null) return nodeId;
  if (status === "live") return nodeId + " · " + Math.floor(age) + "s ago";
  return nodeId + " · last heard " + Math.floor(age) + "s ago";
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
    ...point,
    status: effectiveStatus(point),
  }));
  const groups = groupPoints(classified);

  return (
    <div id="points">
      {groups.map((group) => (
        <section key={group.id} className="tile-group" data-group={group.id}>
          <h2 className="tile-group-title">{group.label}</h2>
          <div className="grid">
            {group.points.map((point) => {
              const status = point.status;
              const age = hubAge(point);
              const valueText =
                status === "live" && typeof point.value === "number"
                  ? formatReading(point.value, point.unit)
                  : STATUS_TEXT[status as keyof typeof STATUS_TEXT] || "No data yet";
              return (
                <article
                  key={point.point_id}
                  className="tile glass"
                  data-point={point.point_id}
                  data-status={status}
                  data-tone={toneFor(point, status, classified)}
                >
                  <div className="name">{point.name}</div>
                  <div className="value">{valueText}</div>
                  <div className="meta">{lastUpdated(status, age, point.node_id)}</div>
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

export { formatReading };
