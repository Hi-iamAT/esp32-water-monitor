import { NextRequest } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * Save a pump command for one device. Called by the WEBSITE (signed-in
 * user) — never by the ESP32 and never by unauthenticated callers.
 *
 * Flow:  browser → this route → Supabase `device_commands`
 *        ESP32 polls GET /api/device-command and applies the command
 *        locally. The relay is controlled by the device only.
 *
 * Rules (spec):
 *  - signed-in user required; device ownership verified through RLS;
 *  - only valid combinations: AUTO+OFF, MANUAL+ON, MANUAL+OFF;
 *  - MANUAL commands carry a short expiry (30 s) — deliberate user
 *    actions (or the keep-alive below) renew it;
 *  - switching to AUTO always stores pump = 'OFF' (ignored in AUTO);
 *  - never accepts or returns any secret key;
 *  - rate-limited against rapid repeated toggling.
 */

const MANUAL_TTL_SECONDS = 30;
/** Minimum spacing between two commands for the same device. */
const MIN_COMMAND_INTERVAL_MS = 2_000;

/**
 * Simple in-memory rate limiter (per server instance — sufficient for a
 * prototype; move to a durable store if you scale horizontally).
 */
const lastCommandAt = new Map<string, number>();

export async function POST(request: NextRequest) {
  /* ── 1. Signed-in user ─────────────────────────────────── */
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ ok: false, error: "not_signed_in" }, { status: 401 });
  }

  /* ── 2. Parse & strictly validate the request ──────────── */
  let body: { device_code?: unknown; mode?: unknown; pump?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const deviceCode =
    typeof body.device_code === "string" ? body.device_code.trim() : "";
  const mode = body.mode;
  const pump = body.pump;

  const validCombination =
    (mode === "AUTO" && pump === "OFF") ||
    (mode === "MANUAL" && (pump === "ON" || pump === "OFF"));
  if (!deviceCode || !validCombination) {
    return Response.json(
      {
        ok: false,
        error: "invalid_request",
        hint: "allowed: AUTO+OFF, MANUAL+ON, MANUAL+OFF",
      },
      { status: 400 },
    );
  }

  /* ── 3. Rate limit (per device) ────────────────────────── */
  const now = Date.now();
  const previous = lastCommandAt.get(deviceCode) ?? 0;
  if (now - previous < MIN_COMMAND_INTERVAL_MS) {
    return Response.json(
      { ok: false, error: "rate_limited", retry_after_ms: MIN_COMMAND_INTERVAL_MS },
      { status: 429 },
    );
  }
  lastCommandAt.set(deviceCode, now);

  /* ── 4. Ownership — RLS-filtered (only own devices visible) ── */
  const { data: device } = await supabase
    .from("devices")
    .select("device_code")
    .eq("device_code", deviceCode)
    .maybeSingle();
  if (!device) {
    return Response.json(
      { ok: false, error: "unauthorized_device" },
      { status: 403 },
    );
  }

  /* ── 5. Upsert the command (service role, server-side only) ── */
  const updatedAt = new Date(now).toISOString();
  const expiresAt =
    mode === "MANUAL"
      ? new Date(now + MANUAL_TTL_SECONDS * 1000).toISOString()
      : null;

  try {
    const service = createSupabaseServiceClient();
    const { data, error } = await service
      .from("device_commands")
      .upsert(
        {
          device_code: deviceCode,
          mode,
          pump,
          updated_at: updatedAt,
          expires_at: expiresAt,
          updated_by: user.id,
          // New command → acknowledgement resets; UI shows "waiting for
          // device acknowledgement" until the device confirms.
          acknowledged_at: null,
        },
        { onConflict: "device_code" },
      )
      .select("mode, pump, updated_at, expires_at")
      .single();

    if (error) {
      return Response.json({ ok: false, error: "storage_failed" }, { status: 500 });
    }

    return Response.json({
      ok: true,
      device_code: deviceCode,
      mode: data.mode,
      pump: data.pump,
      updated_at: data.updated_at,
      expires_at: data.expires_at,
    });
  } catch {
    return Response.json(
      {
        ok: false,
        error: "server_not_configured",
        hint: "set SUPABASE_SERVICE_ROLE_KEY",
      },
      { status: 503 },
    );
  }
}
