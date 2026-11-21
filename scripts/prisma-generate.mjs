/**
 * Run `prisma generate` even when DATABASE_URL is unset.
 *
 * `next build` and `npm install` must work from placeholder env (empty
 * .env.production, no .env.local yet). Generate only needs a dummy URL;
 * it does not connect. Real keys stay in .env.local / Vercel.
 */

import { spawnSync } from "node:child_process";

if (!process.env.DATABASE_URL?.trim()) {
  process.env.DATABASE_URL =
    "postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder";
}
if (!process.env.DIRECT_URL?.trim()) {
  process.env.DIRECT_URL = process.env.DATABASE_URL;
}

const result = spawnSync("npx", ["prisma", "generate"], {
  stdio: "inherit",
  env: process.env,
  shell: true,
});

process.exit(result.status ?? 1);
