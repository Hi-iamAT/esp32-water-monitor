import crypto from "node:crypto";

import { NextRequest } from "next/server";

import { createSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * Device command polling endpoint: ESP32 → Next.js API → device_commands.
 *
 * Auth: `X-API-Key: wm_…` (or `Authorization: Bearer wm_…`), matched by
 *        SHA-256 hash against the device row. NEVER in a URL/query param.
 *        This endpoint is not for browsers.
 *
 * Contract (spec):
 *  - returns the current command for `?device_code=…`;
 *  - an expired MANUAL command degrades to a safe MANUAL/OFF (persisted
 *    once, so the device sees a stable OFF instead of toggling);
 *  - the device acknowledges by echoing `X-Command-Updated-At` of the
 *    command it has applied → sets `acknowledged_at`;
 *  - no command row yet → AUTO + OFF.
 */

type CommandPayload = {
  mode: "AUTO" | "MANUAL";
  pump: "ON" | "OFF";
  updated_at: string | null;
  expires_at: string | null;
  /** Present once the device confirmed applying this command. */
  acknowledged: boolean;
};

export async function GET(request: NextRequest) {
  const apiKey = extractApiKey(request);
  const deviceCode = request.nextUrl.searchParams.get("device_code")?.trim();
  if (!apiKey || !deviceCode) {
    return Response.json({ ok: false, error: "missing_credentials" }, { status: 401 });
  }

  const apiKeyHash = crypto
    .createHash("sha256")
    .update(apiKey)
    .digest("hex");

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json(
      { ok: false, error: "server_not_configured", hint: "set SUPABASE env vars" },
      { status: 503 },
    );
  }
  const supabase = createSupabaseServiceClient();

  /* ── 1. Authenticate the device ────────────────────────── */
  const { data: deviceRow } = await supabase
    .from("devices")
    .select("id")
    .eq("device_code", deviceCode)
    .eq("api_key_hash", apiKeyHash)
    .maybeSingle();
  if (!deviceRow) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  /* ── 2. Read the current command ───────────────────────── */
  const { data: commandRow } = await supabase
    .from("device_commands")
    .select("mode, pump, updated_at, expires_at")
    .eq("device_code", deviceCode)
    .maybeSingle();

  let command: CommandPayload = {
    mode: "AUTO",
    pump: "OFF",
    updated_at: null,
    expires_at: null,
    acknowledged: false,
  };

  if (commandRow) {
    const row = commandRow as {
      mode: "AUTO" | "MANUAL";
      pump: "ON" | "OFF";
      updated_at: string;
      expires_at: string | null;
    };

    const expired =
      row.mode === "MANUAL" &&
      row.pump === "ON" &&
      row.expires_at !== null &&
      new Date(row.expires_at).getTime() < Date.now();

    if (expired) {
      // Safe fallback: switch the stored command to MANUAL + OFF so the
      // device polls a stable OFF rather than an expired ON.
      await supabase
        .from("device_commands")
        .update({
          mode: "MANUAL",
          pump: "OFF",
          updated_at: new Date().toISOString(),
          expires_at: null,
        })
        .eq("device_code", deviceCode);
      command = {
        mode: "MANUAL",
        pump: "OFF",
        updated_at: new Date().toISOString(),
        expires_at: null,
        acknowledged: false,
      };
    } else {
      command = { ...row, acknowledged: false };
    }

    /* ── 3. Optional acknowledgement ─────────────────────── */
    // The ESP32 echoes the `updated_at` of the command it applied.
    const ack = request.headers.get("x-command-updated-at")?.trim();
    if (ack && ack === row.updated_at) {
      await supabase
        .from("device_commands")
        .update({ acknowledged_at: new Date().toISOString() })
        .eq("device_code", deviceCode);
      command = { ...command, acknowledged: true };
    }
  }

  return Response.json({
    ok: true,
    mode: command.mode,
    pump: command.pump,
    updated_at: command.updated_at,
    expires_at: command.expires_at,
    acknowledged: command.acknowledged,
  });
}

function extractApiKey(request: NextRequest): string | null {
  const header = request.headers.get("x-api-key");
  if (header) return header.trim();

  const auth = request.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  return null;
}
