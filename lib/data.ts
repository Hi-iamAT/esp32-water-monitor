import "server-only";

import { connection } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Container,
  Device,
  DeviceEvent,
  Reading,
} from "@/types/database";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { deriveOnline } from "@/lib/view-helpers";
import type {
  ContainersData,
  DashboardSnapshot,
  DevicesData,
  HistoryData,
  SettingsData,
  Source,
} from "@/lib/view-types";

/* ─────────────────────────────────────────────────────────────
 * Configuration / session helpers
 * ───────────────────────────────────────────────────────────── */

export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

async function getSupabase(): Promise<SupabaseClient | null> {
  if (!isSupabaseConfigured()) return null;
  // Dynamic import keeps mock mode dependency-light and RSC-safe.
  const { createSupabaseServerClient } = await import(
    "@/lib/supabase/server"
  );
  return createSupabaseServerClient();
}

/**
 * Has schema.sql been applied yet? The REST schema cache answers
 * "table not found" (PGRST205 / 42P01) before the SQL is run — in that
 * state the data accessors keep serving demo data instead.
 */
async function schemaReady(supabase: SupabaseClient): Promise<boolean> {
  try {
    const { error } = await supabase.from("devices").select("id").limit(1);
    if (!error) return true;
    const code = (error as { code?: string }).code;
    return code !== "PGRST205" && code !== "42P01";
  } catch {
    return false;
  }
}

/** Guarantee the public.users row exists (auth trigger may have been added late). */
export async function ensureProfileRow(
  userId: string,
  email: string | null | undefined,
  metadata: unknown,
): Promise<void> {
  try {
    const supabase = await getSupabase();
    if (!supabase || !(await schemaReady(supabase))) return;

    const { data } = await supabase
      .from("users")
      .select("id")
      .eq("id", userId)
      .maybeSingle();
    if (data) return;

    // Row missing → RLS insert is not granted; use the service client.
    const meta = (metadata ?? {}) as Record<string, string | undefined>;
    const service = createSupabaseServiceClient();
    await service.from("users").upsert({
      id: userId,
      email: email ?? null,
      full_name: meta.full_name ?? "",
    });
  } catch {
    // Non-fatal: dashboard data is protected by RLS on the other tables anyway.
  }
}

/* ─────────────────────────────────────────────────────────────
 * Shared view models — shapes live in lib/view-types.ts (client-safe).
 * Pure time/online helpers live in lib/view-helpers.ts.
 * ───────────────────────────────────────────────────────────── */

export type {
  ContainersData,
  DashboardSnapshot,
  DevicesData,
  HistoryData,
  SettingsData,
  Source,
} from "@/lib/view-types";
export {
  deriveOnline,
  formatLastSeen,
  minutesAgo,
} from "@/lib/view-helpers";
export type { DeviceWithOnline } from "@/lib/view-types";

/* ─────────────────────────────────────────────────────────────
 * Public data accessors
 * ───────────────────────────────────────────────────────────── */

export async function getDashboardSnapshot(): Promise<DashboardSnapshot> {
  await connection(); // request-time data → keep out of the static shell
  const supabase = await getSupabase();
  if (!supabase) return mockDashboard();
  if (!(await schemaReady(supabase))) return mockDashboard();

  const now = new Date();

  // Most-recently-active device first; fall back to oldest created.
  const deviceRow = await supabase
    .from("devices")
    .select("*")
    .order("last_seen", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const device = (deviceRow.data ?? null) as Device | null;
  if (!device) return { ...emptySnapshot(sourceless()), device: null };

  const { data: activeContainerRow } = await supabase
    .from("containers")
    .select("*")
    .eq("device_id", device.id)
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const activeContainer = (activeContainerRow ?? null) as Container | null;

  let latestReading: Reading | null = null;
  let recentReadings: Reading[] = [];

  if (activeContainer) {
    const { data } = await supabase
      .from("readings")
      .select("*")
      .eq("container_id", activeContainer.id)
      .order("recorded_at", { ascending: false })
      .limit(10);
    recentReadings = (data ?? []) as Reading[];
    latestReading = recentReadings[0] ?? null;
  }

  return {
    source: "live",
    now: now.toISOString(),
    device: { ...device, online: deriveOnline(device, now) },
    activeContainer: activeContainer ?? null,
    latestReading,
    recentReadings,
  };
}

export async function getContainersData(): Promise<ContainersData> {
  await connection();
  const supabase = await getSupabase();
  if (!supabase) return mockContainers();
  if (!(await schemaReady(supabase))) return mockContainers();

  const [{ data: devices }, { data: containers }] = await Promise.all([
    supabase.from("devices").select("*").order("created_at"),
    supabase
      .from("containers")
      .select("*")
      .order("device_id")
      .order("container_number"),
  ]);

  const list = (containers ?? []) as Container[];

  // Latest reading per container (for current level / percent).
  const currentByContainer = new Map<string, Reading>();
  await Promise.all(
    list.map(async (c) => {
      const { data } = await supabase
        .from("readings")
        .select("*")
        .eq("container_id", c.id)
        .order("recorded_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) currentByContainer.set(c.id, data as Reading);
    }),
  );

  return {
    source: "live",
    devices: (devices ?? []) as Device[],
    containers: list.map((c) => ({
      ...c,
      current_reading: currentByContainer.get(c.id) ?? null,
    })),
  };
}

export async function getHistoryData(params: {
  containerId?: string;
  from?: string;
  to?: string;
}): Promise<HistoryData> {
  await connection();
  const supabase = await getSupabase();
  if (!supabase) return mockHistory(params);
  if (!(await schemaReady(supabase))) return mockHistory(params);

  const { data: containers } = await supabase
    .from("containers")
    .select("id, container_name, device_id")
    .order("container_name");

  let selected = params.containerId ?? null;
  if (!selected && containers && containers.length > 0) {
    // Default to the most recently calibrated active container's data
    const selectedRow = await supabase
      .from("containers")
      .select("id")
      .eq("is_active", true)
      .order("calibrated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    selected =
      ((selectedRow.data as { id: string } | null)?.id) ?? containers[0].id;
  }

  let readings: Reading[] = [];
  if (selected) {
    let query = supabase
      .from("readings")
      .select("*")
      .eq("container_id", selected)
      .order("recorded_at", { ascending: false })
      .limit(2000);
    if (params.from) query = query.gte("recorded_at", params.from);
    if (params.to) query = query.lte("recorded_at", params.to);
    const { data } = await query;
    readings = (data ?? []) as Reading[];
  }

  return {
    source: "live",
    containers: (containers ?? []) as HistoryData["containers"],
    selectedContainerId: selected,
    fromDate: params.from ?? null,
    toDate: params.to ?? null,
    readings: readings.reverse(), // oldest → newest for charting
  };
}

export async function getDevicesData(): Promise<DevicesData> {
  await connection();
  const supabase = await getSupabase();
  if (!supabase) return mockDevices();
  if (!(await schemaReady(supabase))) return mockDevices();

  const [{ data: devices }, { data: events }, { data: containers }] =
    await Promise.all([
      supabase.from("devices").select("*").order("created_at"),
      supabase
        .from("device_events")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(15),
      supabase.from("containers").select("*").order("container_number"),
    ]);

  const now = new Date();
  const containersByDevice: Record<string, Container[]> = {};
  for (const c of (containers ?? []) as Container[]) {
    (containersByDevice[c.device_id] ??= []).push(c);
  }

  return {
    source: "live",
    devices: ((devices ?? []) as Device[]).map((d) => ({
      ...d,
      online: deriveOnline(d, now),
    })),
    events: (events ?? []) as DeviceEvent[],
    containersByDevice,
  };
}

export async function getSettingsData(): Promise<SettingsData> {
  await connection();
  const supabase = await getSupabase();
  if (!supabase) return mockSettings();
  if (!(await schemaReady(supabase))) return mockSettings();

  const [{ data: profile }, { data: devices }, { data: containers }] =
    await Promise.all([
      supabase.from("users").select("id, email, full_name").maybeSingle(),
      supabase.from("devices").select("*").order("created_at"),
      supabase
        .from("containers")
        .select("*")
        .order("device_id")
        .order("container_number"),
    ]);

  return {
    source: "live",
    profile: profile ?? null,
    devices: ((devices ?? []) as Device[]).map((d) => ({
      ...d,
      online: deriveOnline(d, new Date()),
    })),
    containers: (containers ?? []) as Container[],
  };
}

/* ─────────────────────────────────────────────────────────────
 * Mock data (Supabase not configured yet)
 * ───────────────────────────────────────────────────────────── */

function sourceless() {
  return { source: "mock" as const, now: new Date().toISOString() };
}

function emptySnapshot(base: { source: Source; now: string }): DashboardSnapshot {
  return {
    ...base,
    device: null,
    activeContainer: null,
    latestReading: null,
    recentReadings: [],
  };
}

function mockDevice(now: Date): Device {
  const fiveMinAgo = new Date(now.getTime() - 5 * 60_000);
  return {
    id: "mock-device-1",
    user_id: "mock-user",
    device_code: "ESP32_001",
    device_name: "Water meter ESP32",
    api_key_hash: "mock",
    api_key_prefix: "…a1b2",
    firmware_version: "1.0.0",
    interval_seconds: 300,
    threshold_led25: 25,
    threshold_led50: 50,
    threshold_led75: 75,
    threshold_buzzer: 90,
    calibration_pending: false,
    last_wifi_rssi: -58,
    is_online: true,
    last_seen: fiveMinAgo.toISOString(),
    created_at: new Date(now.getTime() - 7 * 86_400_000).toISOString(),
  };
}

function mockContainers(): ContainersData {
  const now = new Date();
  return {
    source: "mock",
    devices: [mockDevice(now)],
    containers: [
      mockContainer(now, "mock-container-1", 1, "Container 1", 27, true),
      mockContainer(now, "mock-container-2", 2, "Container 2", 32.4, false),
      mockContainer(now, "mock-container-3", 3, "Container 3", 18.5, true),
    ],
  };
}

function mockContainer(
  now: Date,
  id: string,
  number: number,
  name: string,
  emptyDistance: number,
  active = false,
): ContainersData["containers"][number] {
  const percentByNumber = { 1: 68, 2: 43, 3: 81 };
  const reading = mockReadingFor(
    id,
    emptyDistance,
    now,
    percentByNumber[number as keyof typeof percentByNumber] ?? 50,
  );
  return {
    id,
    device_id: "mock-device-1",
    container_number: number,
    container_name: name,
    empty_distance_cm: emptyDistance,
    is_active: active,
    calibrated_at: new Date(now.getTime() - 6 * 86_400_000).toISOString(),
    created_at: new Date(now.getTime() - 6 * 86_400_000).toISOString(),
    current_reading: reading,
  };
}

function mockReadingFor(
  containerId: string,
  emptyDistance: number,
  now: Date,
  percent: number,
): Reading {
  const height = (emptyDistance * percent) / 100;
  return {
    id: Math.floor(now.getTime() / 1000) % 1000000,
    device_id: "mock-device-1",
    container_id: containerId,
    distance_cm: Math.round((emptyDistance - height) * 10) / 10,
    water_height_cm: Math.round(height * 10) / 10,
    water_level_percent: percent,
    free_space_cm: Math.round((emptyDistance - height) * 10) / 10,
    sensor_valid: true,
    recorded_at: now.toISOString(),
  };
}

function mockDashboard(): DashboardSnapshot {
  const now = new Date();
  const device = mockDevice(now);
  const active = mockContainer(now, "mock-container-1", 1, "Container 1", 27, true);

  const recentReadings: Reading[] = Array.from({ length: 10 }, (_, i) => {
    const t = new Date(now.getTime() - i * 5 * 60_000);
    const percent = [68, 65, 62, 62, 60, 59, 57, 55, 53, 52][i];
    return mockReadingFor("mock-container-1", 27, t, percent);
  });

  return {
    source: "mock",
    now: now.toISOString(),
    device: { ...device, online: deriveOnline(device, now) },
    activeContainer: active,
    latestReading: recentReadings[0],
    recentReadings,
  };
}

function mockHistory(params: { containerId?: string; from?: string; to?: string }): HistoryData {
  const now = new Date();
  const containers: HistoryData["containers"] = [
    { id: "mock-container-1", container_name: "Container 1", device_id: "mock-device-1" },
    { id: "mock-container-2", container_name: "Container 2", device_id: "mock-device-1" },
  ];
  const selected = params.containerId ?? containers[0].id;

  const readings: Reading[] = Array.from({ length: 96 }, (_, i) => {
    // 30-minute steps over the last 48 h, gentle rise then dip
    const t = new Date(now.getTime() - (95 - i) * 30 * 60_000);
    const wave = 40 + 30 * Math.sin((i / 96) * Math.PI * 1.5);
    const percent = Math.round((wave + (i % 7)) * 10) / 10;
    const height = Math.round(27 * (percent / 100) * 10) / 10;
    return {
      id: i + 1,
      device_id: "mock-device-1",
      container_id: selected,
      distance_cm: Math.round((27 - height) * 10) / 10,
      water_height_cm: height,
      water_level_percent: percent,
      free_space_cm: Math.round((27 - height) * 10) / 10,
      sensor_valid: i % 40 !== 23,
      recorded_at: t.toISOString(),
    };
  });

  return {
    source: "mock",
    containers,
    selectedContainerId: selected,
    fromDate: params.from ?? null,
    toDate: params.to ?? null,
    readings,
  };
}

function mockDevices(): DevicesData {
  const now = new Date();
  const device = mockDevice(now);
  const c = mockContainer(now, "mock-container-1", 1, "Container 1", 27, true);
  return {
    source: "mock",
    devices: [{ ...device, online: true }],
    events: [
      {
        id: 3,
        device_id: device.id,
        container_id: null,
        event_type: "device_connected",
        message: "ESP32_001 came back online.",
        created_at: new Date(now.getTime() - 5 * 60_000).toISOString(),
      },
      {
        id: 2,
        device_id: device.id,
        container_id: null,
        event_type: "calibration_completed",
        message: "Calibrated Container 1 at 27.0 cm reference.",
        created_at: new Date(now.getTime() - 6 * 86_400_000).toISOString(),
      },
      {
        id: 1,
        device_id: device.id,
        container_id: null,
        event_type: "water_level_90",
        message: "Water reached 91% in Container 1 — buzzer alerted locally.",
        created_at: new Date(now.getTime() - 3 * 86_400_000).toISOString(),
      },
    ],
    containersByDevice: { [device.id]: [c] },
  };
}

function mockSettings(): SettingsData {
  const now = new Date();
  return {
    source: "mock",
    profile: {
      id: "mock-user",
      email: "demo@watermonitor.app",
      full_name: "Demo User",
    },
    devices: [{ ...mockDevice(now), online: true }],
    containers: [
      mockContainer(now, "mock-container-1", 1, "Container 1", 27, true) as Container,
      mockContainer(now, "mock-container-2", 2, "Container 2", 32.4, false) as Container,
    ],
  };
}
