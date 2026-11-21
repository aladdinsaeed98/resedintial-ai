/**
 * POST /api/ingest — collector storage only.
 *
 * Authenticated with INGEST_SECRET, not Clerk. Accepts a batch of readings,
 * stamps received_at with the Vercel clock, and returns { accepted }.
 * GET is not implemented. The response never includes a command.
 */

import { NextResponse } from "next/server";

import { ingestSecretFromHeaders, verifyIngestSecret } from "@/hub/auth";
import { SystemClock } from "@/hub/clock";
import { ingestResponse, parseIngestBody } from "@/hub/ingest";
import { getIngestSink } from "@/hub/ingest-runtime";
import { runRulesNow } from "@/hub/rules-runner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  const secretCheck = verifyIngestSecret(
    ingestSecretFromHeaders(request.headers),
    process.env.INGEST_SECRET,
  );
  if (!secretCheck.ok) {
    return NextResponse.json({ error: secretCheck.error }, { status: secretCheck.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "payload is not json" }, { status: 400 });
  }

  const clock = new SystemClock();
  const receivedAt = clock.now();
  const parsed = parseIngestBody(body, receivedAt);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const store = getIngestSink();
  if (!store) {
    return NextResponse.json({ error: "database is not configured" }, { status: 503 });
  }

  const accepted = await store.addMany(parsed.readings);
  await store.recordCollector(parsed.mqtt_connected, receivedAt);
  try {
    await runRulesNow(receivedAt);
  } catch (error) {
    console.error("rules evaluation failed", error);
  }
  return NextResponse.json(ingestResponse(accepted));
}
