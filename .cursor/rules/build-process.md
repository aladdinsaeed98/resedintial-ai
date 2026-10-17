---
description: How to build this repo, one checklist item at a time
alwaysApply: true
---
# Build process
1. Read docs/PLAN.md and docs/CHECKLIST.md before starting any request.
2. Do exactly one checklist item per request: the one the user names. Do not start other items.
3. Match the existing code layout: a flat hub/ package (hub/gateway.py, hub/models.py, ...), topics hvac/<node>/reading, and the Arduino firmware in firmware/. Use these instead of the checklist's suggested paths (hub/gateway/mqtt_gateway.py, home/<system>/<point_id>, ESPHome YAML).
4. Write tests for the item and run them with pytest. Only report the item done when they pass.
5. When an item is done, tick its box in docs/CHECKLIST.md and suggest a commit message that quotes the box text.
6. Hardware boxes belong to the user. Never tick them or claim they are done.
7. Don't start the next phase until every pass-test box of the current phase is ticked.
8. If a request conflicts with .cursor/rules/safety.md or docs/PLAN.md, say so and stop.
