/**
 * GET /api/health — process is up. mqtt_connected is a hint, not a command.
 */

import { NextResponse } from "next/server";

import { getRuntime } from "@/hub/runtime";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const { gateway } = getRuntime();
  return NextResponse.json({ ok: true, mqtt_connected: gateway.connected });
}
