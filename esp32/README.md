# ESP32 firmware — water level meter with pump control (SmartFill 2.0)

Arduino sketch: `water_meter/water_meter.ino` (+ `secrets.h`).

## What it does

1. Measures the **distance to the water surface** with an HC-SR04-style
   ultrasonic sensor (median of 5 ping echoes → noise robust).
2. Computes **locally** (identical math to the server's `lib/level.ts`):
   - `water_height_cm = empty_distance − distance`
   - `percent = (empty_distance − distance) / empty_distance × 100`
   - `free_space_cm = distance`
3. Drives **local alerts with no internet required**:
   - LED1 on ≥ 25 %, LED2 on ≥ 50 %, LED3 on ≥ 75 %
   - buzzer on ≥ configurable threshold (default 90 %)
4. Controls the **pump through a relay** — locally:
   - AUTO: starts at/below the low threshold (LED 25 %), stops at the
     high threshold (buzzer %) — works with **no Wi-Fi / website down**.
   - MANUAL ON/OFF: the website only *saves a command* in Supabase
     (`device_commands`); this device polls it and applies it. The relay
     is never controlled by the website directly.
5. Safety (always enforced locally, even in MANUAL):
   - pump **defaults to OFF after reboot**;
   - invalid sensor reading → stop;
   - level ≥ high cutoff → stop (TARGET_REACHED);
   - continuous run ≥ 15 min → stop (MAX_RUNTIME);
   - MANUAL ON without a fresh command poll for 30 s → stop
     (COMMAND_EXPIRED).
6. POSTs each reading to `POST /api/readings` with the device API key,
   including the **actual** pump state: `pump_status`, `control_mode`,
   `pump_runtime_seconds` (+ `stop_reason` on the reading after a stop).
   The backend records `STARTED`/`STOPPED` in `pump_events` once per
   real transition.
7. Adopts server config from the POST response (interval, thresholds,
   empty reference, active container) plus the **current pump command**
   (`response.command`) — Settings/pump changes take effect without a
   second endpoint.
8. Also polls `GET /api/device-command?device_code=…` between readings
   (header ack via `X-Command-Updated-At`), so MANUAL commands apply
   within seconds.

## Wiring (suggested, adjust pins in the .ino if needed)

| Part | ESP32 pin | Note |
|---|---|---|
| HC-SR04 TRIG | GPIO 5 | 5 V sensor → TRIG from ESP32 works directly |
| HC-SR04 ECHO | GPIO 18 | **voltage divider required** (e.g. 10 kΩ/20 kΩ) — ECHO is 5 V, GPIO is 3.3 V |
| LEDs ×3 | GPIO 25/26/27 | 330 Ω resistors |
| Buzzer | GPIO 32 | passive buzzer + NPN transistor if loud needed |
| "Send now" button | GPIO 4 | optional; to GND, uses INPUT_PULLUP |
| Relay IN | GPIO 33 | most boards are **active LOW** (`RELAY_ACTIVE_LOW true`) |

Relay / pump safety notes:
- Verify the relay board's IN tolerates the ESP32's **3.3 V** signal.
- Power the relay coil from its specified **5 V** supply.
- Power the pump from a **separate regulated supply** at the pump's
  voltage, with adequate startup-current capacity.
- Share ground where required by the relay module design.
- **NEVER power the pump from an ESP32 GPIO.**
- Test with the pump disconnected first — an LED or a multimeter in
  place of the relay load (spec §7.9).

## Setup

1. Arduino IDE / PlatformIO, board "ESP32 Dev Module".
2. Install the **ArduinoJson v7** library.
3. `cp water_meter/secrets.h.example water_meter/secrets.h` and fill in
   Wi-Fi credentials, the server URL and the API key shown once when you
   registered the device (Devices page).
4. Flash, open the Serial Monitor at 115200 to watch measurements and
   `[PUMP] STARTED/STOPPED` transitions.

## Production hardening checklist

- Replace `client.setInsecure()` with a pinned root CA (DigiCert Global
  Root CA covers Vercel/Self-signed Supabase endpoints).
- Keep `interval_seconds` ≥ 10 to respect API rate limits.
- Deep-sleep between readings for battery-powered builds — NOT with the
  pump: deep sleep forces the relay OFF (default-off rule) and would
  break MANUAL/AUTO between wakeups.
- Temperature compensation of the speed of sound (±0.6 %/°C) if
  precision matters.
