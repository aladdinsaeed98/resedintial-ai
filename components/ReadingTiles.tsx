/**
 * Sensor cards: plain-language label, technical subtitle, value, status,
 * sparkline when history exists, and a tooltip. Shared by Home and Live.
 *
 * A value is shown only when status === "live" and value is a number. Stale
 * tiles say "Stale" and go grey via CSS. Missing points stay on screen as
 * "No data yet". This cannot command equipment.
 */

import { formatReading } from "@/hub/format-reading";
import { groupPoints } from "@/hub/tile-groups";
import { Sparkline } from "./Sparkline";
import { Skeleton } from "./Skeleton";
import type { LivePointJson } from "./useReadings";

const STATUS_TEXT = {
  missing: "No data yet",
  stale: "Stale",
  bad: "Bad reading",
  unknown: "Unknown quality",
};

const STATUS_BADGE: Record<string, string> = {
  live: "ok",
  stale: "warning",
  bad: "critical",
  missing: "warning",
  unknown: "warning",
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

function splitValue(text: string, unit: string): { num: string; unit: string } {
  if (unit === "bool" || unit === "code") return { num: text, unit: "" };
  const match = text.match(/^([\d.]+)\s*(.*)$/);
  if (!match) return { num: text, unit: "" };
  return { num: match[1], unit: match[2] };
}

export function ReadingTiles({
  points,
  effectiveStatus,
  hubAge,
  loading = false,
}: {
  points: LivePointJson[];
  effectiveStatus: (point: LivePointJson) => string;
  hubAge: (point: LivePointJson) => number | null;
  loading?: boolean;
}) {
  if (loading) {
    return <Skeleton rows={4} className="tile-skeleton" />;
  }

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
              const liveValue =
                status === "live" && typeof point.value === "number"
                  ? formatReading(point.value, point.unit)
                  : null;
              const valueText =
                liveValue ??
                (STATUS_TEXT[status as keyof typeof STATUS_TEXT] || "No data yet");
              const parts = liveValue
                ? splitValue(liveValue, point.unit)
                : { num: valueText, unit: "" };
              const plain = point.plain_label || point.name;
              const technical = point.plain_label ? point.name : point.point_id;
              const tip = point.description || technical;
              const badge = STATUS_BADGE[status] ?? "warning";
              return (
                <article
                  key={point.point_id}
                  className="tile glass"
                  data-point={point.point_id}
                  data-status={status}
                  data-tone={toneFor(point, status, classified)}
                  title={tip}
                >
                  <div className="tile-head">
                    <div>
                      <div className="name">{plain}</div>
                      <div className="tech-name">{technical}</div>
                    </div>
                    <span className={`status-badge ${badge}`}>{status}</span>
                  </div>
                  <div className="value">
                    <span className="num">{parts.num}</span>
                    {parts.unit ? <span className="unit"> {parts.unit}</span> : null}
                  </div>
                  <div className="tile-foot">
                    <div className="meta">{lastUpdated(status, age, point.node_id)}</div>
                    <Sparkline values={point.sparkline ?? []} status={status} />
                  </div>
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
