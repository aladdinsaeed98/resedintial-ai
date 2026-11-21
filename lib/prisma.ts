/**
 * Prisma client for the Vercel app.
 *
 * Created lazily so `next build` with empty placeholder env does not open
 * a database. App Router routes call getPrisma() on a request, never at
 * module load. The collector never imports this file.
 */

import { PrismaClient } from "@prisma/client";

const GLOBAL_KEY = "__hvacPrisma";

type GlobalPrisma = typeof globalThis & {
  [GLOBAL_KEY]?: PrismaClient;
};

/** True when a Postgres URL is actually configured (not a placeholder). */
export function databaseConfigured(): boolean {
  const url = process.env.DATABASE_URL?.trim() ?? "";
  if (!url) {
    return false;
  }
  if (url.includes("placeholder")) {
    return false;
  }
  return url.startsWith("postgres");
}

/** One PrismaClient per process. Throws if DATABASE_URL is missing. */
export function getPrisma(): PrismaClient {
  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error("DATABASE_URL is not set");
  }
  const g = globalThis as GlobalPrisma;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new PrismaClient();
  }
  return g[GLOBAL_KEY];
}
