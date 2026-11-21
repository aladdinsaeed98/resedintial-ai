/**
 * Next.js config for the Vercel app.
 *
 * better-sqlite3 and mqtt stay on the Windows/Pi collector, not in the
 * serverless bundle. App Router routes talk to Prisma + Postgres.
 */

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "mqtt", "@prisma/client"],
};

export default nextConfig;
