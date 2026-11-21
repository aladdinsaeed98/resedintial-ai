/**
 * Home glance from GET /api/readings. Monitor-only.
 *
 * Shows one status word (Cooling / Heating / Live / Stale / Fault), delta-T
 * when both temps are live, an active-alert count only when it is not zero,
 * and the same tiles as Live. No unused mode names.
 */

"use client";

import Link from "next/link";

import { glanceFromPoints } from "@/hub/glance";
import { ReadingTiles } from "./ReadingTiles";
import { useAlerts } from "./useAlerts";
import { staleLabel, useReadings } from "./useReadings";

export function HomeView() {
  const { snapshot, banner, hubAge, effectiveStatus } = useReadings();
  const alerts = useAlerts();
  const activeCount = alerts?.active_count ?? 0;
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
      {activeCount > 0 ? (
        <p className="alert-home">
          <Link href="/alerts">
            {activeCount} active {activeCount === 1 ? "alert" : "alerts"}
          </Link>
        </p>
      ) : null}
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
