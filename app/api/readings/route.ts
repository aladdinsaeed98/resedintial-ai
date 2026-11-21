/**
 * GET /api/readings — the only data the live page needs.
 *
 * Cache-Control: no-store so a phone never paints an old JSON blob as current.
 * Clerk session required when keys are configured. POST is not exported.
 * Value is already stripped for stale / bad / unknown in hub/live.ts.
 */

import { NextResponse } from "next/server";

import { SystemClock } from "@/hub/clock";
import { loadSettings } from "@/hub/config";
import { readingsPayload } from "@/hub/http";
import { collectorIsFresh } from "@/hub/ingest";
import { publicSnapshotFromMap } from "@/hub/live";
import { PrismaReadingStore } from "@/hub/prisma-store";
import { getRuntime } from "@/hub/runtime-slot";
import { dashboardUserId } from "@/hub/session";
import { databaseConfigured, getPrisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  const userId = await dashboardUserId();
  if (userId === null) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const injected = getRuntime();
  if (injected) {
    const body = readingsPayload(
      injected.settings,
      injected.store,
      injected.clock,
      injected.gateway,
    );
    return NextResponse.json(body, {
      headers: { "Cache-Control": "no-store" },
    });
  }

  const settings = loadSettings();
  const clock = new SystemClock();
  if (!databaseConfigured()) {
    const empty = publicSnapshotFromMap(settings, {}, clock.now());
    return NextResponse.json(
      { ...empty, mqtt_connected: false },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const store = new PrismaReadingStore(getPrisma());
  const latest = await store.latestMap();
  const status = await store.collectorStatus();
  const now = clock.now();
  const mqttConnected = Boolean(
    status && status.mqttConnected && collectorIsFresh(status.lastIngestAt, now),
  );
  const body = {
    ...publicSnapshotFromMap(settings, latest, now),
    mqtt_connected: mqttConnected,
  };
  return NextResponse.json(body, {
    headers: { "Cache-Control": "no-store" },
  });
}
