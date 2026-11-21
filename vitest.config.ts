/**
 * Vitest config. Tests import hub modules directly (no live Mosquitto).
 * Native better-sqlite3 stays in Node; the live page never imports it.
 */

import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 15_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
});
