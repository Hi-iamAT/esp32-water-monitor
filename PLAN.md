# Water Monitor — Project Understanding & Build Plan

> Portable water-level meter: **ESP32 + ultrasonic sensor → Wi-Fi HTTP → Next.js API (Vercel) → Supabase → live dashboard (Supabase Realtime)**

---

## 1. What we are building (one paragraph)

A monitoring web app for a portable water-level meter. The ESP32 drives an ultrasonic
sensor, computes the water level locally (also driving the 25/50/75% LEDs and the 90%
buzzer itself, so alerts work with no internet), and POSTs readings over Wi-Fi to a
Next.js API route hosted on Vercel. The API authenticates the device, re-validates the
numbers, and stores the reading in Supabase (PostgreSQL). The dashboard subscribes to
Supabase Realtime so everything on screen refreshes the moment a new reading arrives.

Five pages: **Dashboard, Containers, History & Analytics, Device Management, Settings**
(+ Login). Five tables: **users, devices, containers, readings, device_events**.

---

## 2. Architecture & data flow

```
[ Ultrasonic sensor ]  ← measures distance to the water surface
        |
[ ESP32 ]  computes height/percent/free-space locally,
        |  drives LEDs (25/50/75) + buzzer (90) offline,
        |  POSTs JSON every N seconds (configurable)
        v
[ Next.js API route  /api/readings  (Vercel, server side) ]
        - checks device_code + API key (hash compare)
        - checks the container belongs to that device
        - re-validates ranges, recomputes the numbers (authoritative)
        - inserts reading, bumps devices.last_seen / is_online,
          logs events (connected, 90 %, sensor error …)
        v
[ Supabase Postgres ]  ← RLS: a user only ever sees their own rows
        |
        |  Realtime channel on `readings` (INSERTs)
        v
[ Dashboard in the browser ]
        - instant updates via realtime subscription
        - polling fallback (30 s) in case the socket drops
```

### Core math (single source of truth — must be identical on ESP32 and server)

Calibration happens with the container **empty**:

- `empty_distance_cm` (D0) = distance from sensor to water surface when empty
  (the calibration reference — *not* necessarily the physical container height if the
  sensor sits above the rim).
- At runtime the sensor reports `d` = current sensor→surface distance.

| Quantity | Formula | Notes |
|---|---|---|
| water_height_cm | `D0 − d` | 0 when empty; equals D0 when "full" (up to reference plane) |
| water_level_percent | `clamp((D0 − d) / D0 × 100, 0, 100)` | clamp: never > 100 or < 0 |
| free_space_cm | `d` | distance from water surface **to the reference plane** (matches the example payload: d = 8.6, free = 8.6, D0 = 27, 18.4/27 = 68 %) |
| sensor_valid | `2 cm ≤ d ≤ D0 + margin` and echo not timed out | out-of-range echo → invalid reading, still stored |

The server **recomputes** these from `empty_distance_cm` and `distance_cm` and stores the
server's values as authoritative (the ESP32's own values are a sanity check, not truth).

### Device-offline rule

- Online ⇔ `now − last_seen < 2 × interval_seconds` (grace = 2 missed readings).
- **Never** mark online just because a browser tab is open.
- `last_seen`/`is_online=true` is only bumped by the ingest API when a real reading lands.
- Offline detection is computed lazily (at query/render time). The dashboard can flip
  `is_online → false` and log a "disconnected" event *only when it observes the
  transition* (guarded, no duplicates). No cron job needed in v1 (Vercel Hobby only
  allows daily cron — real per-minute crons need Pro).

---

## 3. Database design (Supabase)

### Tables per the outline

| Table | Key columns | Notes |
|---|---|---|
| `users` | id (UUID, PK), email, full_name, created_at | Auto-populated by a trigger on `auth.users` insert; `id` = Supabase Auth UID |
| `devices` | id, user_id FK, device_code (unique), device_name, api_key_hash, api_key_prefix (last 4 for UI), firmware_version, is_online, last_seen, created_at | **+ config columns** (see §4): interval_seconds, threshold_25/50/75, buzzer_percent, calibration_pending |
| `containers` | id, device_id FK, container_number (unique per device), container_name, empty_distance_cm, is_active, calibrated_at, created_at | Auto-number = `max(container_number)+1` per device. Deactivate (never delete) to keep history intact |
| `readings` | id BIGSERIAL, device_id FK, container_id FK, distance_cm, water_height_cm, water_level_percent, free_space_cm, sensor_valid, recorded_at | Keep **all** readings forever; index `(container_id, recorded_at DESC)`; dashboard queries `LIMIT 10` |
| `device_events` | id BIGSERIAL, device_id FK, container_id (nullable), event_type, message, created_at | types: device_connected, device_disconnected, calibration_completed, container_changed, sensor_error, water_level_90 |

### Row Level Security (mandatory)

- RLS **enabled on every table**.
- Select/update policy: row belongs to the caller — resolves via
  `devices.user_id = auth.uid()` (containers/readings/events join through the device).
- Frontend (browser) only ever connects with the anon key + user session → RLS applies.
- **Readings are only written by the API route using the `SUPABASE_SERVICE_ROLE_KEY`**
  (never shipped to the browser, only used in server-only code as environment variables).
- Realtime: add `readings` (and optionally `devices`) to the `supabase_realtime`
  publication. With RLS enabled, Postgres Changes respects the user's SELECT policy, so
  each browser only receives its own rows — no manual per-user filtering needed.

### Trigger sketch included in `supabase/schema.sql`

- `on_auth_user_created` → insert into `public.users`
- `fn_next_container_number(device_id)` → max+1 inside the insert
- RLS policies for all 5 tables
- Publication: `ALTER PUBLICATION supabase_realtime ADD TABLE public.readings;`

---

## 4. Device API contract

### `POST /api/readings` (device → server, keyed, no cookie auth)

```jsonc
// Request
{
  "device_code": "ESP32_001",
  "api_key": "wm_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",   // header X-API-Key preferred
  "container_id": "container-uuid",                   // omit → server picks active container
  "distance_cm": 8.6,
  "water_height_cm": 18.4,        // sanity check only; server recomputes
  "water_level_percent": 68,      // sanity check only; server recomputes
  "free_space_cm": 8.6,
  "sensor_valid": true,
  "firmware_version": "1.0.2",    // optional, self-reported
  "wifi_rssi": -62,               // optional, shown on Device page
  "mode": "reading"               // "reading" | "calibration"
}

// Response (server → device): ack + current config, so the device
// always stays in sync without a second endpoint
{
  "ok": true,
  "active_container_id": "uuid",
  "empty_distance_cm": 27.0,      // reference so ESP32 + server agree
  "interval_seconds": 30,
  "thresholds": { "led25": 25, "led50": 50, "led75": 75, "buzzer": 90 },
  "pending_command": null          // future use (e.g. start calibration)
}
```

Server-side ingest logic:
1. Hash `api_key` (SHA-256) → look up `devices` by `device_code` + hash → 401 on miss.
2. Resolve container: given `container_id` must belong to the device; otherwise the
   device's active container. 404 if none.
3. Validate `distance_cm`: numeric, in-sensor-range; outside physical range →
   `sensor_valid = false` (still stored), log `sensor_error` (throttled).
4. Recompute height/percent/free-space from `empty_distance_cm` (authoritative).
5. Insert reading with `recorded_at = now()` (server clock).
6. Update device row: `last_seen`, `is_online=true`, `firmware_version`; if it was
   offline before → log `device_connected`.
7. If percent ≥ buzzer threshold → log `water_level_90` (deduplicate per container).
8. Return config ack (§4 response).

### Device key handling

- On device registration the app generates `wm_` + 32 random hex chars,
  shows it **once** ("copy now"), stores only `sha256(key)` + last-4 prefix.
- Each ESP32 has its own credential; compromise of one device never leaks others.

---

## 5. Pages → features map

| Route | Features |
|---|---|
| `/login` | Sign-in / sign-up (Supabase Auth email+password), redirect to `/dashboard` |
| `/dashboard` | ① current % ② height cm ③ free space ④ animated container visualization ⑤ device online/offline + last-seen ⑥ last update time ⑦ latest 10 readings ⑧ current container name. Live via Realtime INSERTs; "System Online" chip derived from device status |
| `/containers` | Table/cards: ID, auto name, calibration date, empty reference, current level/percent/status; rename, view history, deactivate (old containers are flagged inactive, never deleted), calibrate new container |
| `/history` | Charts (recharts): % / height / free-space over time; timestamp of each reading; latest-10 table; filter by container + date range; **CSV export** (server route streams CSV from Supabase) |
| `/devices` | Device card(s): name, ID, connection status, Wi-Fi status (RSSI), last communication, firmware, active container, sensor status; event log (last events); "add device" generates the API key (shown once) |
| `/settings` | Rename containers • alert thresholds (25 / 50 / 75 LEDs, 90 buzzer) • measurement interval • account (name/email/password) • device configuration (interval push, config_version) |

Settings path: browser (supabase-js, RLS-protected UPDATE on the device row) →
the device picks the new config up from the ack payload on its next POST. No separate
device-admin endpoint needed. ESP32 keeps thresholds locally so LEDs/buzzer work offline.

Calibration flow (v1 — deliberately simple, per the "don't overbuild" advice):
1. User clicks **Calibrate new container** (Containers or Devices page).
2. User fills the measured `empty_distance_cm` manually (with a helper explainer), or
   triggers device-assisted calibration (`mode: "calibration"`, device reports the
   median of ~5 pings on the empty container).
3. Server assigns the next container number ("Container 3"), sets `calibrated_at`,
   activates it, logs `calibration_completed` + `container_changed`.
4. ESP32 gets the new `empty_distance_cm` + `active_container_id` in the ack.

---

## 6. Component & folder structure

```
Level_monitoring/                ← project root (this folder)
├── app/
│   ├── layout.tsx               ← root layout + sidebar shell (after login)
│   ├── page.tsx                 ← redirect → /dashboard or /login
│   ├── login/page.tsx
│   ├── dashboard/page.tsx
│   ├── containers/page.tsx
│   ├── history/page.tsx
│   ├── devices/page.tsx
│   ├── settings/page.tsx
│   └── api/
│       ├── readings/route.ts        ← ESP32 ingest (keyed)
│       ├── devices/route.ts         ← device register/list (user session)
│       └── readings/export/route.ts ← CSV download (user session)
├── components/
│   ├── Sidebar.tsx
│   ├── DashboardCards.tsx
│   ├── WaterLevelDisplay.tsx        ← animated container visual
│   ├── ReadingChart.tsx
│   ├── ReadingHistory.tsx
│   ├── ContainerCard.tsx / ContainerForm.tsx
│   ├── DeviceCard.tsx
│   └── StatusChip.tsx (online/offline, sensor ok/error)
├── lib/
│   ├── supabase-client.ts      ← browser client (anon key + session)
│   ├── supabase-server.ts      ← server component client (@supabase/ssr)
│   ├── supabase-service.ts     ← service-role client (API routes only!)
│   ├── auth.ts                 ← session helpers, middleware glue
│   ├── level.ts                ← shared math (percent/height/free-space) + validation
│   └── format.ts               ← time/number formatting
├── esp32/                      ← firmware (optional but recommended)
│   ├── water_meter/ water_meter.ino
│   ├── config.h (wifi, server URL, thresholds)
│   └── README.md (wiring, voltage divider note, calibration, OTA later)
├── supabase/
│   ├── schema.sql              ← tables + indexes + triggers + RLS + publication
│   └── seed.sql                ← demo device/container for local testing
├── types/database.ts           ← table/row TS types
├── middleware.ts               ← session refresh (@supabase/ssr)
├── .env.local.example
└── package.json
```

UI stack suggestion: **Tailwind CSS** (fast, clean for a dashboard) + **recharts**
for the history charts. Both kept minimal.

---

## 7. Security & reliability checklist

- [ ] RLS enabled on all 5 tables; every page verified against a second test user
- [ ] Service-role key only inside server-only code (`lib/supabase-service.ts`), never
      in `NEXT_PUBLIC_*` env vars, never in client bundles
- [ ] Per-device API key (random 32 bytes), stored as SHA-256 hash, shown once
- [ ] Validate every reading: number ranges, NaN rejection, clamp 0–100 %
- [ ] Server recomputation of derived values (don't trust the device's math)
- [ ] `last_seen` bumped only by real ingest; online status never inferred from
      browser presence
- [ ] Throttle `sensor_error` / `water_level_90` events (no event spam)
- [ ] HTTPS only; device payload rejected on unknown keys (strict-ish schema)
- [ ] Optional later: Upstash rate-limit on `/api/readings`, Vercel cron for offline
      sweeps (Pro plan)

---

## 8. Build phases (the outline's order, made concrete)

**Phase 0 — Foundations** ✅ *starts immediately when we scaffold*
- `create-next-app` (TypeScript, App Router), Tailwind, install
  `@supabase/supabase-js`, `@supabase/ssr`, `recharts`
- Write `supabase/schema.sql` (full DDL + RLS + triggers + publication) — user pastes it
  into the Supabase SQL editor
- `.env.local.example`, types, shared `lib/level.ts` math + unit-shape tests

**Phase 1 — Auth shell**
- Login/signup page, middleware session refresh, protected layout + Sidebar,
  auto-profile row via trigger; redirect logic

**Phase 2 — Dashboard UI with mock data**
- All six page shells with hard-coded demo data (fast feedback on layout/UX);
  `WaterLevelDisplay` animation, cards, latest-10 table

**Phase 3 — Wire real data**
- Swap mocks for Supabase queries (SSR fetch for first paint + client refresh)
- Device registration flow (generate key, show once) + container creation/
  rename/deactivate with auto-numbering

**Phase 4 — Ingest API + Realtime**
- `POST /api/readings` full logic + event handling
- Mini "sensor simulator" script (Node) that POSTs fake readings for testing before the
  ESP32 exists
- Realtime subscription on dashboard, polling fallback, online/offline transitions

**Phase 5 — History & analytics**
- Chart page with container/date filters, latest-10, CSV export route

**Phase 6 — Settings**
- Threshold + interval persistence, config ack on next device POST, account mgmt

**Phase 7 — ESP32 firmware**
- `esp32/` sketch: median-of-N pings, local LED/buzzer thresholds, calibration routine,
  HTTP client with retry/backoff, config-from-ack, read-while-offline buffering
  (flush last N readings on reconnect)
- Hardware notes: HC-SR04 is 5 V logic → level-shifter/voltage-divider on ECHO for a
  3.3 V ESP32 (or use a 3.3 V-capable sensor); temperature compensation as refinement
- Secure client TLS can start with `setInsecure()` in dev, real root-CA later

**Phase 8 — Deploy & end-to-end test**
- GitHub → Vercel, prod env vars, Supabase prod project, real-device soak test,
  second-test-user RLS audit

**Acceptance test for every phase** listed inline in the task list when we start.

---

## 9. Open decisions (asked before scaffolding)

1. Start scaffolding now vs. wait for the Supabase project to exist?
2. Tailwind CSS for styling?
3. Include the `esp32/` firmware folder + sketch in this repo?
4. Is a Supabase account/project already created?
