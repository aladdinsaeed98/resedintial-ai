/**
 * Live page logic. Polls GET /api/readings and draws one tile per point.
 *
 * Data flow: hub snapshot -> this file -> tiles on the page.
 * A number is shown only when status === "live" and value is a number. Stale
 * tiles say "Stale" and go grey via CSS. This page cannot command equipment.
 *
 * If tiles freeze, the collector or Mosquitto is down (see the banner).
 * If they never go stale after you stop the simulator, check
 * snapshot.stale_after_seconds (should be 120). Age uses received_at
 * from the cloud database, not the node's own clock.
 */

"use client";

import { useEffect, useRef, useState } from "react";

const POLL_MS = 1000;
const TICK_MS = 250;

const STATUS_TEXT = {
  missing: "No reading",
  stale: "Stale",
  bad: "Bad reading",
  unknown: "Unknown quality",
};

interface LivePointJson {
  point_id: string;
  name: string;
  node_id: string;
  unit: string;
  status: string;
  quality: string | null;
  value: number | null;
  age_seconds: number | null;
}

interface Snapshot {
  system_name: string;
  server_time: string;
  stale_after_seconds: number;
  mqtt_connected: boolean;
  points: LivePointJson[];
}

/** Turn 120 into "2 min" so the subtitle is readable. Other values stay in seconds. */
function staleLabel(seconds: number): string {
  if (seconds % 60 === 0) return String(seconds / 60) + " min";
  return String(seconds) + " s";
}

/** One decimal place, with a degree sign for F/C. Hub already hid non-live values. */
function formatReading(value: number, unit: string): string {
  const shown = (Math.round(value * 10) / 10).toFixed(1);
  if (unit === "F" || unit === "C") return shown + " \u00b0" + unit;
  return shown + " " + unit;
}

export function LivePage() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [banner, setBanner] = useState("");
  const [subtitle, setSubtitle] = useState("Waiting for the hub…");
  const [, setTick] = useState(0);
  const syncedAt = useRef(0);
  const snapshotRef = useRef<Snapshot | null>(null);

  /**
   * Age in seconds as of right now, not as of the last poll.
   * Hub age + time since we fetched, so the "12s ago" label keeps moving between polls.
   */
  function hubAge(point: LivePointJson): number | null {
    if (typeof point.age_seconds !== "number") return null;
    return point.age_seconds + (performance.now() - syncedAt.current) / 1000;
  }

  /**
   * Status the tile should show. If the last snapshot is older than the cutoff,
   * treat it as stale here so we do not wait for the next poll to grey the tile.
   */
  function effectiveStatus(point: LivePointJson): string {
    if (point.status === "missing") return "missing";
    const age = hubAge(point);
    const current = snapshotRef.current;
    if (current && age != null && age >= current.stale_after_seconds) return "stale";
    return point.status;
  }

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const response = await fetch("/api/readings", { cache: "no-store" });
        if (!response.ok) throw new Error("hub status " + response.status);
        const body = (await response.json()) as Snapshot;
        if (cancelled) return;
        snapshotRef.current = body;
        syncedAt.current = performance.now();
        setSnapshot(body);
        setBanner(body.mqtt_connected ? "" : "MQTT broker not connected.");
        setSubtitle(
          body.system_name +
            " · " +
            body.server_time +
            " · stale after " +
            staleLabel(body.stale_after_seconds),
        );
      } catch {
        if (cancelled) return;
        setBanner("Can't reach the hub.");
      }
    }

    void poll();
    const pollId = setInterval(() => {
      void poll();
    }, POLL_MS);
    const tickId = setInterval(() => {
      setTick((n) => n + 1);
    }, TICK_MS);

    return () => {
      cancelled = true;
      clearInterval(pollId);
      clearInterval(tickId);
    };
  }, []);

  return (
    <>
      <main>
        <h1>HVAC monitor</h1>
        <p className="sub" id="subtitle">
          {subtitle}
        </p>
        <p className="banner" id="banner">
          {banner}
        </p>
        <div className="grid" id="points">
          {snapshot &&
            Array.isArray(snapshot.points) &&
            snapshot.points.map((point) => {
              const status = effectiveStatus(point);
              const age = hubAge(point);
              let valueText: string;
              let metaText: string;
              // Show a number only for a live, numeric sample. Anything else is a status label.
              if (status === "live" && typeof point.value === "number") {
                valueText = formatReading(point.value, point.unit);
                metaText = point.node_id + " · " + Math.floor(age ?? 0) + "s ago";
              } else {
                valueText =
                  STATUS_TEXT[status as keyof typeof STATUS_TEXT] || "No reading";
                metaText =
                  age == null
                    ? point.node_id
                    : point.node_id + " · last heard " + Math.floor(age) + "s ago";
              }
              return (
                <article
                  key={point.point_id}
                  className="tile"
                  data-point={point.point_id}
                  data-status={status}
                >
                  <div className="name">{point.name}</div>
                  <div className="value">{valueText}</div>
                  <div className="meta">{metaText}</div>
                </article>
              );
            })}
        </div>
        <footer>Read only. This page cannot start, stop, or change the equipment.</footer>
      </main>
      <noscript>This page needs JavaScript to refresh readings.</noscript>
    </>
  );
}
