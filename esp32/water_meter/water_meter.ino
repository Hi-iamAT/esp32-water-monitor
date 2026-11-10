/*
 * SmartFill 2.0 — water level meter + pump control (relay + mini pump)
 *
 * Website contract (never reverse these — safety lives HERE):
 *   1. The website NEVER controls the relay. It only saves a command in
 *      Supabase; this device polls it and applies it locally.
 *   2. AUTO keeps working with no Wi-Fi / website: thresholds are local.
 *   3. The pump defaults to OFF after every reboot.
 *   4. Safety cutoffs stop the pump ALWAYS (even in MANUAL):
 *        - invalid / implausible sensor reading   → SENSOR_INVALID
 *        - level ≥ AUTO_OFF percent ("full")       → TARGET_REACHED
 *        - continuous runtime ≥ MAX_RUNTIME        → MAX_RUNTIME
 *        - MANUAL ON without a fresh command poll  → COMMAND_EXPIRED
 *   5. Every reading includes the ACTUAL pump state:
 *        pump_status, control_mode, pump_runtime_seconds
 *      (+ stop_reason on the reading right after a stop).
 *
 * Endpoints (see secrets.h):
 *   POST /api/readings        — upload + receive config AND current command
 *   GET  /api/device-command?device_code=… — dedicated command poll
 *        (send header X-Command-Updated-At: <updated_at> to acknowledge)
 */

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

#include "secrets.h"

/* ── Pins ──────────────────────────────────────────────────── */
#define PIN_TRIG          5
#define PIN_ECHO          18
#define PIN_LED1          25
#define PIN_LED2          26
#define PIN_LED3          27
#define PIN_BUZZER        32
#define PIN_BUTTON        4   // momentary to GND, INPUT_PULLUP
#define PIN_RELAY         33

/* Most cheap relay boards are ACTIVE LOW (LOW = coil energized). */
#define RELAY_ACTIVE_LOW  true

/* ── Tuning ────────────────────────────────────────────────── */
#define MAX_RUNTIME_SECONDS   900      // absolute max continuous run (15 min)
#define MANUAL_POLL_TIMEOUT_MS  30000  // manual ON dies without a fresh command
#define COMMAND_POLL_MS        10000   // dedicated command poll period
#define SENSOR_SAMPLES         5
#define MAX_ECHO_CM_ALLOWED    450

/* ── Stop reasons (strings the server stores as-is) ────────── */
enum StopReason : uint8_t {
  NONE = 0, TARGET_REACHED, MANUAL_OFF, SENSOR_INVALID,
  MAX_RUNTIME_STOP, COMMAND_EXPIRED, DEVICE_REBOOT, SAFETY_CUTOFF
};
const char* stopReasonName(StopReason r) {
  switch (r) {
    case TARGET_REACHED:  return "TARGET_REACHED";
    case MANUAL_OFF:      return "MANUAL_OFF";
    case SENSOR_INVALID:  return "SENSOR_INVALID";
    case MAX_RUNTIME_STOP:return "MAX_RUNTIME";
    case COMMAND_EXPIRED: return "COMMAND_EXPIRED";
    case DEVICE_REBOOT:   return "DEVICE_REBOOT";
    case SAFETY_CUTOFF:   return "SAFETY_CUTOFF";
    default:              return "";
  }
}

/* ── Runtime state ─────────────────────────────────────────── */
float  emptyDistanceCm = 30.0;     // reference; adopted from server config
String activeContainerId = "";
unsigned long intervalMs = 30000;  // measurement interval (server-config)
int thresholds[4] = {25, 50, 75, 90};  // led25/led50/led75/buzzer

bool   sensorValid = false;
float  lastDistanceCm = 0, waterHeightCm = 0, percent = 0, freeSpaceCm = 0;

/* Pump */
bool pumpOn = false;               // ACTUAL relay state
String controlMode = "AUTO";       // AUTO | MANUAL (last applied command)
String cmdPump = "OFF";            // ON | OFF (last applied command)
String cmdUpdatedAt = "";          // for acknowledgement echo
unsigned long cmdPollOkMs = 0;     // millis of last successful command fetch
unsigned long runStartMs = 0;      // when the current run began
unsigned long lastRunSeconds = 0;  // runtime of the run that just stopped
unsigned long lastMeasureMs = 0;
unsigned long lastCmdPollMs = 0;
bool pendingImmediateFlush = false;   // send a reading right after a change
StopReason pendingStopReason = NONE;  // reason for the reading after a stop

/* ── Helpers ───────────────────────────────────────────────── */
void relayWrite(bool on) {
  bool level = RELAY_ACTIVE_LOW ? !on : on;
  digitalWrite(PIN_RELAY, level ? HIGH : LOW);
}

void pumpSet(bool want, StopReason reason) {
  if (want != pumpOn) {
    if (!want) {
      /* Capture the runtime of the run that just finished — the STOPPED
         transition needs it (the next reading reports pump OFF). */
      lastRunSeconds = (millis() - runStartMs) / 1000;
    }
    pumpOn = want;
    relayWrite(pumpOn);
    if (!pumpOn) {
      pendingStopReason = reason;      // attach to the immediate reading
    } else if (reason == DEVICE_REBOOT) {
      pendingStopReason = DEVICE_REBOOT; // restarted while DB said ON
    }
    pendingImmediateFlush = true;      // transition → upload immediately
    Serial.printf("[PUMP] %s (reason=%s)\n",
                  pumpOn ? "STARTED" : "STOPPED",
                  pumpOn ? "-" : stopReasonName(reason));
  }
}

float readDistanceOnce() {
  digitalWrite(PIN_TRIG, LOW);   delayMicroseconds(4);
  digitalWrite(PIN_TRIG, HIGH);  delayMicroseconds(10);
  digitalWrite(PIN_TRIG, LOW);
  unsigned long dur = pulseIn(PIN_ECHO, HIGH, 30000UL);  // µs, 30ms timeout
  if (dur == 0) return -1.0;
  return (dur * 0.0343) / 2.0;
}

/* Median of N echoes — first unlucky ping doesn't decide. */
float readDistanceCm() {
  float v[SENSOR_SAMPLES];
  uint8_t ok = 0;
  for (uint8_t i = 0; i < SENSOR_SAMPLES; i++) {
    float d = readDistanceOnce();
    if (d > 0) v[ok++] = d;
    delay(30);
  }
  if (ok == 0) return -1.0;
  for (uint8_t i = 1; i < ok; i++) {          // tiny insertion sort
    float k = v[i]; int8_t j = i - 1;
    while (j >= 0 && v[j] > k) { v[j + 1] = v[j]; j--; }
    v[j + 1] = k;
  }
  return v[ok / 2];
}

void measureLevel() {
  lastDistanceCm = readDistanceCm();
  if (lastDistanceCm < 0 || lastDistanceCm > MAX_ECHO_CM_ALLOWED) {
    sensorValid = false;
    return;
  }
  sensorValid = true;
  freeSpaceCm  = lastDistanceCm;
  waterHeightCm = constrain(emptyDistanceCm - lastDistanceCm, 0.0, emptyDistanceCm);
  percent = (emptyDistanceCm > 0.0)
            ? (waterHeightCm / emptyDistanceCm) * 100.0 : 0.0;
  percent = constrain(percent, 0.0, 100.0);
}

/* Plausibility: surface must be visible BELOW the reference plane. */
bool plausible() {
  return lastDistanceCm > 0 && lastDistanceCm <= emptyDistanceCm * 1.2;
}

/* ── Wi-Fi ─────────────────────────────────────────────────── */
void ensureWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  Serial.print("[WiFi] connecting");
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) {
    delay(400); Serial.print(".");
  }
  Serial.println(WiFi.status() == WL_CONNECTED ? " OK" : " FAILED");
}

/* ── Command application ───────────────────────────────────── */
/* mode + pump + updated_at arrive as strings; expiry is enforced
 * locally via MANUAL_POLL_TIMEOUT_MS against the last ok poll. */
void applyCommand(const String& mode, const String& pump,
                  const String& updatedAt) {
  bool modeChanged = (mode != controlMode) || (pump != cmdPump);
  controlMode = mode;
  cmdPump     = pump;
  cmdUpdatedAt= updatedAt;
  cmdPollOkMs = millis();          // server contact ok → manual timer resets
  if (modeChanged) Serial.printf("[CMD] %s + %s\n", mode.c_str(), pump.c_str());
}

bool autoControlAllowedLocally() {
  /* LOCAL auto rules evaluated on every loop (no cloud needed). */
  if (!sensorValid) { pumpSet(false, SENSOR_INVALID);        return false; }
  if (percent >= thresholds[3])   { pumpSet(false, TARGET_REACHED); return false; }
  if (pumpOn &&
      (millis() - runStartMs) >= (unsigned long)MAX_RUNTIME_SECONDS * 1000) {
    pumpSet(false, MAX_RUNTIME_STOP); return false;
  }
  return true;
}

void pumpLogic() {
  bool want = false;
  StopReason reason = MANUAL_OFF;

  if (!autoControlAllowedLocally()) return;   // forced OFF above

  if (controlMode == "AUTO") {
    /* Hysteresis: start at/below ON level, stop at OFF level. */
    want = pumpOn ? (percent <= thresholds[3]) : (percent <= thresholds[0]);
  } else { /* MANUAL */
    if (cmdPump == "ON") {
      if (millis() - cmdPollOkMs >= MANUAL_POLL_TIMEOUT_MS) {
        want = false; reason = COMMAND_EXPIRED;   // no fresh server contact
      } else {
        want = true;
      }
    } else {
      want = false; reason = MANUAL_OFF;
    }
  }
  if (want && !pumpOn) runStartMs = millis();
  pumpSet(want, reason);
}

/* ── HTTP ──────────────────────────────────────────────────── */
WiFiClientSecure tls;
HTTPClient http;

bool sendReading(bool immediate) {
  if (WiFi.status() != WL_CONNECTED) return false;

  JsonDocument doc;
  doc["device_code"] = DEVICE_CODE;
  if (activeContainerId.length()) doc["container_id"] = activeContainerId;
  doc["distance_cm"] = (float)(int)(lastDistanceCm * 10) / 10.0;
  doc["water_height_cm"] = (float)(int)(waterHeightCm * 10) / 10.0;
  doc["water_level_percent"] = (float)(int)(percent * 10) / 10.0;
  doc["free_space_cm"] = (float)(int)(freeSpaceCm * 10) / 10.0;
  doc["sensor_valid"] = sensorValid && plausible();
  doc["firmware_version"] = FIRMWARE_VERSION;
  doc["wifi_rssi"] = (long)WiFi.RSSI();
  /* Pump telemetry — actual state, never the requested command. */
  doc["pump_status"] = pumpOn;
  doc["control_mode"] = controlMode;
  /* Runtime source of truth: device-reported. On the STOP transition
     the reading carries the runtime of the run that just ended. */
  doc["pump_runtime_seconds"] = pumpOn
      ? (long)((millis() - runStartMs) / 1000)
      : (immediate ? (long)lastRunSeconds : 0L);
  if (immediate && pendingStopReason != NONE && !pumpOn) {
    doc["stop_reason"] = stopReasonName(pendingStopReason);
    pendingStopReason = NONE;
  }

  String body;
  serializeJson(doc, body);

  http.begin(tls, SERVER_URL "/api/readings");
  http.setTimeout(12000);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-API-Key", DEVICE_API_KEY);

  int code = http.POST(body);
  bool ok = (code == 200);
  if (code == 200) {
    JsonDocument resp;
    deserializeJson(resp, http.getStream());
    if (!resp["error"].isNull()) ok = false;

    /* Adopt server config. */
    if (!resp["empty_distance_cm"].isNull())
      emptyDistanceCm = resp["empty_distance_cm"].as<float>();
    if (!resp["interval_seconds"].isNull())
      intervalMs = resp["interval_seconds"].as<long>() * 1000UL;
    if (!resp["thresholds"]["led25"].isNull())
      thresholds[0] = resp["thresholds"]["led25"].as<int>();
    if (!resp["thresholds"]["led50"].isNull())
      thresholds[1] = resp["thresholds"]["led50"].as<int>();
    if (!resp["thresholds"]["led75"].isNull())
      thresholds[2] = resp["thresholds"]["led75"].as<int>();
    if (!resp["thresholds"]["buzzer"].isNull())
      thresholds[3] = resp["thresholds"]["buzzer"].as<int>();
    if (!resp["container_id"].isNull())
      activeContainerId = resp["container_id"].as<String>();

    /* Command is piggybacked on the reading response. */
    if (!resp["command"].isNull()) {
      applyCommand(resp["command"]["mode"] | String("AUTO"),
                   resp["command"]["pump"] | String("OFF"),
                   resp["command"]["updated_at"] | String(""));
    }
  } else {
    Serial.printf("[HTTP] POST readings -> %d\n", code);
  }
  http.end();
  return ok;
}

/* Dedicated command poll — acknowledges via header echo. */
void pollCommand() {
  if (WiFi.status() != WL_CONNECTED) return;
  http.begin(tls, SERVER_URL "/api/device-command?device_code=" DEVICE_CODE);
  http.setTimeout(12000);
  http.addHeader("X-API-Key", DEVICE_API_KEY);
  if (cmdUpdatedAt.length())
    http.addHeader("X-Command-Updated-At", cmdUpdatedAt.c_str());

  int code = http.GET();
  if (code == 200) {
    JsonDocument resp;
    deserializeJson(resp, http.getStream());
    applyCommand(resp["mode"] | String("AUTO"),
                 resp["pump"] | String("OFF"),
                 resp["updated_at"] | String(""));
  } else {
    Serial.printf("[HTTP] GET device-command -> %d\n", code);
  }
  http.end();
}

/* ── Local alerts (unchanged core behavior) ────────────────── */
void localAlerts() {
  digitalWrite(PIN_LED1, sensorValid && percent >= thresholds[0]);
  digitalWrite(PIN_LED2, sensorValid && percent >= thresholds[1]);
  digitalWrite(PIN_LED3, sensorValid && percent >= thresholds[2]);
  digitalWrite(PIN_BUZZER, sensorValid && percent >= thresholds[3]);
}

/* ── Setup / loop ──────────────────────────────────────────── */
void setup() {
  Serial.begin(115200);
  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);
  pinMode(PIN_LED1, OUTPUT); pinMode(PIN_LED2, OUTPUT); pinMode(PIN_LED3, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_BUTTON, INPUT_PULLUP);
  pinMode(PIN_RELAY, OUTPUT);

  /* HARD RULE: pump OFF through boot. */
  relayWrite(false);
  pumpOn = false;
  /* If a previous session left the pump ON, this stop is DEVICE_REBOOT. */
  pendingStopReason = DEVICE_REBOOT;
  pendingImmediateFlush = true;   // first reading reports the safe state

  delay(500);
  measureLevel();
}

void loop() {
  unsigned long now = millis();

  /* Measure on interval (or button press = send now). */
  if (now - lastMeasureMs >= intervalMs ||
      digitalRead(PIN_BUTTON) == LOW) {
    lastMeasureMs = now;
    measureLevel();
    localAlerts();

    pumpLogic();                          // local safety + AUTO + MANUAL

    ensureWiFi();
    bool flushNow = pendingImmediateFlush;
    bool contactOk = sendReading(flushNow);
    if (contactOk) pendingImmediateFlush = false;

    /* Dedicated poll covers the gaps between measurements. */
    if (now - lastCmdPollMs >= COMMAND_POLL_MS || !contactOk) {
      lastCmdPollMs = now;
      pollCommand();
    }
    pumpLogic();                          // apply any fresh command
  }

  /* MANUAL safety is time-based → check continuously, not per interval. */
  if (!autoControlAllowedLocally()) { /* pumpSet already handled */ }
  else pumpLogic();

  delay(50);
}
