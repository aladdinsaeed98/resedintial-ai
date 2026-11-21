/**
 * Home glance from GET /api/readings. Monitor-only.
 *
 * Hero: plain status ("Running normally" / "Needs attention"), animated
 * airflow + delta-T, and active alert count. Sensor cards match Live.
 */

"use client";

import Link from "next/link";

import { glanceFromPoints } from "@/hub/glance";
import { AirflowVisual } from "./AirflowVisual";
import { ReadingTiles } from "./ReadingTiles";
import { Skeleton } from "./Skeleton";
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
  const heroLabel =
    activeCount > 0 && (glance.kind === "cooling" || glance.kind === "heating" || glance.kind === "live")
      ? "Needs attention"
      : glance.label;

  return (
    <section className="page fade-in">
      <header className="page-header">
        <p className="micro-label">Overview</p>
        <h1>Home</h1>
        <p className="sub">
          {snapshot
            ? snapshot.system_name + " · stale after " + staleLabel(snapshot.stale_after_seconds)
            : "Waiting for the hub…"}
        </p>
        {banner ? <p className="banner">{banner}</p> : null}
      </header>

      {!snapshot ? (
        <Skeleton rows={5} />
      ) : (
        <>
          <article className="hero glass" data-kind={glance.kind}>
            <p className="hero-kicker">System status</p>
            <p className="hero-label">{heroLabel}</p>
            <AirflowVisual deltaT={glance.deltaT} kind={glance.kind} />
            {activeCount > 0 ? (
              <p className="alert-home">
                <Link href="/alerts">
                  {activeCount} active {activeCount === 1 ? "alert" : "alerts"}
                </Link>
              </p>
            ) : null}
          </article>
          <ReadingTiles
            points={snapshot.points}
            effectiveStatus={effectiveStatus}
            hubAge={hubAge}
          />
        </>
      )}
    </section>
  );
}
