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
        |  Mosquitto on port 1883
        v
hub/gateway.ts   listens only; write() always throws WriteNotSupported
        |
        v
hub/parsing.ts   drop bad JSON / wrong topic; mark out-of-range as BAD
        |
        v
hub/store.ts     append one SQLite row (received_at = hub clock)
        |
        v
hub/live.ts      age from received_at; after 120 s the number is stripped
        |
        v
app/api/readings/route.ts   GET /api/readings  (Cache-Control: no-store)
        |
        v
components/LivePage.tsx     poll every 1 s; grey tile if not live
```

Nothing flows back toward the equipment.

## Why a custom Node server

`server.ts` starts the MQTT subscriber, then serves Next.js.

Next.js App Router handlers run per HTTP request. They are a bad home for a
socket that must stay up all day. A second worker process sharing SQLite
would also be sound (the page would always read the latest row from disk).
One process is simpler for a PC or Pi hub: one `better-sqlite3` connection,
and `mqtt_connected` is just `gateway.connected` in memory.

`npm run hub` is that custom server. Do not expect `next start` alone to
subscribe to Mosquitto.

## Hub (`hub/`)

TypeScript modules used by the custom server and by App Router route
handlers. Run the process with `npm run hub`.

| File | What it does |
|---|---|
| `topics.ts` | Topic and id patterns. There is no command topic. |
| `clock.ts` | UTC timestamps. `ManualClock` lets tests jump 120 s without waiting. |
| `config.ts` | Settings from env vars plus `config/points.json`. Stale default is 120 s. |
| `models.ts` | Shared types. `BuildingGateway.write()` throws `WriteNotSupported` on purpose. |
| `parsing.ts` | Turns MQTT JSON into a `StoredReading`. Extra keys (even `"command"`) are ignored. |
| `store.ts` | SQLite log (`better-sqlite3`). The page only reads the latest row per point. |
| `live.ts` | Decides live / stale / bad / missing. Hides the number unless status is live. |
| `gateway.ts` | MQTT listener (mqtt.js). Subscribes to `hvac/+/reading`. Does not publish. |
| `http.ts` | GET/HEAD only. Write methods are 405. Builds the `/api/readings` JSON. |
| `runtime.ts` | One store + gateway on `globalThis` so Next.js and MQTT share them. |

## Next.js app (`app/`, `components/`, `server.ts`)

| File | What it does |
|---|---|
| `server.ts` | Process entry: start MQTT, wrap Next.js, reject POST. First process to check if the page never loads. |
| `app/layout.tsx` | HTML shell and CSS import. |
| `app/page.tsx` | Renders the live page. No forms or buttons. |
| `app/globals.css` | White tile = live. Grey = anything else (stale, bad, missing). |
| `app/api/readings/route.ts` | GET `/api/readings` for the tiles. |
| `app/api/health/route.ts` | GET `/api/health`. |
| `app/openapi.json/route.ts` | GET-only OpenAPI so tests can see there is no write path. |
| `components/LivePage.tsx` | Polls `/api/readings` every 1 s. Shows a number only for live numeric values. |

## Firmware (`firmware/bench_node/`)

Arduino sketch for one ESP32 and two DS18B20 probes on GPIO 4. Unchanged
by the TypeScript port.

| File | What it does |
|---|---|
| `bench_node.ino` | Read probes, publish JSON every 10 s, never listen for inbound MQTT. Serial at 115200 is the debug console. |
| `config.h.example` | Template for Wi-Fi and the hub LAN IP. Copy to `config.h` (gitignored) and fill in. |

Power from USB. 4.7 kΩ pull-up to **3.3 V**, not 5 V. Do not tap the furnace transformer.

## Simulator (`simulator/`)

Desk stand-in for the ESP32 until the board is flashed. Same topic and JSON.

| File | What it does |
|---|---|
| `bench-publisher.ts` | Two temperatures that bump 0.1 °F every 10 s. Retain is off so stopping it lets tiles go stale. |
| `cli.ts` | Starts the publisher from `npm run simulate`. |

## Config (`config/`) and other run files

| File | What it does |
|---|---|
| `config/mosquitto.conf` | Local MQTT broker: port 1883, anonymous, no persistence. Do not port-forward. |
| `config/points.json` | See below. JSON cannot hold comments. |
| `docker-compose.yml` | Optional `docker compose up -d` to run Mosquitto with that config. |
| `package.json` | Node packages and scripts: `npm test`, `npm run hub`, `npm run simulate`. |
| `vitest.config.ts` | Tells Vitest to collect `tests/` and run them in Node. |

### `config/points.json`

List of tiles the page knows about, in display order. Phase 1 ships two:

| Field | Meaning |
|---|---|
| `id` | Wire name in the MQTT JSON (`return_air_temp`, `supply_air_temp`). Must match the firmware / simulator. |
| `name` | Label on the tile ("Return air", "Supply air"). |
| `unit` | `F` for these two temperatures. |
| `node_id` | Which ESP32 publishes it. Phase 1 is `bench`, which becomes topic `hvac/bench/reading`. |

If you add a point later, add it here **and** in the firmware/simulator. A
payload for an unknown id still stores, but the planned tile will be
missing until this file lists it. Invalid ids (spaces, uppercase) make
the hub refuse to start.

## Tests (`tests/`)

| File | What it does |
|---|---|
| `phase1.test.ts` | The Phase 1 pass in software: 10 s updates, 120 s stale, no write path, bad temps hidden, GET-only API. Uses a frozen clock and a temp database — no live Mosquitto required. |

Run with `npm test` from the repo root (after `npm install`).

## How to debug

### Where logs go

- **Hub** (`npm run hub`): stdout. Look for `reading return_air_temp=...`, `dropped mqtt payload`, `mqtt connect failed`, `mqtt subscribed to hvac/+/reading`.
- **Simulator** (`npm run simulate`): stdout. `published {...}` means it sent; `broker ... not up yet` means Mosquitto is not running.
- **ESP32**: Arduino Serial Monitor at 115200. `wifi down`, `mqtt down`, `probes: 0`, `missing return_air_temp` are the usual clues.
- **Mosquitto**: the Windows service, the terminal where you ran `mosquitto -c config/mosquitto.conf`, or `docker compose logs`.
- **Browser**: the banner on the page (`Can't reach the hub.` or `MQTT broker not connected.`) plus the Network tab for `/api/readings`.
- **SQLite**: not a log file. Path is `%LOCALAPPDATA%\hvac-monitor\hvac.db` on Windows, or `~/.local/share/hvac-monitor/hvac.db` elsewhere. Override with `HVAC_DB`.

### Run the stack

Three terminals, from the repo root, after `npm install` and `npm run build`:

1. Broker: Windows Mosquitto service, **or** `mosquitto -c config/mosquitto.conf`, **or** `docker compose up -d`
2. Hub: `npm run hub` then open http://127.0.0.1:8000
3. Fake node: `npm run simulate`

The two temperatures should step every 10 seconds. Stop the simulator; both
tiles turn grey and say **Stale** within 2 minutes, and the numbers disappear.

To run tests (no broker needed):

```text
npm test
```

Expect 19 passed.

### Common failure points

| What you see | Likely cause | Check first |
|---|---|---|
| Page: "Can't reach the hub." | Hub process not running | `npm run hub`; port 8000 free; `npm run build` already ran |
| Page: "MQTT broker not connected." | Mosquitto down or wrong host | Broker terminal / Windows service; `HVAC_MQTT_HOST` |
| Tiles stay "No reading" with hub up | Nothing is publishing | Simulator running, or ESP32 Serial |
| Simulator: "broker not up yet" | Mosquitto not listening on 1883 | Windows service, `docker compose up -d`, or mosquitto command |
| ESP32: `wifi down` | Bad SSID/password, or 5 GHz-only AP | `config.h`; 2.4 GHz Wi-Fi |
| ESP32: `mqtt down` | `MQTT_HOST` is not the hub's LAN IP | Not `127.0.0.1` on the board; ping the PC |
| ESP32: `probes: 0` / `missing ...` | Wiring, 5 V on data, missing 4.7 kΩ | GPIO 4, 3.3 V pull-up, shared GND |
| Tiles never go stale after unplug | Retained MQTT message, or hub clock | Firmware/simulator use retain off; age is `received_at` |
| Tiles go stale while the node is up | Wi-Fi drop, or hub not receiving | Hub logs for `dropped mqtt payload`; topic must be `hvac/bench/reading` |
| Number looks frozen but not grey | Browser cache | API sends `Cache-Control: no-store`; hard-refresh |
| Hub won't start, error about points | Bad `points.json` | Duplicate id, empty name, invalid characters |
| `write()` / POST `/api/readings` | There is no write path | 405 on POST; `WriteNotSupported` in TypeScript — that is the safety rule |
| Tests fail after you only added comments | A comment contained a string a test forbids | Firmware must not contain `subscribe(` or `digitalWrite(`; `LivePage.tsx` must not contain `innerHTML` |

### Safety reminders while debugging

- Do not flash the board with a sketch that listens for commands or drives GPIO into the furnace.
- Do not port-forward 1883 or 8000 on the router.
- Do not commit `firmware/bench_node/config.h` (it has the Wi-Fi password).
- A stale tile is not "the last known good temp." It means we do not know the current temp.
