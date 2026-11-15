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
hub/gateway.py   listens only; write() always raises WriteNotSupported
        |
        v
hub/parsing.py   drop bad JSON / wrong topic; mark out-of-range as BAD
        |
        v
hub/store.py     append one SQLite row (received_at = hub clock)
        |
        v
hub/live.py      age from received_at; after 120 s the number is stripped
        |
        v
hub/app.py       GET /api/readings  (Cache-Control: no-store)
        |
        v
web/app.js       poll every 1 s; grey tile if not live
```

Nothing flows back toward the equipment.

## Hub (`hub/`)

Python FastAPI process. Run with `python -m hub`. Serves the page and
listens to MQTT.

| File | What it does |
|---|---|
| `__init__.py` | Package marker and version. The hub is the home-network brain. |
| `__main__.py` | Starts uvicorn when you type `python -m hub`. First process to check if the page never loads. |
| `app.py` | HTTP routes: `/` (the page), `/api/readings` (tiles), `/api/health`. GET only. |
| `clock.py` | UTC timestamps. `ManualClock` lets tests jump 120 s without waiting. |
| `config.py` | Settings from env vars plus `config/points.json`. Stale default is 120 s. |
| `gateway.py` | MQTT listener. Subscribes to `hvac/+/reading`. Does not publish. |
| `live.py` | Decides live / stale / bad / missing. Hides the number unless status is live. |
| `models.py` | Shared types. `BuildingGateway.write()` raises `WriteNotSupported` on purpose. |
| `parsing.py` | Turns MQTT JSON into a `StoredReading`. Extra keys (even `"command"`) are ignored. |
| `store.py` | SQLite log. The page only reads the latest row per point. |
| `topics.py` | Topic and id patterns. There is no command topic. |

## Firmware (`firmware/bench_node/`)

Arduino sketch for one ESP32 and two DS18B20 probes on GPIO 4.

| File | What it does |
|---|---|
| `bench_node.ino` | Read probes, publish JSON every 10 s, never listen for inbound MQTT. Serial at 115200 is the debug console. |
| `config.h.example` | Template for Wi-Fi and the hub LAN IP. Copy to `config.h` (gitignored) and fill in. |

Power from USB. 4.7 kΩ pull-up to **3.3 V**, not 5 V. Do not tap the furnace transformer.

## Simulator (`simulator/`)

Desk stand-in for the ESP32 until the board is flashed. Same topic and JSON.

| File | What it does |
|---|---|
| `__init__.py` | Package marker. |
| `__main__.py` | Starts the publisher from `python -m simulator`. |
| `bench_publisher.py` | Two temperatures that bump 0.1 °F every 10 s. Retain is off so stopping it lets tiles go stale. |

## Web (`web/`)

The live page the hub serves at `http://127.0.0.1:8000`. Display only.

| File | What it does |
|---|---|
| `index.html` | Shell: title, banner, empty tile grid, "Read only" footer. No forms or buttons. |
| `app.js` | Polls `/api/readings` every 1 s. Shows a number only for live numeric values. |
| `style.css` | White tile = live. Grey = anything else (stale, bad, missing). |

## Config (`config/`) and other run files

| File | What it does |
|---|---|
| `config/mosquitto.conf` | Local MQTT broker: port 1883, anonymous, no persistence. Do not port-forward. |
| `config/points.json` | See below. JSON cannot hold comments. |
| `docker-compose.yml` | Optional `docker compose up -d` to run Mosquitto with that config. |
| `pytest.ini` | Tells pytest to import from the repo root and collect `tests/`. |
| `requirements.txt` | Python packages: FastAPI, uvicorn, paho-mqtt, pytest, httpx. |

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
| `test_phase1.py` | The Phase 1 pass in software: 10 s updates, 120 s stale, no write path, bad temps hidden, GET-only API. Uses a frozen clock and a temp database — no live Mosquitto required. |

Run with `pytest` from the repo root (after `pip install -r requirements.txt`).

## How to debug

### Where logs go

- **Hub** (`python -m hub`): stdout. Look for `reading return_air_temp=...`, `dropped mqtt payload`, `mqtt connect failed`, `mqtt subscribed to hvac/+/reading`.
- **Simulator** (`python -m simulator`): stdout. `published {...}` means it sent; `broker ... not up yet` means Mosquitto is not running.
- **ESP32**: Arduino Serial Monitor at 115200. `wifi down`, `mqtt down`, `probes: 0`, `missing return_air_temp` are the usual clues.
- **Mosquitto**: the terminal where you ran `mosquitto -c config/mosquitto.conf`, or `docker compose logs`.
- **Browser**: the banner on the page (`Can't reach the hub.` or `MQTT broker not connected.`) plus the Network tab for `/api/readings`.
- **SQLite**: not a log file. Path is `%LOCALAPPDATA%\hvac-monitor\hvac.db` on Windows, or `~/.local/share/hvac-monitor/hvac.db` elsewhere. Override with `HVAC_DB`.

### Run the stack

Three terminals, from the repo root, after `pip install -r requirements.txt`:

1. Broker: `mosquitto -c config/mosquitto.conf` **or** `docker compose up -d`
2. Hub: `python -m hub` then open http://127.0.0.1:8000
3. Fake node: `python -m simulator`

The two temperatures should step every 10 seconds. Stop the simulator; both
tiles turn grey and say **Stale** within 2 minutes, and the numbers disappear.

To run tests (no broker needed):

```text
pytest
```

Expect 19 passed. Same result after comment-only edits.

### Common failure points

| What you see | Likely cause | Check first |
|---|---|---|
| Page: "Can't reach the hub." | Hub process not running | `python -m hub`; port 8000 free |
| Page: "MQTT broker not connected." | Mosquitto down or wrong host | Broker terminal; `HVAC_MQTT_HOST` |
| Tiles stay "No reading" with hub up | Nothing is publishing | Simulator running, or ESP32 Serial |
| Simulator: "broker not up yet" | Mosquitto not listening on 1883 | `docker compose up -d` or mosquitto command |
| ESP32: `wifi down` | Bad SSID/password, or 5 GHz-only AP | `config.h`; 2.4 GHz Wi-Fi |
| ESP32: `mqtt down` | `MQTT_HOST` is not the hub's LAN IP | Not `127.0.0.1` on the board; ping the PC |
| ESP32: `probes: 0` / `missing ...` | Wiring, 5 V on data, missing 4.7 kΩ | GPIO 4, 3.3 V pull-up, shared GND |
| Tiles never go stale after unplug | Retained MQTT message, or hub clock | Firmware/simulator use retain off; age is `received_at` |
| Tiles go stale while the node is up | Wi-Fi drop, or hub not receiving | Hub logs for `dropped mqtt payload`; topic must be `hvac/bench/reading` |
| Number looks frozen but not grey | Browser cache | API sends `Cache-Control: no-store`; hard-refresh |
| Hub won't start, error about points | Bad `points.json` | Duplicate id, empty name, invalid characters |
| `write()` / POST `/api/readings` | There is no write path | 405 on POST; `WriteNotSupported` in Python — that is the safety rule |
| Tests fail after you only added comments | A comment contained a string a test forbids | Firmware must not contain `subscribe(` or `digitalWrite(`; `app.js` must not contain `innerHTML` |

### Safety reminders while debugging

- Do not flash the board with a sketch that listens for commands or drives GPIO into the furnace.
- Do not port-forward 1883 or 8000 on the router.
- Do not commit `firmware/bench_node/config.h` (it has the Wi-Fi password).
- A stale tile is not "the last known good temp." It means we do not know the current temp.
