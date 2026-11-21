/**
 * GET /api/readings — the only data the live page needs.
 *
 * Cache-Control: no-store so a phone never paints an old JSON blob as current.
 * POST is not exported; the custom server also returns 405 for write methods.
 * Value is already stripped for stale / bad / unknown in hub/live.ts.
 */

import { NextResponse } from "next/server";

import { readingsPayload } from "@/hub/http";
import { getRuntime } from "@/hub/runtime";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const { settings, store, clock, gateway } = getRuntime();
  const body = readingsPayload(settings, store, clock, gateway);
  return NextResponse.json(body, {
    headers: { "Cache-Control": "no-store" },
  });
}
