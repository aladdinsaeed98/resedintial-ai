/**
 * GET /api/history — recent samples / events for the History screen.
 *
 * Demo mode returns synthetic rows. Without demo or a database, the list is
 * empty so the UI can show a helpful empty state. Monitor-only; writes 405.
 */

import { NextResponse } from "next/server";

import { demoHistoryPayload, isDemoMode } from "@/hub/demo";
import { methodNotAllowed } from "@/hub/reject-write";
import { dashboardUserId } from "@/hub/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  const userId = await dashboardUserId();
  if (userId === null) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (isDemoMode()) {
    return NextResponse.json(demoHistoryPayload(), {
      headers: { "Cache-Control": "no-store" },
    });
  }

  return NextResponse.json(
    { rows: [], demo: false },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(): Promise<NextResponse> {
  return methodNotAllowed();
}

export async function PUT(): Promise<NextResponse> {
  return methodNotAllowed();
}

export async function PATCH(): Promise<NextResponse> {
  return methodNotAllowed();
}

export async function DELETE(): Promise<NextResponse> {
  return methodNotAllowed();
}
