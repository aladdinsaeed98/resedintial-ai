/**
 * Auth helpers. Clerk protects people. Shared secrets protect ingest and cron.
 *
 * Pages, GET /api/readings, and GET /api/alerts require a Clerk session when
 * keys are real. POST /api/ingest uses INGEST_SECRET. GET /api/cron/rules uses
 * CRON_SECRET (Vercel Cron sends Authorization: Bearer CRON_SECRET). Neither
 * secret path can command equipment.
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

/**
 * Compare the Vercel Cron bearer token to CRON_SECRET.
 * An empty configured secret is a misconfig: reject everyone.
 */
export function verifyCronSecret(
  provided: string | null | undefined,
  expected: string | undefined,
): { ok: true } | { ok: false; status: number; error: string } {
  const want = expected?.trim() ?? "";
  if (!want) {
    return { ok: false, status: 503, error: "cron is not configured" };
  }
  const got = (provided ?? "").trim();
  const bearer = got.toLowerCase().startsWith("bearer ") ? got.slice(7).trim() : got;
  if (!bearer) {
    return { ok: false, status: 401, error: "missing cron secret" };
  }
  const left = Buffer.from(bearer);
  const right = Buffer.from(want);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return { ok: false, status: 401, error: "invalid cron secret" };
  }
  return { ok: true };
}

/** Pull CRON_SECRET from Authorization: Bearer or x-cron-secret. */
export function cronSecretFromHeaders(headers: {
  get(name: string): string | null;
}): string | null {
  return headers.get("authorization") ?? headers.get("x-cron-secret");
}
