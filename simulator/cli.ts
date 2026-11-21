/**
 * Starts the bench publisher from `npm run simulate`.
 *
 * Same flags as the old `python -m simulator`: --host, --port, --interval,
 * --node, --once. Ctrl+C is a clean exit.
 */

import { parseArgs } from "node:util";

import { DEFAULT_INTERVAL_SECONDS, run } from "./bench-publisher";

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      host: { type: "string", default: "127.0.0.1" },
      port: { type: "string", default: "1883" },
      interval: { type: "string", default: String(DEFAULT_INTERVAL_SECONDS) },
      node: { type: "string", default: "bench" },
      once: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  try {
    await run({
      host: values.host ?? "127.0.0.1",
      port: Number.parseInt(values.port ?? "1883", 10),
      interval: Number.parseFloat(values.interval ?? String(DEFAULT_INTERVAL_SECONDS)),
      nodeId: values.node ?? "bench",
      once: Boolean(values.once),
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).name === "AbortError") {
      return;
    }
    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
