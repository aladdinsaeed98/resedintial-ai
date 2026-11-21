---
description: Hard safety rules for this repo
alwaysApply: true
---
# Hard rules for this repo
Read docs/PLAN.md before changing anything.
1. No write path. Nothing in this repo may send a command to HVAC equipment or a thermostat. The gateway's write() raises WriteNotSupported and must stay that way. The local collector never publishes on MQTT. POST /api/ingest stores readings and returns `{ accepted }` only — it never returns a command.
2. Every number the app, an alert, an email, or the AI states must come from a real reading taken this turn, from the named system.
3. Stale (older than 2 min, from server received_at) or bad-quality readings are never shown or used as current.
4. Fault detection is deterministic rules in code, never the LLM.
5. Equipment and fault-code meanings come only from the installed equipment profile. Never assume another brand's table.
6. Every alert, email, question and answer goes in the audit log.
7. Writes to the learning store and audit log are atomic (temp file + rename that replaces the destination). A failed load is reported, never silent.
8. Every change comes with tests. Run them before saying it is done.
9. Port 1883 (Mosquitto) must never be port-forwarded. The collector talks outbound HTTPS only.
10. Writing a reading into Postgres is storage, not equipment control. Do not add a setpoint, relay, or command field that the collector would act on.
