/**
 * Next.js config for the HVAC hub.
 *
 * better-sqlite3 and mqtt are native / Node-only. They must stay outside the
 * webpack bundle so the live page (a client component) never loads them.
 * The custom server in server.ts is what actually starts MQTT.
 */

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "mqtt"],
};

export default nextConfig;
