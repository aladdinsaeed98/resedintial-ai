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

import { ReadingTiles } from "./ReadingTiles";
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
    <section>
      <h1>Live</h1>
      <p className="sub" id="subtitle">
        {subtitle}
      </p>
      <p className="banner" id="banner">
        {banner}
      </p>
      {snapshot && Array.isArray(snapshot.points) ? (
        <ReadingTiles
          points={snapshot.points}
          effectiveStatus={effectiveStatus}
          hubAge={hubAge}
        />
      ) : null}
      <noscript>This page needs JavaScript to refresh readings.</noscript>
    </section>
  );
}
