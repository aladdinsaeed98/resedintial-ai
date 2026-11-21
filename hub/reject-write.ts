/**
 * Explicit 405 for people-facing write attempts.
 * POST /api/readings and POST /api/alerts must not store a command.
 */

import { NextResponse } from "next/server";

export function methodNotAllowed(allow = "GET, HEAD"): NextResponse {
  return new NextResponse(null, { status: 405, headers: { Allow: allow } });
}
