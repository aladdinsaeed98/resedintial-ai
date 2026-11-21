/**
 * GET /api/cron/rules — Vercel Cron tick for time-based rules.
 *
 * stale_sensor and node_offline need a clock even when no ingest arrives.
 * Protected by CRON_SECRET (Vercel sends Authorization: Bearer CRON_SECRET).
 * Does not talk to MQTT and never returns a command.
 */

import { NextResponse } from "next/server";

import { cronSecretFromHeaders, verifyCronSecret } from "@/hub/auth";
import { SystemClock } from "@/hub/clock";
import { methodNotAllowed } from "@/hub/reject-write";
import { runRulesNow } from "@/hub/rules-runner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  const secretCheck = verifyCronSecret(
    cronSecretFromHeaders(request.headers),
    process.env.CRON_SECRET,
  );
  if (!secretCheck.ok) {
    return NextResponse.json({ error: secretCheck.error }, { status: secretCheck.status });
  }

  const now = new SystemClock().now();
  try {
    const result = await runRulesNow(now);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("cron rules evaluation failed", error);
    return NextResponse.json({ ok: false, error: "rules evaluation failed" }, { status: 500 });
  }
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
