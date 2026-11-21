---
description: Hard safety rules for this repo
alwaysApply: true
---
# Hard rules for this repo
Read docs/PLAN.md before changing anything.
1. No write path. Nothing in this repo may send a command to HVAC equipment or a thermostat. The gateway's write() raises WriteNotSupported and must stay that way.
2. Every number the app, an alert, an email, or the AI states must come from a real reading taken this turn, from the named system.
3. Stale (older than 2 min) or bad-quality readings are never shown or used as current.
4. Fault detection is deterministic rules in code, never the LLM.
5. Equipment and fault-code meanings come only from the installed equipment profile. Never assume another brand's table.
6. Every alert, email, question and answer goes in the audit log.
7. Writes to the learning store and audit log are atomic (temp file + rename that replaces the destination). A failed load is reported, never silent.
8. Every change comes with tests. Run them before saying it is done.
