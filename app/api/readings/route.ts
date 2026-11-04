import crypto from "node:crypto";

import { NextRequest } from "next/server";

import { createSupabaseServiceClient } from "@/lib/supabase/service";
import {
  computeLevel,
  isDistancePlausible,
  levelStatus,
} from "@/lib/level";
import type { Container, Device, Reading } from "@/types/database";

/**
 * Device ingest endpoint: ESP32 → Next.js API → Supabase.
 *
 * Auth:  `X-API-Key: wm_…` (or `Authorization: Bearer wm_…`), matched by
 *        SHA-256 hash against the device row. One credential per device.
 * Trust: the device's height/percent/free-space fields are sanity checks;
 *        the server recomputes everything from `empty_distance_cm` and is
 *        authoritative.
 *
 * The response doubles as a config channel — the device adopts the
 * returned interval/thresholds/reference so Settings take effect on the
 * next request without a second endpoint.
 */

type Payload = {
  device_code?: string;
  container_id?: string;
  distance_cm?: number | string;
  water_height_cm?: number | string;
  water_level_percent?: number | string;
  free_space_cm?: number | string;
  sensor_valid?: boolean;
  firmware_version?: string;
  wifi_rssi?: number;
  mode?: "reading" | "calibration";
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-api-key, authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: object, status = 200) {
  return Response.json(body, { status, headers: CORS });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function POST(request: NextRequest) {
  let body: Payload;
  try {
    body = (await request.json()) as Payload;
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  /* ── 1. Authentication ─────────────────────────────────── */
  const apiKey = extractApiKey(request);
  if (!apiKey || !body.device_code) {
    return json({ ok: false, error: "missing_credentials" }, 401);
  }

  const apiKeyHash = crypto
    .createHash("sha256")
    .update(apiKey)
    .digest("hex");

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return json(
      { ok: false, error: "server_not_configured", hint: "set SUPABASE env vars" },
      503,
    );
  }
  const supabase = createSupabaseServiceClient();

  const deviceRow = await supabase
    .from("devices")
    .select("*")
    .eq("device_code", body.device_code)
    .eq("api_key_hash", apiKeyHash)
    .maybeSingle();
  const device = (deviceRow.data ?? null) as Device | null;

  if (!device) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  /* ── 2. Resolve container (must belong to this device) ─── */
  let container: Container | null = null;
  if (body.container_id) {
    const containerRow = await supabase
      .from("containers")
      .select("*")
      .eq("id", body.container_id)
      .eq("device_id", device.id)
      .maybeSingle();
    container = (containerRow.data ?? null) as Container | null;
  } else {
    const activeRow = await supabase
      .from("containers")
      .select("*")
      .eq("device_id", device.id)
      .eq("is_active", true)
      .order("calibrated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    container = (activeRow.data ?? null) as Container | null;
  }

  if (!container) {
    return json(
      { ok: false, error: "no_container", hint: "calibrate a container or send container_id" },
      404,
    );
  }

  /* ── 3. Validate & recompute (server is authoritative) ─── */
  const distance = toNumber(body.distance_cm);
  if (distance === null) {
    return json({ ok: false, error: "invalid_distance" }, 400);
  }

  const emptyDistance = Number(container.empty_distance_cm);
  const plausible = isDistancePlausible(distance, emptyDistance);
  const level = computeLevel(distance, emptyDistance);

  // Reduced validity: ESP32's own sensor_valid + physical plausibility.
  const sensorValid = (body.sensor_valid ?? true) && plausible;

  /* ── 4. Threshold-crossing bookkeeping (before insert) ─── */
  const prevReadingRow = await supabase
    .from("readings")
    .select("water_level_percent, sensor_valid")
    .eq("container_id", container.id)
    .order("recorded_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const previous = (prevReadingRow.data ?? null) as
    | Pick<Reading, "water_level_percent" | "sensor_valid">
    | null;

  const threshold = Number(device.threshold_buzzer);
  const crossed90 =
    sensorValid &&
    level.waterLevelPercent >= threshold &&
    (previous == null || previous.water_level_percent < threshold);

  /* ── 5. Insert the reading ─────────────────────────────── */
  const reading: Reading = {
    id: 0,
    device_id: device.id,
    container_id: container.id,
    distance_cm: level.distanceCm,
    water_height_cm: level.waterHeightCm,
    water_level_percent: level.waterLevelPercent,
    free_space_cm: level.freeSpaceCm,
    sensor_valid: sensorValid,
    recorded_at: new Date().toISOString(),
  };

  const insertResult = await supabase
    .from("readings")
    .insert({
      device_id: reading.device_id,
      container_id: reading.container_id,
      distance_cm: reading.distance_cm,
      water_height_cm: reading.water_height_cm,
      water_level_percent: reading.water_level_percent,
      free_space_cm: reading.free_space_cm,
      sensor_valid: reading.sensor_valid,
    });
  if (insertResult.error) {
    return json({ ok: false, error: "storage_failed" }, 500);
  }

  /* ── 6. Device heartbeat + events ──────────────────────── */
  const wasOnline = device.is_online && deriveRecentlyOnline(device);

  await supabase
    .from("devices")
    .update({
      last_seen: reading.recorded_at,
      is_online: true,
      ...(device.firmware_version !== body.firmware_version && body.firmware_version
        ? { firmware_version: body.firmware_version }
        : {}),
      ...(typeof body.wifi_rssi === "number"
        ? { last_wifi_rssi: Math.round(body.wifi_rssi) }
        : {}),
    })
    .eq("id", device.id);

  const events: Array<Record<string, unknown>> = [];

  if (!wasOnline) {
    events.push({
      device_id: device.id,
      event_type: "device_connected",
      message:
        device.last_seen
          ? `${device.device_code} came back online.`
          : `${device.device_code} is online for the first time.`,
    });
  }

  if (!sensorValid) {
    // Throttled: at most one sensor_error event per 5 minutes per device.
    const recent = await supabase
      .from("device_events")
      .select("id")
      .eq("device_id", device.id)
      .eq("event_type", "sensor_error")
      .gte(
        "created_at",
        new Date(Date.now() - 5 * 60_000).toISOString(),
      )
      .limit(1);
    if (!recent.data || recent.data.length === 0) {
      events.push({
        device_id: device.id,
        container_id: container.id,
        event_type: "sensor_error",
        message: `Invalid reading (distance ${body.distance_cm} cm, reference ${emptyDistance} cm).`,
      });
    }
  }

  if (crossed90) {
    events.push({
      device_id: device.id,
      container_id: container.id,
      event_type: "water_level_90",
      message: `Water reached ${level.waterLevelPercent}% in ${container.container_name} — buzzer alerted locally.`,
    });
  }

  if (events.length > 0) {
    await supabase.from("device_events").insert(events);
  }

  /* ── 7. Config ack (response = config channel) ─────────── */
  return json({
    ok: true,
    container_id: container.id,
    container_name: container.container_name,
    empty_distance_cm: emptyDistance,
    interval_seconds: device.interval_seconds,
    thresholds: {
      led25: Number(device.threshold_led25),
      led50: Number(device.threshold_led50),
      led75: Number(device.threshold_led75),
      buzzer: threshold,
    },
    computed: {
      water_height_cm: level.waterHeightCm,
      water_level_percent: level.waterLevelPercent,
      free_space_cm: level.freeSpaceCm,
      status: levelStatus(level.waterLevelPercent),
    },
    pending_command: null as string | null,
  });
}

/* ── helpers ───────────────────────────────────────────────── */

function extractApiKey(request: NextRequest): string | null {
  const header = request.headers.get("x-api-key");
  if (header) return header.trim();

  const auth = request.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  return null;
}

function toNumber(v: number | string | undefined): number | null {
  if (v === undefined || v === null) return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

/** `is_online` alone is not enough — the grace window double-checks it. */
function deriveRecentlyOnline(device: Device): boolean {
  if (!device.last_seen) return false;
  const ageMs = Date.now() - new Date(device.last_seen).getTime();
  return ageMs <= Math.max(60, device.interval_seconds * 2) * 1000;
}
