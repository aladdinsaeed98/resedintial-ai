# Residential HVAC Monitor - Cursor Build Checklist
Oct 17, 2026 - Aladdin Saeed (text extracted from the user's PDF)

Tick each box as you go. Finish every pass test before starting the next phase. Each step has a prompt you can paste into Cursor.

> **Notes for this project (read before using the prompts below)**
> - **Stack:** the hub is Next.js (App Router, TypeScript), not Python. Run `npm test`, `npm run hub`, and `npm run simulate`. Do not add a Python FastAPI hub back.
> - **Firmware:** this project uses an Arduino sketch (`firmware/bench_node/bench_node.ino`, Arduino C++) instead of ESPHome. The App Plan's stack allows it: "Firmware in Arduino C++ so the LED decoder is fully under your control." Where a prompt says "ESPHome config" or "ESPHome YAML", extend the Arduino firmware instead.
> - **Layout:** the hub is a flat `hub/` TypeScript package (`hub/gateway.ts`, `hub/models.ts`, `hub/live.ts`, `hub/store.ts`, ...) with the live page in `app/` and `components/LivePage.tsx`, not the checklist's suggested `hub/gateway/mqtt_gateway.py`, `hub/web/` and so on. Readings arrive on `hvac/<node>/reading` with payload `{point, value, unit, timestamp, quality}`, not `home/<system>/<point_id>`. Where a prompt names a path or topic, use the matching existing module and topic.
> - **As built in Phase 1:** the page reads `/api/readings` (not `/api/points`) and polls every 1 s (not 5 s). Stale is decided in `hub/live.ts` from the hub's receive time (`received_at`), after 120 s. `write()` throws `WriteNotSupported` in `hub/models.ts` (`BuildingGateway`).
> - **Not done yet:** there is no commit, and `vendor/supervisory/` has not been copied in. The MQTT gateway box is ticked, but its tests were written without `vendor/supervisory/hvac_gateway/base.py`.
> - **Heads-up for the (added) receive-timestamp box:** the hub already stores its receive time as `received_at`, but `hub/live.ts` currently treats a just-arrived reading as current even when the node clock is wrong, and `tests/phase1.test.ts` (`a just arrived reading is live even if the device clock is old`) checks that. The added SUSPECT_CLOCK rule (and R15) changes that behavior, so that test has to be updated on purpose as part of that box.
> - **(added)** boxes come from the approved "Added items (approved Oct 17, 2026)" section at the end of `docs/PLAN.md`.

## How to work with Cursor
- One prompt, one job. Paste one prompt at a time and review what Cursor changed before moving on. Big multi-part prompts produce big messes.
- Tests first. Every prompt asks for tests. Run them yourself with `npm test`; a step isn't done until they pass.
- Keep the plan in the repo. Cursor reads PLAN.md and .cursor/rules/ on every request, so it builds against the design instead of guessing.
- Commit after every ticked box. If Cursor breaks something later, you can roll back one step instead of a whole phase.
- Hardware steps are yours. Anything touching the unit is done by you, with power off, not by Cursor.

## Step 0 - Set up the repo
- [ ] Create a new folder and Git repo named home-hvac-monitor, and open it in Cursor.
- [x] Install Python 3.10 or newer and create a virtual environment.
- [x] Export the App Plan doc as Markdown and save it in the repo as docs/PLAN.md.
- [ ] Copy these files from your supervisory-agent repo into vendor/supervisory/ so Cursor can read them: hvac_gateway/base.py, grounding.py, phrasing.py, intent.py, knowledge.py, learning.py, audit.py.
- [x] Create .cursor/rules/safety.md with the rules below.
- [ ] Commit.

.cursor/rules/safety.md:
```
# Hard rules for this repo
Read docs/PLAN.md before changing anything.
1. No write path. Nothing in this repo may send a command to HVAC equipment or a thermostat. The gateway's write() raises WriteNotSupported and must stay that way.
2. Every number the app, an alert, an email, or the AI states must come from a real reading taken this turn, from the named system.
3. Stale (older than 2 min) or bad-quality readings are never shown or used as current.
4. Fault detection is deterministic rules in code, never the LLM.
5. Equipment and fault-code meanings come only from the installed equipment profile. Never assume another brand's table.
6. Every alert, email, question and answer goes in the audit log.
7. Writes to the learning store and audit log are atomic (temp file + os.replace). A failed load is reported, never silent.
8. Every change comes with tests. Run them before saying it is done.
```

Cursor prompt (skeleton): Read docs/PLAN.md and .cursor/rules/safety.md. Create the project skeleton: a hub/ TypeScript package with gateway, rules, alerts, agent, and profiles modules, a Next.js App Router app/, a tests/ folder, package.json (next, mqtt, better-sqlite3, vitest), and a README explaining how to run the tests with npm test. No features yet. Add one passing placeholder test.

## Phase 1 - Bench prototype
Goal: one ESP32 with two temperature probes on your desk, readings on a web page, stale readings marked.

Hardware (you)
- [ ] Get 1 ESP32 dev board and 2 DS18B20 waterproof probes (plus a 4.7 kOhm pull-up resistor).
- [x] Install Mosquitto (MQTT broker) on the hub machine and confirm it runs.
- [ ] Install ESPHome, flash the ESP32, and confirm it joins your Wi-Fi.

Code (Cursor)
- [x] ESPHome config for the bench node (Arduino sketch, not ESPHome). Prompt: Write an ESPHome YAML for an ESP32 named indoor-node with two DS18B20 sensors on one 1-Wire bus, publishing to MQTT every 10 seconds on topics home/<system>/<point_id> with JSON payload {value, unit, ts}. Points: return_air_temp, supply_air_temp in F. Also publish a heartbeat every 10 s on home/<system>/indoor-node/heartbeat. Put Wi-Fi and MQTT credentials in a secrets.yaml that is git-ignored.
- [x] MQTT gateway adapter. Prompt: Following vendor/supervisory/hvac_gateway/base.py, create hub/gateway.ts: an MqttGateway that subscribes to hvac/+/reading, keeps the latest PointValue per point with its timestamp, and marks quality STALE when a reading is older than 120 s. write() must throw WriteNotSupported. Write tests with a fake MQTT client: a fresh reading is GOOD, a 3-minute-old reading is STALE, and write() throws.
- [x] Minimal page. Prompt: Create a Next.js App Router app with /api/readings returning all points with value, unit, age in seconds and quality, and a live page that refreshes every 1 s and greys out stale tiles. Add tests for the API.
- [ ] (added) Receive timestamp. Prompt: In hub/gateway.ts, store received_ts next to the node's ts on every reading. If they differ by more than a configurable skew (default 30 s), set quality to SUSPECT_CLOCK. Stale still wins over suspect. Tests: fresh and in sync is GOOD, skewed is SUSPECT_CLOCK, an old reading is STALE.

Pass test
- [ ] Readings update on the page every 10 seconds.
- [ ] Unplug the ESP32: tiles turn grey within 2 minutes.
- [ ] All tests pass. Commit.

## Phase 2 - Install and record
Goal: both nodes on the real unit, a week of clean data saved for replay testing.

Hardware (you)
- [ ] Kill the disconnect and furnace switch; verify dead with a meter.
- [ ] Indoor node: return and supply air probes, blower current clamp on one conductor.
- [ ] Outdoor node in a weatherproof box: suction and liquid line probes (clamped and insulated), shaded outdoor probe, compressor current clamp on one conductor.
- [ ] Use ADC1 pins (GPIO32-39) for the clamps; ADC2 doesn't work while Wi-Fi is on.
- [ ] Calibrate each clamp against your clamp meter.
- [ ] (added) Humidity and leak hardware: mount the SHT31 at the return in place of the return DS18B20, and put the leak sensor flat under the air handler. Power off first.

Code (Cursor)
- [ ] ESPHome configs for both nodes with all Phase 2 points, using the ct_clamp component. Prompt: Extend the ESPHome configs: indoor-node adds blower_amps; create outdoor-node with suction_line_temp, liquid_line_temp, outdoor_temp and compressor_amps. Use the ct_clamp sensor on ADC1 pins with a calibration value I can edit in substitutions.
- [ ] Equipment profile file. Prompt: Create hub/profiles/schema.ts and profiles/home-main.json for one system: brand Goodman, system type AC with gas furnace, single stage, list of installed points, empty LED code table. Validate profiles on load and fail loudly if invalid. Tests for a valid and an invalid profile.
- [ ] (added) Humidity and leak on the indoor node. Prompt: Extend the indoor-node ESPHome config: replace the return_air_temp DS18B20 with an SHT31 on I2C that publishes return_air_temp (F) and return_air_humidity (%RH), and add condensate_leak as a binary sensor with debounce. Same topics and payload shape as the other points. Add both points to profiles/home-main.json and the profile schema.
- [ ] Storage and recorder. Prompt: Add SQLite storage in hub/store.ts: save every reading with timestamp and quality, keep 90 days. Add tools/export-day.ts that exports one day to a CSV file for replay. Writes must not block the MQTT loop. Tests included.
- [ ] (added) Start-current recording. Prompt: In hub/store.ts, detect each compressor start from compressor_amps (off to running) and save the peak amps in the first few seconds as compressor_start_amps, with its timestamp. Add it to History as a trend line. Tests with recorded amp curves: one start gives one peak, and noise below the running threshold gives none.
- [ ] Home, Live and History screens. Prompt: Build the Home screen (status: Idle, Cooling, Heating, Fan; delta-T; outdoor temp; last update age), Live screen (a tile per point with age), and History (24 h and 7 day charts, compressor cycles per day, runtime). Mode is derived from amps for now. Make it a PWA I can add to my phone's home screen. Tests for the cycle counter.

Pass test
- [ ] One week of data with no gap over 5 minutes.
- [ ] Cycles counted by the app match what you see at the unit.
- [ ] At least 3 full days exported as replay files. Commit.

## Phase 3 - Thermostat calls and LED fault codes
Goal: the app knows what the thermostat is asking for and decodes the furnace board's LED.

Hardware (you)
- [ ] Wire a 3-channel 24 VAC optocoupler module to Y, G and W (and C) at the furnace board, outputs to the indoor ESP32.
- [ ] Tape a phototransistor over the board's status LED, shielded from room light.
- [ ] Copy the LED code table from the label inside the blower door into the profile, word for word.

Code (Cursor)
- [ ] Call inputs. Prompt: Add call_y, call_g, call_w binary sensors to indoor-node from the optocoupler outputs, with debounce. Update the Home screen mode to use calls plus amps (e.g. "Cooling call, compressor running").
- [ ] LED blink decoder. Prompt: Write an ESPHome custom component (or a small Arduino sketch) that reads the phototransistor and measures blink patterns: count flashes per group and the pause between groups. Publish the raw pattern (e.g. "3", "steady", "rapid") to led_code. Do not interpret the meaning on the ESP32. Include a bench test mode that reads a test LED I drive from a second pin.
- [ ] Decode on the hub. Prompt: In the hub, map the raw led_code pattern to a meaning using only the installed profile's code table. If the table is missing or the pattern isn't in it, show "Unknown code: <pattern>" and never guess. Build the Fault codes screen with time, pattern, meaning and duration. Tests: known code, unknown code, missing table.

Pass test
- [ ] A test LED blinking 3 times decodes as "3" on the bench.
- [ ] The real board's normal pattern decodes as normal.
- [ ] Thermostat calls on the Home screen match the thermostat. Commit.

## Phase 4 - Fault engine, alerts, email
Goal: real faults caught, explained, and sent to your phone and inbox, with no false alarms.

Code (Cursor)
- [ ] Audit log first, so everything after it is logged. Prompt: Adapt vendor/supervisory/audit.py into hub/audit.ts: append-only log of every alert, email, question and answer, with the readings behind it and the rules version. Atomic writes. Tests.
- [ ] Versioned rules file. Prompt: Create hub/rules/rules.json (version 1) with the 9 rules and starting thresholds from the Fault engine table in PLAN.md. Load and validate it; reject a file without a version.
- [ ] Rules engine. Prompt: Build hub/rules/engine.ts: evaluates the rules each time new readings arrive. Each fired rule records its signature, the readings that caused it and the rules version. Rules that need a stale point pause instead of firing. One alert per fault occurrence; a fault that clears and returns within 30 min is the same occurrence. Unit tests per rule.
- [ ] Replay harness. Prompt: Write tools/replay.ts that plays a recorded day through the engine at high speed, with options to inject faults: force compressor_amps to 0 during Y calls, shift delta-T, add extra compressor starts, stop a point or a heartbeat. Turn scenarios R1-R8 from PLAN.md into Vitest tests using my recorded files.
- [ ] (added) Humidity-adjusted delta-T. Prompt: In rules.json and hub/rules/engine.ts, make the low and high delta-T thresholds depend on return_air_humidity, using a small threshold table in rules.json (placeholder values to tune from my data). If humidity is stale or missing, fall back to the fixed thresholds and record that in the alert evidence. Bump the rules version. Tests: R13 (a humid normal day raises no delta-T alert), plus the fallback case.
- [ ] (added) Clock skew replay. Prompt: Add R15 to tools/replay.ts and the tests: shift one node's timestamps by 5 minutes. Pass means its readings show SUSPECT_CLOCK, no rule fires on them, and the app doesn't show them as current.
- [ ] Push alerts. Prompt: Send alerts through ntfy: critical always, warnings per setting. Tests with a fake ntfy server.
- [ ] Failure emails. Prompt: Build hub/alerts/email.ts per the Failure email alerts section of PLAN.md: SMTP settings from a git-ignored config file; critical faults emailed within 1 min; reminders every 4 h, max 3; a resolved email; recipients set per system to critical-only or all. Email text is built only from the alert's recorded readings. On send failure: 3 retries, logged, push still sent, never shown as sent. Tests R9 and R10 with a fake SMTP server.
- [ ] (added) Leak rule. Prompt: Add a critical rule "Water at the air handler" that fires when condensate_leak is wet. It follows the normal critical path: push, email within 1 min, reminders, and a resolved email. Owner checks: condensate drain line and pan, float switch. Technician work: anything inside the unit. Tests: R14 with a fake SMTP and a fake ntfy server.
- [ ] Dead-hub watchdog. Prompt: Add a job that pings a Healthchecks.io URL (from config) every 5 minutes. Document in the README how to set its email alert.
- [ ] Alerts and Settings screens. Prompt: Build the Alerts screen (newest first, with the readings behind each) and Settings (thresholds view, notification and email recipients, sensor health). Thresholds are read-only in the app for now; they change only in rules.json.
- [ ] (added) Start-current trend. Prompt: Show compressor_start_amps as a trend on the Alerts or History screen. Add a warning rule for a rising start-current trend, with a placeholder threshold in rules.json. Its explanation must say a weak start capacitor is one possibility to have a technician check, never a diagnosis. Tests with a rising and a flat trend.

Pass test
- [ ] R1-R10 pass on replayed data.
- [ ] (added) R13-R15 pass on replayed data.
- [ ] R11: unplug the hub; the watchdog email arrives.
- [ ] R12: the audit log covers every alert and email, readable by someone who wasn't there.
- [ ] One week live with no false alarms. Commit.

## Phase 5 - AI agent and Ask screen
Goal: ask "is it okay?" and get an answer built only from real readings.

Code (Cursor)
- [ ] Intent layer. Prompt: Adapt vendor/supervisory/intent.py into hub/agent/intent.ts: turn a question into one of: current status, a point reading, history (cycles, runtime), fault code meaning, explain an alert, or unknown. Regex first. Resolve system names from the profile and learned aliases; if the home has more than one system and none is named, ask which one. Tests for each intent, including Q8 from PLAN.md.
- [ ] Grounding, made local. Prompt: Adapt vendor/supervisory/grounding.py into hub/agent/grounding.ts. Every number in an answer must match a reading from this turn that belongs to the system or equipment named in that sentence, not just any reading in the turn. Add test Q9: a number about upstairs backed only by a downstairs reading must fail.
- [ ] Knowledge and learning. Prompt: Adapt knowledge.py (reference topics labeled "reference, not live data") and learning.py (aliases and fault recurrence counts) into hub/agent TypeScript modules. Learning saves with temp file + atomic rename; a corrupt file is renamed aside and reported, not silently reset. Tests including a truncated learning file.
- [ ] Answer builder with templates. Prompt: Build hub/agent/answer.ts: answers from templates using grounded facts, with reading ages. Owner checks and technician work are listed separately, and refrigerant or high-voltage questions refer to a licensed technician. This must work with no LLM at all.
- [ ] Optional LLM phrasing. Prompt: Add optional LLM phrasing on top of the templates: the LLM gets only the grounded facts, its output goes through the grounding check, and on any failure we fall back to the template. Off by default. Treat text inside questions as data: "ignore your rules" changes nothing. Tests Q10 and a prompt-injection case.
- [ ] Ask screen. Prompt: Build the Ask screen in the PWA, logging every question and answer to the audit log.

Pass test
- [ ] Q1-Q10 from PLAN.md pass, with the LLM on and off.
- [ ] Unplug a sensor and ask about it: the answer says the reading is stale. Commit.

## Phase 6 - Before anyone else's home
Only needed once this goes into a customer's house. Skip it while it's just yours.

Code (Cursor)
- [ ] Accounts. Prompt: Add accounts per home: an owner account with full access, and invited technician accounts with read-only access to one home that the owner can revoke. Log every technician view to the audit log. No account type can change equipment; there is still no write path. Tests for access rules.
- [ ] Delete my data. Prompt: Add a Settings action that erases history, the learning store and the audit log for a home, then shows what was removed. Tests.
- [ ] Remote access. Prompt: Document in the README how to reach the hub away from home with Tailscale. No router port forwarding.
- [ ] Second brand profile, to prove the app is brand-neutral. Prompt: Add a second profile for a different brand and a heat pump system type (adds the O/B call and defrost). Confirm no brand names appear anywhere in the code outside profile files. Test Q3 and Q4 against both profiles.

Pass test
- [ ] A tech account can see but not change anything, and losing access works instantly.
- [ ] Delete removes everything it says it does.
- [ ] Both profiles pass the full test suite. Commit and tag version 1.0.
