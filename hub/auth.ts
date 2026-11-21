/**
 * Auth helpers. Clerk protects people. The ingest secret protects the collector.
 *
 * Pages and GET /api/readings require a Clerk session when keys are real.
 * POST /api/ingest never uses Clerk — it uses INGEST_SECRET so the Windows
 * collector can push readings without a user login. The ingest path still
 * cannot command equipment: it only stores samples.
 */

import { timingSafeEqual } from "node:crypto";

export { clerkKeysConfigured } from "./clerk-keys";

/**
 * Compare the collector's bearer token to INGEST_SECRET.
 * An empty configured secret is a misconfig: reject everyone.
 */
export function verifyIngestSecret(
  provided: string | null | undefined,
  expected: string | undefined,
): { ok: true } | { ok: false; status: number; error: string } {
  const want = expected?.trim() ?? "";
  if (!want) {
    return { ok: false, status: 503, error: "ingest is not configured" };
  }
  const got = (provided ?? "").trim();
  const bearer = got.toLowerCase().startsWith("bearer ") ? got.slice(7).trim() : got;
  if (!bearer) {
    return { ok: false, status: 401, error: "missing ingest secret" };
  }
  const left = Buffer.from(bearer);
  const right = Buffer.from(want);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return { ok: false, status: 401, error: "invalid ingest secret" };
  }
  return { ok: true };
}

/** Pull the secret from Authorization: Bearer or x-ingest-secret. */
export function ingestSecretFromHeaders(headers: {
  get(name: string): string | null;
}): string | null {
  return headers.get("authorization") ?? headers.get("x-ingest-secret");
}
