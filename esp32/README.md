# ESP32 firmware — portable water-level meter

Arduino sketch for the WaterMonitor project: `water_meter/water_meter.ino`.

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
4. POSTs each reading to `POST /api/readings` with the device API key.
5. Adopts server config from the POST response (interval, thresholds,
   empty reference, active container) — so Settings changes take effect on
   the device's next reading.
6. Buffers readings while offline (last 20) and flushes them after
   reconnecting.

## Wiring (suggested, adjust pins in the .ino if needed)

| Part | ESP32 pin | Note |
|---|---|---|
| HC-SR04 TRIG | GPIO 5 | 5 V sensor → TRIG from ESP32 works directly |
| HC-SR04 ECHO | GPIO 18 | **voltage divider required** (e.g. 10 kΩ/20 kΩ) — ECHO is 5 V, GPIO is 3.3 V |
| LEDs ×3 | GPIO 25/26/27 | 330 Ω resistors |
| Buzzer | GPIO 32 | passive buzzer + NPN transistor if loud needed |
| "Send now" button | GPIO 4 | optional; to GND, uses INPUT_PULLUP |

Sensor notes:
- HC-SR04 is 5 V logic; alternatively use a 3.3 V-capable sensor
  (HC-SR04 3.3 V variant or RCWL-1601) to skip the divider.
- Calibration is performed from the **Containers page** (manual entry v1):
  with the container EMPTY, measure the sensor→surface distance and enter
  it. The device picks the new reference up from the next POST response.

## Setup

1. Arduino IDE / PlatformIO, board "ESP32 Dev Module".
2. Install the **ArduinoJson v7** library.
3. `cp water_meter/secrets.h.example water_meter/secrets.h` and fill in
   Wi-Fi credentials, the server URL and the API key shown once when you
   registered the device (Devices page).
4. Flash, open the Serial Monitor at 115200 to watch measurements.

## Production hardening checklist

- Replace `client.setInsecure()` with a pinned root CA (DigiCert Global
  Root CA covers Vercel/Self-signed Supabase endpoints).
- Keep `interval_seconds` ≥ 10 to respect API rate limits.
- Deep-sleep between readings for battery-powered builds (`esp_deep_sleep`,
  wake timer = interval), buffering readings in RTC memory is optional.
- Temperature compensation of the speed of sound (±0.6 %/°C) if precision
  matters.
