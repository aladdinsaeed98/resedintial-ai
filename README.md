# Residential HVAC Monitor — phase 1

Monitor-only bench for one ESP32 and two DS18B20 probes. The node publishes readings. The hub stores them and serves a page. Nothing in this project can turn equipment on, off, or change a setting.

A reading is `{point, value, unit, timestamp, quality}` on `hvac/{node}/reading`. The page shows the number while samples are arriving, and replaces it with **Stale** when a point has been silent for 2 minutes. The last number is not left on screen.

The hub is a **Next.js (App Router, TypeScript)** app. A custom Node server starts the MQTT subscriber as soon as the process starts, then serves the App Router page and `GET /api/readings`. The hub never publishes on MQTT. Phase 2 (install, history charts) is not started.

## Software pass

Needs Node.js 20 or newer. In PowerShell, from the repo folder:

```powershell
npm install
npm test
npm run build
```

`npm test` (Vitest) checks the 10-second update path, the 2-minute stale cutoff, and that stale or bad-quality numbers are absent from the page payload.

## Run the page

The owner’s PC already runs **Mosquitto as a Windows service on port 1883**. You can skip Terminal 1 unless that service is stopped.

Terminal 1, broker (only if the Windows service is not running). Install [Mosquitto](https://mosquitto.org/download/) or use Docker:

```powershell
mosquitto -c config/mosquitto.conf
```

```powershell
docker compose up -d
```

Terminal 2, hub (after `npm install` and `npm run build`):

```powershell
npm run hub
```

Open http://127.0.0.1:8000

For local code changes without a production build:

```powershell
npm run dev
```

Terminal 3, stand-in for the ESP32 until the board is flashed:

```powershell
npm run simulate
```

The two temperatures step every 10 seconds. Stop the simulator (or unplug the ESP32). Within 2 minutes both tiles turn grey, say Stale, and the temperatures are gone.

The database is `%LOCALAPPDATA%\hvac-monitor\hvac.db`, not in this iCloud folder. Override with `HVAC_DB`.

Do not port-forward 1883 or 8000 on the router. The page is open on the LAN and has no password yet. It also has no control path.

## Architecture

MQTT has to stay connected even when nobody is looking at the page. Next.js route handlers are not a long-lived process, so `server.ts` is a small custom Node server that:

1. Opens SQLite (`better-sqlite3`) and subscribes to `hvac/+/reading` with mqtt.js.
2. Hands GET/HEAD to Next.js (the live page and `/api/readings`).
3. Returns **405** for POST/PUT/PATCH/DELETE.
4. Never publishes on MQTT. `write()` on the gateway throws `WriteNotSupported`.

A separate worker sharing the database would also work. One process is enough for a home hub: one SQLite connection, and `mqtt_connected` does not need a second channel.

## Flash the ESP32

Board: ESP32 Dev Module. Libraries: PubSubClient, OneWire, DallasTemperature.

1. Copy `firmware/bench_node/config.h.example` to `config.h`.
2. Set Wi-Fi and the hub's LAN address (`MQTT_HOST`). `NODE_ID` stays `bench`.
3. Flash `bench_node.ino`.
4. Wire both probes to GPIO 4 with a 4.7k pull-up to **3.3 V**, not 5 V. Power the board from USB.

The first probe printed on serial is return air. The second is supply air. A disconnected probe is sent as a bad reading and the page does not show a number. The sketch publishes every 10 seconds and does not subscribe.

This phase is the desk. Do not land the probes in the furnace yet.

## Assumptions for this phase

This PC is the hub. One bench node. Stale after 120 seconds. Later phases still need the Goodman model and LED table, where the hub will live long-term, condenser Wi-Fi, and whether this should feed the supervisory agent.
