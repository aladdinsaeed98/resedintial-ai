/**
 * Local collector entry (MQTT subscriber + HTTPS forward).
 *
 * This used to wrap Next.js as well. Vercel cannot keep an MQTT socket, so
 * Next.js now runs as a normal App Router app (`npm run dev` / Vercel) and
 * this file is the long-lived process that stays on the home LAN.
 *
 * It subscribes to hvac/+/reading, POSTs to /api/ingest, and GETs
 * /api/cron/rules every 60 s. It never publishes on MQTT and never opens
 * an inbound port.
 *
 *   npm run collector
 *   npm run hub
 */

import { main } from "./collector/cli";

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
