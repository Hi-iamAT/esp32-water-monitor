import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Reading } from "@/types/database";

/**
 * CSV export — user-session protected (RLS applies; a user can only ever
 * export readings from their own devices).
 *
 * GET /api/readings/export?container_id=<uuid>&from=2026-01-01&to=2026-01-31
 */

const MAX_ROWS = 10_000;

export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(request.url);
  const containerId = url.searchParams.get("container_id");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  let query = supabase.from("readings").select("*");

  if (containerId) query = query.eq("container_id", containerId);
  if (from) query = query.gte("recorded_at", `${from}T00:00:00`);
  if (to) query = query.lte("recorded_at", `${to}T23:59:59.999`);

  const { data, error } = await query
    .order("recorded_at", { ascending: true })
    .limit(MAX_ROWS);

  if (error) {
    return new Response(`Export failed: ${error.message}`, { status: 500 });
  }

  const readings = (data ?? []) as Reading[];

  const csv = toCsv(readings);
  const stamp = new Date().toISOString().slice(0, 10);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="water-monitor-readings-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

function toCsv(rows: Reading[]): string {
  const head = [
    "id",
    "recorded_at",
    "device_id",
    "container_id",
    "distance_cm",
    "water_height_cm",
    "water_level_percent",
    "free_space_cm",
    "sensor_valid",
  ];

  const esc = (v: unknown) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const lines = [head.join(",")];
  for (const r of rows.slice(0, MAX_ROWS - 1)) {
    lines.push(
      [
        r.id,
        new Date(r.recorded_at).toISOString(),
        r.device_id,
        r.container_id,
        r.distance_cm,
        r.water_height_cm,
        r.water_level_percent,
        r.free_space_cm,
        r.sensor_valid,
      ]
        .map(esc)
        .join(","),
    );
  }
  return lines.join("\n");
}
