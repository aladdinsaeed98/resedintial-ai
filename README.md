# Residential HVAC Monitor — phase 1

Monitor-only bench for one ESP32 and two DS18B20 probes. The node publishes readings on the home LAN. A small **local collector** forwards them outbound over HTTPS. A **Next.js app on Vercel** stores them in Postgres and shows a signed-in dashboard. Nothing in this project can turn equipment on, off, or change a setting.

A reading is `{point, value, unit, timestamp, quality}` on `hvac/{node}/reading`. The dashboard shows the number while samples are arriving, and replaces it with **Stale** when a point has been silent for 2 minutes (`received_at` from the cloud, not the node's clock). The last number is not left on screen.

Fault rules live in `config/rules.json` and run on each ingest (and on a Vercel Cron tick for silent sensors). Many thermostats delay compressor start by about 5 minutes, so `call_no_compressor` may need its `after_s` raised from 180 to 360 after you watch a few real calls.

Phase C (ntfy / email / healthchecks / audit log) is not started.

## Architecture (why two processes)

Vercel is serverless. It cannot hold a long-lived MQTT socket to Mosquitto on the home LAN. Port **1883 must never be port-forwarded**.

```text
ESP32 / simulator  --MQTT-->  Mosquitto :1883 (LAN only)
                                    |
                                    v
                         local collector (Windows PC or Pi)
                         subscribe hvac/+/reading
                         never publishes
                                    |
                                    | outbound HTTPS POST /api/ingest
                                    | Authorization: Bearer INGEST_SECRET
                                    | local SQLite buffer + retry if offline
                                    v
                         Vercel Next.js + Clerk + Prisma/Postgres
                         dashboard GET /api/readings (poll)
```

A webhook the other way (Mosquitto bridging inbound) would mean opening the house to the internet. Outbound HTTPS from a machine that already sits next to the broker is the safer shape.

## Software pass

Needs **Node.js 20.9 or newer**. Node 24 is supported, including 24.19 on Windows. `better-sqlite3` 12.x ships a win32/x64 prebuild for Node 24, so `npm install` does not need Visual Studio C++.

In PowerShell, from the repo folder:

```powershell
Copy-Item .env.example .env.local
# paste Clerk, DATABASE_URL / DIRECT_URL, and INGEST_SECRET into .env.local
npm install
npx prisma migrate deploy
npm test
npm run build
```

`npm test` (Vitest) checks the 10-second update path, the 2-minute stale cutoff, ingest auth, Clerk 401, collector retry, each fault rule (fire / no-fire / timing), the 30-minute alert dedupe window, cron auth, 405s on writes, and that stale or bad-quality numbers are absent from the page payload.

`npm run build` works with placeholder env (empty Clerk / database keys). It does not need a real Clerk app or Postgres until you run the dashboard for real.

## Env files

| File | Git | What it is |
|---|---|---|
| `.env.example` | committed | Every variable, placeholder values, comments on where to get each |
| `.env.local` | **gitignored** | Your localhost:3000 secrets. Copy from `.env.example` |
| `.env.production` | committed, **empty values** | Same keys, left blank. Real production values live in the Vercel UI |

Never commit real keys.

## Run locally (http://localhost:3000)

The owner’s PC already runs **Mosquitto as a Windows service on port 1883**. You can skip the broker terminal unless that service is stopped.

1. Copy env and fill it in (Clerk keys, Postgres URL, ingest secret). See the Windows setup section below.
2. Database: local Docker **or** a Neon/Vercel cloud database used for dev.

```powershell
docker compose up -d postgres
# then in .env.local:
# DATABASE_URL=postgresql://hvac:hvac@127.0.0.1:5432/hvac
# DIRECT_URL=postgresql://hvac:hvac@127.0.0.1:5432/hvac
npx prisma migrate deploy
```

3. Three terminals from the repo folder:

```powershell
npm run dev
```

Open http://localhost:3000 — Clerk sign-in, then the dark Home screen. The
bottom bar has Home, Live, History, Codes, Alerts, Ask, and Settings. Home
and Live show `/api/readings`. Alerts shows `/api/alerts`. History, Codes,
Ask, and Settings still say "Coming in a later phase". Home can show an
active-alert count only when it is not zero. On a phone, browser menu → Add
to Home Screen (PWA). The app is still **Read only**.

```powershell
npm run collector
```

```powershell
npm run simulate
# Hold a fault signature (timing rules still need enough elapsed time):
npm run simulate -- --fault call_no_compressor
```

The simulator publishes the two temps plus call/amps/LED stand-ins every 10 seconds. Firmware still sends only the two temps — extra tiles go Stale until those sensors exist, and `stale_sensor` will alert unless you remove the unused ids from `config/points.json`. Stop the simulator (or unplug the ESP32). Within 2 minutes live tiles turn grey, say Stale, and the numbers are gone.

The collector's retry buffer is `%LOCALAPPDATA%\hvac-monitor\hvac.db`, not in this iCloud folder. Override with `HVAC_DB`. That file is **not** the cloud database.

Do not port-forward 1883 on the router.

## Windows setup (Clerk, Vercel, Postgres)

Do this once. Production can wait; localhost works as soon as Clerk + a database URL are in `.env.local`.

### A. GitHub repo

This project is already on GitHub (`aladdinsaeed98/resedintial-ai`). Vercel will import it.

### B. Clerk

1. Create an account at [https://dashboard.clerk.com](https://dashboard.clerk.com).
2. Add an application (name it `hvac-monitor` or similar).
3. Copy **Publishable key** (`pk_test_…` or `pk_live_…`) and **Secret key** (`sk_test_…` / `sk_live_…`).
4. In Clerk → Configure → Paths, set sign-in `/sign-in` and sign-up `/sign-up`, after-sign-in `/`.
5. Paste into `.env.local`:
   - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
   - `CLERK_SECRET_KEY`
6. Later, paste the **same** keys (or the live pair) into the Vercel project env.

### C. Vercel project

1. Create an account at [https://vercel.com](https://vercel.com) and import the GitHub repo.
2. Framework preset: **Next.js**. Root directory: repo root. Build command `npm run build` is already in `package.json`.
3. Do **not** add MQTT host/port to Vercel env. The serverless app never opens MQTT.

### D. Vercel Marketplace Postgres (Neon)

1. In the Vercel project: Storage → Create Database → Postgres (Neon is the usual Marketplace option).
2. Connect it to the project. Vercel injects `DATABASE_URL`. Neon also gives a **direct** URL for migrations — set `DIRECT_URL` to that (no `pgbouncer` query). If Vercel only shows one URL, use it for both locally; on Neon, pooled = `DATABASE_URL`, direct = `DIRECT_URL`.
3. Run migrations once against that database (from your PC, with those URLs in `.env.local`):

```powershell
npx prisma migrate deploy
```

Vercel will run `postinstall` → `prisma generate` on each deploy. You still run `migrate deploy` from a machine that can reach Postgres when the schema changes.

### E. Ingest secret

Pick a long random string. Same value in three places:

- `.env.local` as `INGEST_SECRET` (local Next and the collector both read this file)
- Vercel env `INGEST_SECRET` (Production / Preview)
- `.env.local` `HUB_INGEST_URL=http://localhost:3000/api/ingest` for local; for the house collector pointed at production, `HUB_INGEST_URL=https://YOUR_APP.vercel.app/api/ingest`

PowerShell one-liner:

```powershell
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }) -as [byte[]])
```

### F. What goes where

| Variable | `.env.local` (PC) | Vercel project env |
|---|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | yes | yes |
| `CLERK_SECRET_KEY` | yes | yes |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in` | yes | yes |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up` | yes | yes |
| `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/` | yes | yes |
| `NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/` | yes | yes |
| `DATABASE_URL` | yes (Docker or Neon) | yes (Marketplace) |
| `DIRECT_URL` | yes | yes (Neon direct) |
| `INGEST_SECRET` | yes | yes |
| `CRON_SECRET` | yes (local cron tests) | yes (Vercel Cron) |
| `HUB_INGEST_URL` | yes (collector) | no (unused on Vercel) |
| `HVAC_MQTT_HOST` / `HVAC_MQTT_PORT` | yes (collector) | **no** |
| `HVAC_DB` | optional (collector buffer) | **no** |
| `HVAC_SYSTEM_NAME` / `HVAC_STALE_AFTER_SECONDS` | optional | optional (dashboard labels) |

### G. Daily local run

```powershell
npm run dev          # http://localhost:3000
npm run collector    # MQTT → HTTPS ingest
npm run simulate     # fake ESP32, or flash the real board
```

Sign in with the Clerk user you created. Footer still says **Read only**. After pulling this phase, apply the alerts migration once:

```powershell
npx prisma migrate deploy
```

Set `CRON_SECRET` in the Vercel project env (same long random string as `.env.local`). Hobby cron may only run once a day; ingest still evaluates rules on every collector POST.

## Flash the ESP32

Board: ESP32 Dev Module. Libraries: PubSubClient, OneWire, DallasTemperature.

1. Copy `firmware/bench_node/config.h.example` to `config.h`.
2. Set Wi-Fi and the **PC's LAN address** (`MQTT_HOST`). That is Mosquitto, not Vercel. `NODE_ID` stays `bench`.
3. Flash `bench_node.ino`.
4. Wire both probes to GPIO 4 with a 4.7k pull-up to **3.3 V**, not 5 V. Power the board from USB.

The first probe printed on serial is return air. The second is supply air. A disconnected probe is sent as a bad reading and the page does not show a number. The sketch publishes every 10 seconds and does not subscribe.

This phase is the desk. Do not land the probes in the furnace yet.

## Assumptions for this phase

Mosquitto stays on the home PC. The dashboard is on Vercel. Stale after 120 seconds. Later phases still need the Goodman model and LED table, condenser Wi-Fi, and whether this should feed the supervisory agent.
