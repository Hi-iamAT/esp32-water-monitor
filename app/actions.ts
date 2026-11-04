"use server";

import crypto from "node:crypto";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { clamp } from "@/lib/level";
import type { Device } from "@/types/database";

/* ─────────────────────────────────────────────────────────────
 * Guards & helpers
 * ───────────────────────────────────────────────────────────── */

type Session = { supabase: SupabaseClient; userId: string; email: string };

async function requireSession(): Promise<Session> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("You must be signed in.");
  return { supabase, userId: data.user.id, email: data.user.email ?? "" };
}

/** Look up a device through the RLS-protected user client (ownership check). */
async function requireOwnedDevice(
  session: Session,
  deviceId: string,
): Promise<Device> {
  const { data } = await session.supabase
    .from("devices")
    .select("*")
    .eq("id", deviceId)
    .maybeSingle();
  const device = (data ?? null) as Device | null;
  if (!device) throw new Error("Device not found (or not yours).");
  return device;
}

function revalidateAll() {
  for (const path of [
    "/dashboard",
    "/containers",
    "/history",
    "/devices",
    "/settings",
  ]) {
    revalidatePath(path);
  }
}

async function logEvents(
  rows: Array<{
    device_id: string;
    container_id?: string | null;
    event_type: string;
    message: string;
  }>,
) {
  if (rows.length === 0) return;
  const service = createSupabaseServiceClient();
  await service.from("device_events").insert(
    rows.map((r) => ({
      device_id: r.device_id,
      container_id: r.container_id ?? null,
      event_type: r.event_type,
      message: r.message,
    })),
  );
}

/* ─────────────────────────────────────────────────────────────
 * Devices
 * ───────────────────────────────────────────────────────────── */

/**
 * Register a new ESP32. Returns the plaintext API key ONCE — only its
 * SHA-256 hash is stored. Keep the key somewhere safe afterwards.
 */
export async function registerDevice(input: {
  deviceName: string;
  deviceCode?: string;
}): Promise<{ id: string; device_code: string; api_key: string; error?: string }> {
  try {
    const session = await requireSession();
    const service = createSupabaseServiceClient();

    const deviceName = input.deviceName.trim() || "ESP32 Device";
    const code =
      input.deviceCode?.trim() ||
      `ESP32_${crypto.randomBytes(2).toString("hex").toUpperCase()}`;

    const apiKey = `wm_${crypto.randomBytes(16).toString("hex")}`;
    const apiKeyHash = crypto.createHash("sha256").update(apiKey).digest("hex");
    const apiKeyPrefix = apiKey.slice(-4);

    const { data, error } = await service
      .from("devices")
      .insert({
        user_id: session.userId,
        device_code: code,
        device_name: deviceName,
        api_key_hash: apiKeyHash,
        api_key_prefix: apiKeyPrefix,
      })
      .select("id, device_code")
      .single();

    if (error) {
      const message = (error as { code?: string }).code;
      if (message === "23505") {
        return { id: "", device_code: "", api_key: "", error: `Device code "${code}" is already registered.` };
      }
      return { id: "", device_code: "", api_key: "", error: error.message };
    }

    const row = data as { id: string; device_code: string };
    revalidateAll();
    return { id: row.id, device_code: row.device_code, api_key: apiKey };
  } catch (e) {
    return { id: "", device_code: "", api_key: "", error: errMessage(e) };
  }
}

/* ─────────────────────────────────────────────────────────────
 * Containers — calibration & management
 * ───────────────────────────────────────────────────────────── */

/**
 * Calibrate a new container: the empty reference distance (sensor → water
 * surface with the container empty) is measured by the user or the device.
 * `container_number` + name are auto-assigned by DB trigger.
 */
export async function calibrateContainer(input: {
  deviceId: string;
  emptyDistanceCm: number;
  note?: string;
}): Promise<{ id: string; container_name: string | null; error?: string }> {
  try {
    const session = await requireSession();
    const device = await requireOwnedDevice(session, input.deviceId);

    const empty = input.emptyDistanceCm;
    if (!Number.isFinite(empty) || empty <= 0 || empty > 400) {
      return { id: "", container_name: null, error: "Empty distance must be between 0 and 400 cm." };
    }

    const service = createSupabaseServiceClient();

    const inserted = await service
      .from("containers")
      .insert({ device_id: device.id, empty_distance_cm: empty })
      .select("id, container_name, container_number")
      .single();

    if (inserted.error) {
      return { id: "", container_name: null, error: inserted.error.message };
    }
    const container = inserted.data as {
      id: string;
      container_name: string;
      container_number: number;
    };

    // New calibration becomes the active measurement target; retire others.
    await service
      .from("containers")
      .update({ is_active: false })
      .eq("device_id", device.id)
      .neq("id", container.id);
    await service
      .from("containers")
      .update({ is_active: true })
      .eq("id", container.id);
    await service
      .from("devices")
      .update({ calibration_pending: false })
      .eq("id", device.id);

    await logEvents([
      {
        device_id: device.id,
        container_id: container.id,
        event_type: "calibration_completed",
        message:
          `Calibrated ${container.container_name} at ${(Math.round(empty * 10) / 10).toFixed(1)} cm reference.` +
          (input.note ? ` (${input.note})` : ""),
      },
      {
        device_id: device.id,
        container_id: container.id,
        event_type: "container_changed",
        message: `Active container switched to ${container.container_name}.`,
      },
    ]);

    revalidateAll();
    return { id: container.id, container_name: container.container_name };
  } catch (e) {
    return { id: "", container_name: null, error: errMessage(e) };
  }
}

export async function renameContainer(input: {
  containerId: string;
  name: string;
}): Promise<{ error?: string }> {
  try {
    const session = await requireSession();
    const name = input.name.trim().slice(0, 60);
    if (!name) return { error: "Name cannot be empty." };

    // RLS update policy allows this directly.
    const { error } = await session.supabase
      .from("containers")
      .update({ container_name: name })
      .eq("id", input.containerId);
    if (error) return { error: error.message };

    revalidateAll();
    return {};
  } catch (e) {
    return { error: errMessage(e) };
  }
}

/** Make this container the device's active measurement target. */
export async function setContainerActive(input: {
  containerId: string;
}): Promise<{ error?: string }> {
  try {
    const session = await requireSession();
    const { data } = await session.supabase
      .from("containers")
      .select("*")
      .eq("id", input.containerId)
      .maybeSingle();
    const container = (data ?? null) as
      | { id: string; device_id: string; container_name: string }
      | null;
    if (!container) throw new Error("Container not found (or not yours).");

    const service = createSupabaseServiceClient();
    await service
      .from("containers")
      .update({ is_active: false })
      .eq("device_id", container.device_id)
      .neq("id", container.id);
    await service
      .from("containers")
      .update({ is_active: true })
      .eq("id", container.id);

    await logEvents([
      {
        device_id: container.device_id,
        container_id: container.id,
        event_type: "container_changed",
        message: `Active container switched to ${container.container_name}.`,
      },
    ]);

    revalidateAll();
    return {};
  } catch (e) {
    return { error: errMessage(e) };
  }
}

/** Retire a container (history is kept; just no longer measurable). */
export async function retireContainer(input: {
  containerId: string;
}): Promise<{ error?: string }> {
  try {
    const session = await requireSession();
    const { error } = await session.supabase
      .from("containers")
      .update({ is_active: false })
      .eq("id", input.containerId);
    if (error) return { error: error.message };

    revalidateAll();
    return {};
  } catch (e) {
    return { error: errMessage(e) };
  }
}

/* ─────────────────────────────────────────────────────────────
 * Device configuration (Settings)
 * ───────────────────────────────────────────────────────────── */

export async function updateDeviceConfig(input: {
  deviceId: string;
  intervalSeconds: number;
  thresholdLed25: number;
  thresholdLed50: number;
  thresholdLed75: number;
  thresholdBuzzer: number;
}): Promise<{ error?: string }> {
  try {
    const session = await requireSession();
    await requireOwnedDevice(session, input.deviceId);

    const interval = Math.round(clamp(input.intervalSeconds, 5, 3600));
    const t25 = Math.round(clamp(input.thresholdLed25, 0, 100));
    const t50 = Math.round(clamp(input.thresholdLed50, 0, 100));
    const t75 = Math.round(clamp(input.thresholdLed75, 0, 100));
    const buzzer = Math.round(clamp(input.thresholdBuzzer, 0, 100));

    const { error } = await session.supabase
      .from("devices")
      .update({
        interval_seconds: interval,
        threshold_led25: t25,
        threshold_led50: t50,
        threshold_led75: t75,
        threshold_buzzer: buzzer,
      })
      .eq("id", input.deviceId);
    if (error) return { error: error.message };

    revalidateAll();
    return {};
  } catch (e) {
    return { error: errMessage(e) };
  }
}

/* ─────────────────────────────────────────────────────────────
 * Account (Settings)
 * ───────────────────────────────────────────────────────────── */

export async function updateProfile(input: {
  fullName: string;
}): Promise<{ error?: string }> {
  try {
    const session = await requireSession();
    const fullName = input.fullName.trim().slice(0, 80);

    // 1. auth user metadata (source of truth for the signup trigger)
    const { error: authError } = await session.supabase.auth.updateUser({
      data: { full_name: fullName },
    });
    if (authError) return { error: authError.message };

    // 2. public.users row (RLS update policy)
    await session.supabase
      .from("users")
      .update({ full_name: fullName })
      .eq("id", session.userId);

    revalidateAll();
    return {};
  } catch (e) {
    return { error: errMessage(e) };
  }
}

export async function changePassword(input: {
  currentPassword: string;
  newPassword: string;
}): Promise<{ error?: string }> {
  try {
    const session = await requireSession();
    if (input.newPassword.length < 8) {
      return { error: "New password must be at least 8 characters." };
    }
    if (!session.email) return { error: "No email on this account." };

    // Verify the current password first.
    const { error: verifyError } =
      await session.supabase.auth.signInWithPassword({
        email: session.email,
        password: input.currentPassword,
      });
    if (verifyError) return { error: "Current password is incorrect." };

    const { error } = await session.supabase.auth.updateUser({
      password: input.newPassword,
    });
    if (error) return { error: error.message };

    return {};
  } catch (e) {
    return { error: errMessage(e) };
  }
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong.";
}
