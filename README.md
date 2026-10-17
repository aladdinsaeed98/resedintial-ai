# Residential HVAC Monitor — phase 1

Monitor-only bench for one ESP32 and two DS18B20 probes. The node publishes readings. The hub stores them and serves a page. Nothing in this project can turn equipment on, off, or change a setting.

A reading is `{point, value, unit, timestamp, quality}` on `hvac/{node}/reading`. The page shows the number while samples are arriving, and replaces it with **Stale** when a point has been silent for 2 minutes. The last number is not left on screen.

Phase 2 (install, history charts) is not started.

## Software pass

The repo lives in iCloud Drive, so keep the virtualenv on local disk:

```powershell
py -3 -m venv $env:LOCALAPPDATA\hvac-monitor\venv
& $env:LOCALAPPDATA\hvac-monitor\venv\Scripts\Activate.ps1
pip install -r requirements.txt
pytest
```

`pytest` checks the 10-second update path, the 2-minute stale cutoff, and that stale or bad-quality numbers are absent from the page payload.

## Run the page

Terminal 1, broker (install [Mosquitto](https://mosquitto.org/download/) or use Docker):

```powershell
mosquitto -c config/mosquitto.conf
```

```powershell
docker compose up -d
```

Terminal 2, hub:

```powershell
python -m hub
```

Open http://127.0.0.1:8000

Terminal 3, stand-in for the ESP32 until the board is flashed:

```powershell
python -m simulator
```

The two temperatures step every 10 seconds. Stop the simulator (or unplug the ESP32). Within 2 minutes both tiles turn grey, say Stale, and the temperatures are gone.

The database is `%LOCALAPPDATA%\hvac-monitor\hvac.db`, not in this iCloud folder. Override with `HVAC_DB`.

Do not port-forward 1883 or 8000 on the router. The page is open on the LAN and has no password yet. It also has no control path.

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
