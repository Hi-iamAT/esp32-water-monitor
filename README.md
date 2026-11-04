# WaterMonitor 💧

Live monitoring dashboard for a portable **water-level meter**:
ESP32 + ultrasonic sensor → Wi-Fi HTTP → **Next.js (Vercel)** API →
**Supabase (PostgreSQL)** → dashboard with **Supabase Realtime** updates.

See `PLAN.md` for the full architecture, schema and build roadmap, and
`esp32/README.md` for the firmware side.

## Status: Phase 2 complete (skeleton + demo data)

| Page | Route | Notes |
|---|---|---|
| Dashboard | `/dashboard` | Current %, height, free space, live container visual, device status, latest 10 readings — realtime via Supabase, polling fallback |
| Containers | `/containers` | Calibration (auto-numbering "Container N"), rename, set active, deactivate, per-container history link |
| History | `/history` | %/height/free-space charts (recharts), container + date filters, latest-10 table, CSV export |
| Devices | `/devices` | Register ESP32 (API key shown **once**), device cards, event log |
| Settings | `/settings` | Thresholds (25/50/75 LEDs, 90 buzzer), interval, account, device config |
| Login | `/login` | Supabase Auth email+password |

Until Supabase is configured the app renders **demo data** everywhere and
banner-notifies — the UI is fully explorable.

## Quick start

```bash
npm install
npm run dev        # http://localhost:3000
```

### Connect Supabase (goes live)

1. Create a project at [supabase.com](https://supabase.com).
2. SQL Editor → paste **`supabase/schema.sql`** → Run (tables, indexes,
   triggers, RLS policies, realtime publication).
3. Copy the API block from *Project Settings → API*: URL, anon key,
   service-role key.
4. `cp .env.local.example .env.local` and fill the three values
   (`SUPABASE_SERVICE_ROLE_KEY` stays server-only).
5. Restart `npm run dev` — demo mode disappears automatically.

### Test the ingest endpoint without hardware

```bash
# 1. register a device (Devices page or DB) to grab an API key, then:
curl -X POST http://localhost:3000/api/readings \
  -H "Content-Type: application/json" \
  -H "X-API-Key: wm_paste_your_device_key" \
  -d '{"device_code":"ESP32_001","distance_cm":8.6,"sensor_valid":true}'
# → { ok: true, … config ack, computed: {…} }
```

The server recomputes height/percent/free-space from the device's
calibrated `empty_distance_cm` (`lib/level.ts` — mirrored 1:1 in the
ESP32 sketch), so the dashboard and firmware can never disagree.

## Architecture highlights

- **Auth chain:** `proxy.ts` (Next 16's middleware) refreshes sessions +
  redirects optimistically → Suspense-wrapped server gates on the pages →
  **RLS** on every table as the real wall. Service-role key is used only in
  `lib/supabase/service.ts`, imported nowhere client-side.
- **Realtime:** dashboard subscribes to `readings` INSERTs + `devices`
  UPDATEs; RLS-protected channels deliver only own rows. Polling fallback
  via `router.refresh()` if the socket drops.
- **Device offline logic:** online ⇔ a reading arrived within 2× the
  configured interval; `last_seen` is only ever bumped by the ingest API,
  never by an open browser tab.
- **Events:** connect/disconnect, calibration, container switch, sensor
  errors (5 min dedupe), 90% buzzer crossings — all in `device_events`.
- **Next 16 conventions:** `cacheComponents` enabled — every page is a
  static shell streaming its session/data child inside `<Suspense>`;
  `proxy.ts` runs on the Node runtime; Turbopack for dev and build.

## Folder map

```
app/                    # App Router pages + API routes
  (app)/                #   protected group: dashboard, containers, history, devices, settings
  login/                #   auth
  api/readings/route.ts #   ESP32 ingest (X-API-Key auth)
  api/readings/export/  #   CSV export (user session)
actions.ts (app/)       # Server actions: registerDevice, calibrateContainer, …
components/             # Presentational + client islands (live dashboard, forms, charts)
lib/
  level.ts              # shared math (single source of truth)
  data.ts               # server data layer + demo fallbacks (server-only)
  view-types.ts         # shared shapes (client-safe)
  view-helpers.ts       # pure time/online helpers (client-safe)
  supabase/             # browser / server / service clients
proxy.ts                # session refresh + optimistic redirects
supabase/schema.sql     # full DB setup (paste into the SQL editor)
esp32/                  # Arduino firmware + wiring/setup docs
types/database.ts       # row types
PLAN.md                 # architecture, schema design, build phases
```

## Pending (next phases)

- Wire Settings "device-assisted calibration" (`pending_command` channel
  exists on the ingest ack).
- Rate limiting on `/api/readings`, offline-flush dedupe for buffered
  readings carrying client timestamps.
- Deploy: push to GitHub → import to Vercel → set the same three env vars.
