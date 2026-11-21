/**
 * Home glance from GET /api/readings. Monitor-only.
 *
 * Shows one status word (Cooling / Heating / Live / Stale / Fault), delta-T
 * when both temps are live, and the same tiles as Live. No unused mode names.
 */

"use client";

import { glanceFromPoints } from "@/hub/glance";
import { ReadingTiles } from "./ReadingTiles";
import { staleLabel, useReadings } from "./useReadings";

export function HomeView() {
  const { snapshot, banner, hubAge, effectiveStatus } = useReadings();
  const points = snapshot?.points ?? [];
  const classified = points.map((point) => ({
    point_id: point.point_id,
    status: effectiveStatus(point),
    value: point.value,
  }));
  const glance = glanceFromPoints(classified);

  return (
    <section>
      <h1>Home</h1>
      <p className="sub">
        {snapshot
          ? snapshot.system_name + " · stale after " + staleLabel(snapshot.stale_after_seconds)
          : "Waiting for the hub…"}
      </p>
      <p className="banner">{banner}</p>
      <article className="hero glass" data-kind={glance.kind}>
        <p className="hero-kicker">System</p>
        <p className="hero-label">{glance.label}</p>
        {glance.deltaT != null ? (
          <p className="hero-delta">Delta-T {glance.deltaT.toFixed(1)} °F</p>
        ) : (
          <p className="hero-delta">Delta-T needs two live temps</p>
        )}
      </article>
      {snapshot && Array.isArray(snapshot.points) ? (
        <ReadingTiles
          points={snapshot.points}
          effectiveStatus={effectiveStatus}
          hubAge={hubAge}
        />
      ) : null}
    </section>
  );
}
