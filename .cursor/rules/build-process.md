---
description: How to build this repo, one checklist item at a time
alwaysApply: true
---
# Build process
1. Read docs/PLAN.md and docs/CHECKLIST.md before starting any request.
2. Do exactly one checklist item per request: the one the user names. Do not start other items.
3. Match the existing code layout:
   - Next.js App Router in `app/` (Vercel), Clerk middleware, Prisma in `prisma/`
   - signed-in shell in `app/(app)/`: Home, Live, History, Codes, Alerts, Ask, Settings (later five are placeholders)
   - local MQTT collector in `collector/` + `hub/gateway.ts` (never publishes)
   - shared hub logic in `hub/` (TypeScript)
   - topics `hvac/<node>/reading`
   - Arduino firmware in `firmware/`
   Use these instead of the checklist's suggested paths (`hub/gateway/mqtt_gateway.py`, `home/<system>/<point_id>`, ESPHome YAML) and instead of a custom Next server that both serves HTTP and holds MQTT.
4. Write tests for the item and run them with `npm test` (Vitest). Only report the item done when they pass.
5. When an item is done, tick its box in docs/CHECKLIST.md and suggest a commit message that quotes the box text. Do not tick boxes unless the user asked for that checklist item.
6. Hardware boxes belong to the user. Never tick them or claim they are done.
7. Don't start the next phase until every pass-test box of the current phase is ticked.
8. If a request conflicts with .cursor/rules/safety.md or docs/PLAN.md, say so and stop.
9. Secrets: `.env.local` is gitignored. `.env.example` has placeholders. `.env.production` is committed empty. Never commit Clerk, Vercel, or database keys.
