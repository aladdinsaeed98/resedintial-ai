# Ideas (parked)

Not started. Do not build these until the matching plan phase is open.

- Idle / Fan / Cooling / Heating from real Y/G/W calls and amps, not from
  delta-T alone. Home currently uses live return vs supply only as a color
  hint, and never shows Idle. `call_w` is not in points.json yet.
- History charts (24 h / 7 d) with large axis labels. Do not squeeze ticks.
- Alert and code count badges on the tab bar — never a stray `0`. Home
  already shows an active-alert count only when it is not zero.
- Ask-screen grounded AI, Settings thresholds, per-brand LED code tables
  (Plan phases 3–5). `config/led_codes.json` only treats 0 as normal;
  any other value is an unknown warning.
- Offline PWA cache for the shell CSS. Do not cache `/api/readings` or
  `/api/alerts`.
- Phase C: ntfy push, failure emails, healthchecks.io, audit log. The
  engine already calls an empty `notifyAlert` hook. Do not port POST
  `/api/erase`.
- Raise `call_no_compressor.after_s` from 180 to 360 if the installed
  thermostat waits ~5 minutes before starting the compressor.
- Vercel Hobby cron is a daily backstop (`0 9 * * *`). The collector ticks
  `/api/cron/rules` every 60 s; Alerts evaluates lazily. Phase C
  healthchecks.io is what should catch the collector dying.
- iOS splash screens beyond `apple-touch-icon`.
- Wrapping the PWA as a store app later.
