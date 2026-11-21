# Code guide — Residential HVAC Monitor (Phase 1)

Plain map of this repo for the owner (a residential HVAC tech learning to
code). Comments in the source follow the same idea: what a file is for, how
it fits the data flow, and what to check first when it breaks.

This app is **monitor-only**. Nothing in it can start, stop, or change a
furnace, thermostat, or condenser. See `docs/PLAN.md` and
`.cursor/rules/safety.md` for the hard rules.

JSON files cannot have comments, so `config/points.json` is described here
instead of inside the file.

## End-to-end data flow

```text
DS18B20 probes (or the simulator)
        |
        |  JSON {point, value, unit, timestamp, quality}
        |  every 10 seconds, retain off
        v
MQTT topic  hvac/<node>/reading     (Phase 1 node id is "bench")
        |
        |  Mosquitto on port 1883 (LAN only — never port-forward)
        v
collector/ + hub/gateway.ts   listens only; write() always throws
        |                     WriteNotSupported; never publishes
        v
collector/buffer.ts           SQLite retry queue on the Windows PC / Pi
        |
        |  outbound HTTPS POST /api/ingest
        |  Authorization: Bearer INGEST_SECRET
        v
app/api/ingest/route.ts       stamps received_at (Vercel clock), Prisma insert,
                              then hub/engine.ts (pure: state in, alerts out)
        |
        v
Postgres (Vercel Marketplace / Neon)  readings + alerts
        |
        v
hub/live.ts                   age from received_at; after 120 s the number
                              is stripped
        |
        v
app/api/readings/route.ts     GET /api/readings  (Clerk session, no-store)
app/api/alerts/route.ts       GET /api/alerts    (Clerk session, no-store)
        |
        v
components/LivePage.tsx       poll every 1 s; grey tile if not live
components/AlertsView.tsx     active + recent; red critical, amber warning

GET /api/cron/rules (CRON_SECRET) re-runs time-based rules when ingest is quiet.
```

Nothing flows back toward the equipment. Ingest returns `{ accepted }` only.

## Why a local collector plus Vercel

Vercel functions start per request and cannot keep an MQTT connection to the
house. Opening port 1883 on the router would put Mosquitto on the internet.

The collector is the old long-lived subscriber, now a small process that only
makes **outbound** HTTPS calls. If the home internet drops, rows sit in the
local SQLite buffer until ingest succeeds. A delayed retry is still "live"
because stale uses the server's `received_at`, not the node's timestamp.

`npm run dev` is Next.js on http://localhost:3000. `npm run collector` is the
MQTT process. `next start` on Vercel does not subscribe to Mosquitto.

## Hub (`hub/`)

TypeScript used by the Vercel app, the collector, and tests.

| File | What it does |
|---|---|
| `topics.ts` | Topic and id patterns. There is no command topic. |
| `clock.ts` | UTC timestamps. `ManualClock` lets tests jump 120 s without waiting. |
| `config.ts` | Settings from env vars plus `config/points.json`. Stale default is 120 s. |
| `engine.ts` | Pure rules: series in, currently-true alerts out. Skips missing points. |
| `rules.ts` | Loads `config/rules.json` and `config/led_codes.json`. |
| `alerts.ts` | 30-minute occurrence window + empty `notifyAlert` Phase C hook. |
| `rules-runner.ts` | Load history, evaluate, persist. Called from ingest and cron. |
| `models.ts` | Shared types. `BuildingGateway.write()` throws `WriteNotSupported` on purpose. |
| `parsing.ts` | Turns MQTT JSON into a `StoredReading`. Extra keys (even `"command"`) are ignored. |
| `store.ts` | SQLite log (`better-sqlite3`) for tests and as the `ReadingLookup` type. |
| `prisma-store.ts` | Postgres log the Vercel app actually uses. |
| `live.ts` | Decides live / stale / bad / missing. Hides the number unless status is live. |
| `gateway.ts` | MQTT listener (mqtt.js). Subscribes to `hvac/+/reading`. Does not publish. |
| `http.ts` | OpenAPI + GET payload helper. People-facing paths are GET/HEAD. |
| `auth.ts` | Ingest secret check (timing-safe). Clerk helpers live in `clerk-keys.ts`. |
| `clerk-keys.ts` | True only when Clerk keys look real (not placeholders). Safe for Edge middleware. |
| `ingest.ts` | Validates a collector POST. Response is `{ accepted }` only. |
| `ingest-runtime.ts` | Prisma sink, or a memory sink in tests. |
| `session.ts` | Clerk user for GET `/api/readings`. Tests mock this. |
| `runtime.ts` / `runtime-slot.ts` | Test-only SQLite + gateway injection. Production does not start MQTT. |

## Next.js app (`app/`, `components/`, `middleware.ts`)

Hosted on Vercel. Clerk protects every page and API route except sign-in,
sign-up, `/api/ingest`, `/api/health`, `/api/cron/rules`, and `/openapi.json`.

| File | What it does |
|---|---|
| `middleware.ts` | Clerk `auth.protect()` when keys are configured; no-op for `next build` placeholders. |
| `app/layout.tsx` | HTML shell, dark PWA metadata, Clerk dark appearance when keys are real. |
| `app/(app)/` | Signed-in screens behind `AppShell`: Home, Live, History, Codes, Alerts, Ask, Settings. |
| `app/(app)/page.tsx` | Home glance from `/api/readings`. |
| `app/(app)/live/page.tsx` | Live tiles from `/api/readings`. |
| `app/(app)/alerts` | Active and recent alerts from GET `/api/alerts`. |
| `app/(app)/history` `codes` `ask` `settings` | Styled placeholders: "Coming in a later phase". |
| `app/sign-in/` `app/sign-up/` | Public Clerk screens, same dark look. |
| `app/manifest.ts` | Add to Home Screen (standalone, theme-color `#05070c`). |
| `app/globals.css` | Dark glass. Cyan = cooling, orange = heating, red = fault, grey + Stale. |
| `app/api/ingest/route.ts` | POST only. Shared secret. Stores readings, evaluates rules. Never returns a command. |
| `app/api/readings/route.ts` | GET for the tiles. 401 without a Clerk session when keys are real. Writes 405. |
| `app/api/alerts/route.ts` | GET for the Alerts screen. Clerk when keys are real. Lazily evaluates rules (30 s). Writes 405. |
| `app/api/cron/rules/route.ts` | GET. `CRON_SECRET`. Re-evaluates stale_sensor / node_offline. |
| `app/api/health/route.ts` | GET. Public so Vercel can ping it. |
| `app/openapi.json/route.ts` | Documents GET-only people paths plus collector ingest. |
| `components/AppShell.tsx` | Brand, Clerk `UserButton`, seven-link nav, Read only footer. |
| `components/LivePage.tsx` | Polls `/api/readings` every 1 s. One grouped tile per points.json id. |
| `hub/tile-groups.ts` | Temperatures / Electrical / Thermostat calls / Board from each point's unit. |
| `public/icons/` `public/sw.js` | PWA icons and a network-only service worker (does not cache readings). |

## Local collector (`collector/`, `server.ts`)

Runs on the Windows PC or Pi next to Mosquitto. Outbound only.

| File | What it does |
|---|---|
| `server.ts` | Process entry: `npm run collector` / `npm run hub`. |
| `collector/cli.ts` | Load `.env.local`, subscribe, flush every 2 s, cron tick every 60 s. Never publishes. |
| `collector/buffer.ts` | SQLite pending queue. Survives a Wi-Fi drop. |
| `collector/forwarder.ts` | POST batch to ingest. Ignores extra keys on the JSON response. |
| `collector/cron-tick.ts` | Outbound GET `/api/cron/rules`. One attempt; failures wait for the next minute. |

## Firmware (`firmware/bench_node/`)

Arduino sketch for one ESP32 and two DS18B20 probes on GPIO 4. Unchanged
by the TypeScript / Vercel work.

| File | What it does |
|---|---|
| `bench_node.ino` | Read probes, publish JSON every 10 s, never listen for inbound MQTT. Serial at 115200 is the debug console. |
| `config.h.example` | Template for Wi-Fi and the **LAN IP of Mosquitto**. Copy to `config.h` (gitignored) and fill in. |

Power from USB. 4.7 kΩ pull-up to **3.3 V**, not 5 V. Do not tap the furnace transformer.

## Simulator (`simulator/`)

Desk stand-in for the ESP32 until the board is flashed. Same topic and JSON.

| File | What it does |
|---|---|
| `bench-publisher.ts` | Temps plus call/amps/LED stand-ins. `--fault` holds a signature. Retain off. |
| `cli.ts` | Starts the publisher from `npm run simulate`. |

## Config, Prisma, env

| File | What it does |
|---|---|
| `config/mosquitto.conf` | Local MQTT broker: port 1883, anonymous, no persistence. Do not port-forward. |
| `config/points.json` | See below. JSON cannot hold comments. |
| `docker-compose.yml` | Optional Mosquitto **and** local Postgres 16 (`hvac` / `hvac` / `hvac` on 5432). |
| `prisma/schema.prisma` | `readings`, `collector_status`, and `alerts`. |
| `prisma/migrations/` | Apply with `npx prisma migrate deploy` (includes the alerts table). |
| `config/rules.json` | Versioned thresholds. Bump `version` on every change. |
| `config/led_codes.json` | Placeholder: `0` is normal. No guessed brand table. |
| `vercel.json` | Cron: GET `/api/cron/rules` once a day (`0 9 * * *`) as a Hobby backstop. |
| `.env.example` | Every variable, placeholders, comments on where to get each. Copy to `.env.local`. Includes empty-ready `CRON_SECRET`. |
| `.env.local` | Gitignored. Localhost:3000 + collector. |
| `.env.production` | Committed with **empty** values. Real prod keys live in the Vercel UI. |
| `package.json` | `npm run dev` (Next :3000), `npm run collector`, `npm test`, `postinstall` prisma generate. Node `>=20.9` (Node 24 on Windows included). `better-sqlite3` 12.x has a Node 24 win32 prebuild, so install does not need Visual Studio. |
| `vitest.config.ts` | Tells Vitest to collect `tests/` and run them in Node. |

### `config/points.json`

List of tiles the page knows about, in display order. Phase B ships the two
temps plus call/amps/LED stand-ins the simulator publishes. Firmware still
sends only the two temps; extra tiles stay missing/stale until hardware
exists. A rule whose point is not in this file skips instead of guessing.

| Field | Meaning |
|---|---|
| `id` | Wire name in the MQTT JSON (`return_air_temp`, `supply_air_temp`). Must match the firmware / simulator. |
| `name` | Label on the tile ("Return air", "Supply air"). |
| `unit` | `F`, `A`, `bool`, or `code`. |
| `node_id` | Which ESP32 publishes it. Phase 1 is `bench`, which becomes topic `hvac/bench/reading`. |

If you add a point later, add it here **and** in the firmware/simulator. A
payload for an unknown id still stores, but the planned tile will be
missing until this file lists it. Invalid ids (spaces, uppercase) make
the hub refuse to start.

## Tests (`tests/`)

| File | What it does |
|---|---|
| `phase1.test.ts` | The original 19 Phase 1 cases: 10 s updates, 120 s stale, no write path, bad temps hidden, GET-only people API. Frozen clock, temp SQLite — no live Mosquitto. |
| `cloud.test.ts` | Ingest secret reject/store, Clerk 401, stale from DB-shaped rows, collector forward + retry, never publishes. |
| `ui.test.ts` | Seven-screen shell, placeholders, Alerts styling, stale grey styling, PWA manifest/icons. |
| `rules.test.ts` | One case per rule (fire / no-fire / timing), 30-minute dedupe, skip if point missing. |
| `alerts-api.test.ts` | Cron secret reject, 405 on writes, Clerk 401 on GET `/api/alerts`, ingest still `{ accepted }`. |

Run with `npm test` from the repo root (after `npm install`).

## How to debug

### Where logs go

- **Next.js** (`npm run dev` / Vercel): stdout / Vercel logs. Look for ingest 401s and Prisma errors.
- **Collector** (`npm run collector`): stdout. `forwarded N reading(s)` or `ingest retry`.
- **Simulator** (`npm run simulate`): stdout. `published {...}` means it sent; `broker ... not up yet` means Mosquitto is not running.
- **ESP32**: Arduino Serial Monitor at 115200. `wifi down`, `mqtt down`, `probes: 0`, `missing return_air_temp` are the usual clues.
- **Mosquitto**: the Windows service, the terminal where you ran `mosquitto -c config/mosquitto.conf`, or `docker compose logs`.
- **Browser**: Clerk sign-in first; then the banner (`Can't reach the hub.` or `MQTT broker not connected.`) plus the Network tab for `/api/readings`.
- **Local SQLite buffer**: `%LOCALAPPDATA%\hvac-monitor\hvac.db` on Windows, or `~/.local/share/hvac-monitor/hvac.db` elsewhere. Override with `HVAC_DB`. This is the collector retry queue, not Postgres.
- **Postgres**: Neon / Vercel dashboard, or `docker compose logs postgres`.

### Run the stack

From the repo root, after `Copy-Item .env.example .env.local`, filling keys, `npm install`, and `npx prisma migrate deploy`:

1. Broker: Windows Mosquitto service, **or** `mosquitto -c config/mosquitto.conf`, **or** `docker compose up -d mosquitto`
2. App: `npm run dev` then open http://localhost:3000 and sign in
3. Collector: `npm run collector`
4. Fake node: `npm run simulate`

The two temperatures should step every 10 seconds. Stop the simulator; both
tiles turn grey and say **Stale** within 2 minutes, and the numbers disappear.

To run tests (no broker needed):

```text
npm test
```

Expect the original 19 Phase 1 tests plus cloud/collector, UI shell, and Phase B rules/alerts cases.

### Common failure points

| What you see | Likely cause | Check first |
|---|---|---|
| Redirected to `/sign-in` | No Clerk session, or keys missing in `.env.local` | Clerk dashboard; `NEXT_PUBLIC_CLERK_*` and `CLERK_SECRET_KEY` |
| Page: "Can't reach the hub." | Next.js not running, or `/api/readings` 401 | `npm run dev`; Network tab; sign in |
| Page: "MQTT broker not connected." | Collector not running or ingest failing | `npm run collector`; `INGEST_SECRET` matches; `HUB_INGEST_URL` |
| Tiles stay "No reading" with app up | Nothing reaching ingest | Simulator / ESP32; collector logs; Mosquitto |
| Simulator: "broker not up yet" | Mosquitto not listening on 1883 | Windows service, `docker compose up -d mosquitto` |
| ESP32: `wifi down` | Bad SSID/password, or 5 GHz-only AP | `config.h`; 2.4 GHz Wi-Fi |
| ESP32: `mqtt down` | `MQTT_HOST` is not the PC's LAN IP | Not `127.0.0.1` on the board; not a Vercel URL |
| ESP32: `probes: 0` / `missing ...` | Wiring, 5 V on data, missing 4.7 kΩ | GPIO 4, 3.3 V pull-up, shared GND |
| Tiles never go stale after unplug | Retained MQTT message, or collector still flushing an old buffer | Firmware/simulator use retain off; age is cloud `received_at` |
| `prisma migrate` fails | Empty `DATABASE_URL` / `DIRECT_URL` | `.env.local`; Docker Postgres or Neon |
| `next build` wants Clerk | Keys look real but are invalid | Placeholders must stay placeholders, or use real keys |
| POST `/api/readings` or `/api/alerts` | People API is still GET-only | 405 on those paths; ingest is `/api/ingest` with a secret |
| Cron 401 / 503 | Missing or empty `CRON_SECRET` | `.env.local` and Vercel env; Vercel sends `Authorization: Bearer CRON_SECRET` |
| `write()` / collector MQTT publish | There is no write path | `WriteNotSupported`; collector never calls publish |
| Tests fail after you only added comments | A comment contained a string a test forbids | Firmware must not contain `subscribe(` or `digitalWrite(`; `LivePage.tsx` must not contain `innerHTML` |

### Safety reminders while debugging

- Do not flash the board with a sketch that listens for commands or drives GPIO into the furnace.
- Do not port-forward 1883 on the router.
- Do not commit `firmware/bench_node/config.h` (it has the Wi-Fi password) or `.env.local`.
- A stale tile is not "the last known good temp." It means we do not know the current temp.
- Ingest storing a row in Postgres is storage, not equipment control. Returning a command from ingest is not allowed.
