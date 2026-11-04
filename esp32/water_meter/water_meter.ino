/**
 * WaterMonitor — ESP32 + HC-SR04 ultrasonic water-level meter
 *
 * Measures the distance to the water surface, computes the level locally
 * (LEDs at 25/50/75 %, buzzer at the configured threshold — works even
 * without internet), and POSTs every reading to the Next.js API:
 *
 *   POST {SERVER_URL}/api/readings
 *   X-API-Key: wm_……
 *   { device_code, container_id?, distance_cm, … }
 *
 * The server response doubles as the config channel:
 *   { interval_seconds, thresholds, empty_distance_cm, container_id, … }
 * so settings changed in the web app adopt automatically on the next POST.
 *
 * Required library: ArduinoJson v7 (Library Manager or PlatformIO).
 *
 * See esp32/README.md for wiring and setup.
 */

#include <ArduinoJson.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>

#include "secrets.h"  // copy secrets.h.example → secrets.h and fill in

// ── Pins (adjust to your wiring) ────────────────────────────────
const int PIN_TRIG      = 5;
const int PIN_ECHO      = 18;  // via voltage divider! 5 V echo → 3.3 V GPIO
const int PIN_LED_75    = 27;  // level ≥ 75 %
const int PIN_LED_50    = 26;  // level ≥ 50 %
const int PIN_LED_25    = 25;  // level ≥ 25 %
const int PIN_BUZZER    = 32;  // level ≥ buzzer threshold (default 90 %)
const int PIN_SEND_BTN  = 4;   // optional: force a POST now

// ── Sensor limits (mirror lib/level.ts on the server) ───────────
const float SENSOR_MIN_CM = 2.0;
const float SENSOR_MAX_CM = 400.0;

// ── Remote config (adopted from every server response) ──────────
struct Config {
  String  containerId   = "";    // empty → server uses its active container
  float   emptyDistance = 27.0;  // calibration reference (D0), cm
  uint32_t intervalSec  = 300;   // measurement interval
  float   led25 = 25, led50 = 50, led75 = 75, buzzer = 90;
};
Config cfg;

// ── Offline buffer (flush after reconnect) ──────────────────────
const size_t BUFFER_CAP = 20;
float   distanceBuffer[BUFFER_CAP];
size_t  bufferCount = 0;

uint32_t lastPostMs = 0;
bool      wifiOk    = false;

// ── Setup ───────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  Serial.println("\n=== WaterMonitor ESP32 ===");

  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);
  pinMode(PIN_LED_25, OUTPUT);
  pinMode(PIN_LED_50, OUTPUT);
  pinMode(PIN_LED_75, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_SEND_BTN, INPUT_PULLUP);

  digitalWrite(PIN_LED_25, LOW);
  digitalWrite(PIN_LED_50, LOW);
  digitalWrite(PIN_LED_75, LOW);
  digitalWrite(PIN_BUZZER, LOW);

  connectWifi();
}

// ── Wi-Fi ───────────────────────────────────────────────────────
void connectWifi() {
  Serial.printf("Connecting to Wi-Fi '%s'", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) {
    delay(500);
    Serial.print(".");
  }
  wifiOk = WiFi.status() == WL_CONNECTED;
  Serial.println(wifiOk ? " connected." : " FAILED (will keep trying).");
  if (wifiOk) Serial.printf("IP: %s\n", WiFi.localIP().toString().c_str());
}

// ── Ultrasonic measurement (median of 5 pings) ──────────────────
float measureDistanceCm() {
  const int N = 5;
  float samples[N];

  for (int i = 0; i < N; i++) {
    digitalWrite(PIN_TRIG, LOW);
    delayMicroseconds(4);
    digitalWrite(PIN_TRIG, HIGH);
    delayMicroseconds(10);
    digitalWrite(PIN_TRIG, LOW);

    const unsigned long timeoutUs = 24000UL;  // ~4 m round trip
    unsigned long duration = pulseIn(PIN_ECHO, HIGH, timeoutUs);
    samples[i] = duration == 0 ? -1.0f : (duration * 0.0343f) / 2.0f;

    // temperature-compensated speed: 331.3 + 0.606·°C (m/s) → divide by 2 ×100
    // (0.0343 cm/µs assumes 20 °C; refine with a temperature reading later)

    delay(60);  // avoid echo shadowing between pings
  }

  // Median of the valid samples
  float valid[N];
  int n = 0;
  for (int i = 0; i < N; i++)
    if (samples[i] > 0) valid[n++] = samples[i];
  if (n == 0) return -1.0f;

  // insertion sort (tiny n)
  for (int a = 1; a < n; a++) {
    float key = valid[a];
    int b = a - 1;
    while (b >= 0 && valid[b] > key) { valid[b + 1] = valid[b]; b--; }
    valid[b + 1] = key;
  }
  return valid[n / 2];
}

// ── Level math (identical to the server's lib/level.ts) ─────────
struct Level {
  float heightCm, percent, freeSpaceCm;
  bool  valid;
};

Level computeLevel(float distanceCm, float emptyCm) {
  Level l{0, 0, 0, false};
  l.freeSpaceCm = distanceCm;
  if (distanceCm <= 0 || emptyCm <= 0) return l;                 // echo failed
  if (distanceCm < SENSOR_MIN_CM) return l;                      // too close
  if (distanceCm > max(SENSOR_MAX_CM, emptyCm * 1.2f)) return l; // out of range

  l.heightCm  = max(0.0f, emptyCm - distanceCm);
  l.percent   = constrain((l.heightCm / emptyCm) * 100.0f, 0.0f, 100.0f);
  l.valid     = true;
  return l;
}

// ── Local alarms (work with zero connectivity) ──────────────────
void updateLocalAlarms(float percent) {
  digitalWrite(PIN_LED_25, percent >= cfg.led25 ? HIGH : LOW);
  digitalWrite(PIN_LED_50, percent >= cfg.led50 ? HIGH : LOW);
  digitalWrite(PIN_LED_75, percent >= cfg.led75 ? HIGH : LOW);
  digitalWrite(PIN_BUZZER, percent >= cfg.buzzer ? HIGH : LOW);
}

// ── HTTP POST /api/readings ─────────────────────────────────────
bool postReading(float distanceCm, const Level& lvl) {
  WiFiClientSecure client;
  client.setInsecure();  // DEV ONLY — pin the Vercel root CA for production

  HTTPClient http;
  if (!http.begin(client, SERVER_URL "/api/readings")) return false;

  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-API-Key", DEVICE_API_KEY);

  JsonDocument doc;
  doc["device_code"]        = DEVICE_CODE;
  if (cfg.containerId.length()) doc["container_id"] = cfg.containerId;
  doc["distance_cm"]        = distanceCm;
  doc["water_height_cm"]    = lvl.heightCm;
  doc["water_level_percent"] = lvl.percent;
  doc["free_space_cm"]      = lvl.freeSpaceCm;
  doc["sensor_valid"]       = lvl.valid;
  doc["firmware_version"]   = "1.0.0";
  doc["wifi_rssi"]          = WiFi.RSSI();
  doc["mode"]               = "reading";

  String body;
  serializeJson(doc, body);

  const int code = http.POST(body);

  bool ok = false;
  if (code == 200) {
    ok = true;
    JsonDocument resp;
    if (!deserializeJson(resp, http.getString())) {
      if (resp["ok"] == true) {
        // Adopt the server config (see note in esp32/README.md).
        if (resp["empty_distance_cm"].is<float>())
          cfg.emptyDistance = resp["empty_distance_cm"];
        if (resp["interval_seconds"].is<int>())
          cfg.intervalSec   = resp["interval_seconds"];
        if (resp["container_id"].is<String>())
          cfg.containerId   = resp["container_id"].as<String>();
        if (resp["thresholds"]["led25"].is<float>())  cfg.led25  = resp["thresholds"]["led25"];
        if (resp["thresholds"]["led50"].is<float>())  cfg.led50  = resp["thresholds"]["led50"];
        if (resp["thresholds"]["led75"].is<float>())  cfg.led75  = resp["thresholds"]["led75"];
        if (resp["thresholds"]["buzzer"].is<float>()) cfg.buzzer = resp["thresholds"]["buzzer"];

        Serial.printf("[cfg] interval=%us ref=%.1fcm buzzer=%.0f%%\n",
                      cfg.intervalSec, cfg.emptyDistance, cfg.buzzer);
      }
    }
  } else {
    Serial.printf("[post] HTTP %d\n", code);
  }

  http.end();
  return ok;
}

// ── Buffering while offline ─────────────────────────────────────
void bufferReading(float distanceCm) {
  if (bufferCount < BUFFER_CAP) {
    distanceBuffer[bufferCount++] = distanceCm;
  } else {
    // drop oldest, keep newest
    for (size_t i = 1; i < BUFFER_CAP; i++)
      distanceBuffer[i - 1] = distanceBuffer[i];
    distanceBuffer[BUFFER_CAP - 1] = distanceCm;
  }
}

void flushBuffer() {
  Serial.printf("[flush] sending %u buffered readings\n", bufferCount);
  while (bufferCount > 0) {
    float d = distanceBuffer[0];
    for (size_t i = 1; i < bufferCount; i++)
      distanceBuffer[i - 1] = distanceBuffer[i];
    bufferCount--;

    Level lvl = computeLevel(d, cfg.emptyDistance);
    if (!postReading(d, lvl)) {      // reconnect dropped again
      // put it back at the head
      for (size_t i = bufferCount; i > 0; i--)
        distanceBuffer[i] = distanceBuffer[i - 1];
      distanceBuffer[0] = d;
      bufferCount++;
      return;
    }
    delay(250);                      // gentle on the API
  }
}

// ── Loop ────────────────────────────────────────────────────────
void loop() {
  const uint32_t now = millis();

  static int btnPrev = HIGH;
  int btnNow = digitalRead(PIN_SEND_BTN);
  bool forceSend = (btnPrev == HIGH && btnNow == LOW);
  btnPrev = btnNow;

  if (WiFi.status() != WL_CONNECTED) {
    if (!wifiOk || now % 30000 < 10) connectWifi();
    delay(1000);
  }

  if (forceSend || now - lastPostMs >= cfg.intervalSec * 1000UL) {
    lastPostMs = now;

    float distance = measureDistanceCm();
    Level lvl = computeLevel(distance, cfg.emptyDistance);

    if (lvl.valid) {
      updateLocalAlarms(lvl.percent);
      Serial.printf("[read] d=%.1fcm h=%.1fcm %%.=%.0f%%\n",
                    distance, lvl.heightCm, lvl.percent);
    } else {
      Serial.printf("[read] INVALID (d=%.1fcm, ref=%.1fcm)\n", distance, cfg.emptyDistance);
      updateLocalAlarms(0);
    }

    if (WiFi.status() == WL_CONNECTED) {
      if (bufferCount > 0) flushBuffer();
      if (!postReading(distance, lvl)) {
        bufferReading(distance);
      }
    } else {
      bufferReading(distance);
    }
  }

  delay(50);
}
