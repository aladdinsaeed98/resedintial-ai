/**
 * GET /api/health — process is up. mqtt_connected is a hint, not a command.
 * Public so Vercel can ping it without a Clerk session.
 */

import { NextResponse } from "next/server";

import { SystemClock } from "@/hub/clock";
import { collectorIsFresh } from "@/hub/ingest";
import { PrismaReadingStore } from "@/hub/prisma-store";
import { getRuntime } from "@/hub/runtime-slot";
import { databaseConfigured, getPrisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  const injected = getRuntime();
  if (injected) {
    return NextResponse.json({ ok: true, mqtt_connected: injected.gateway.connected });
  }
  if (!databaseConfigured()) {
    return NextResponse.json({ ok: true, mqtt_connected: false });
  }
  const store = new PrismaReadingStore(getPrisma());
  const status = await store.collectorStatus();
  const mqttConnected = Boolean(
    status && status.mqttConnected && collectorIsFresh(status.lastIngestAt, new SystemClock().now()),
  );
  return NextResponse.json({ ok: true, mqtt_connected: mqttConnected });
}
