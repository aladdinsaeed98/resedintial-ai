/**
 * GET /openapi.json — documents that every path is GET/HEAD only.
 *
 * The Python FastAPI hub exposed this automatically. We keep a small static
 * spec so tests (and a human) can still see there is no write operation.
 */

import { NextResponse } from "next/server";

import { openApiDocument } from "@/hub/http";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(openApiDocument());
}
