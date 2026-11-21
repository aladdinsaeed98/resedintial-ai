/**
 * GET /openapi.json — people-facing paths are GET/HEAD only.
 *
 * POST /api/ingest is the collector storage path (secret, readings only).
 * It is not a command channel.
 */

import { NextResponse } from "next/server";

import { openApiDocument } from "@/hub/http";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(openApiDocument());
}
