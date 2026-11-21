/**
 * Live page logic. Polls GET /api/readings and draws one tile per point.
 *
 * Data flow: hub snapshot -> this file -> tiles on the page.
 * A number is shown only when status === "live" and value is a number. Stale
 * tiles say "Stale" and go grey via CSS. This page cannot command equipment.
 */

"use client";

import { ReadingTiles } from "./ReadingTiles";
import { Skeleton } from "./Skeleton";
import { staleLabel, useReadings } from "./useReadings";

export function LivePage() {
  const { snapshot, banner, hubAge, effectiveStatus } = useReadings();
  const subtitle = snapshot
    ? snapshot.system_name +
      " · " +
      snapshot.server_time +
      " · stale after " +
      staleLabel(snapshot.stale_after_seconds)
    : "Waiting for the hub…";

  return (
    <section className="page fade-in">
      <header className="page-header">
        <p className="micro-label">Sensors</p>
        <h1>Live</h1>
        <p className="sub" id="subtitle">
          {subtitle}
        </p>
        {banner ? (
          <p className="banner" id="banner">
            {banner}
          </p>
        ) : null}
      </header>
      {!snapshot ? (
        <Skeleton rows={5} />
      ) : (
        <ReadingTiles
          points={snapshot.points}
          effectiveStatus={effectiveStatus}
          hubAge={hubAge}
        />
      )}
      <noscript>This page needs JavaScript to refresh readings.</noscript>
    </section>
  );
}
