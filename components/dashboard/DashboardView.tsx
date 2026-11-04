import { formatLastSeen } from "@/lib/view-helpers";
import type { DashboardSnapshot } from "@/lib/view-types";
import { levelStatus } from "@/lib/level";
import { Card, Stat, EmptyState } from "@/components/Card";
import { LevelStatusChip, StatusChip } from "@/components/StatusChip";
import { WaterLevelDisplay } from "@/components/WaterLevelDisplay";

/**
 * Presentational dashboard — same markup for live and demo data.
 * Rendered inside `DashboardLive` (client) so values update in place.
 */
export function DashboardView({
  snap,
  now,
}: {
  snap: DashboardSnapshot;
  now: Date;
}) {
  const { device, activeContainer, latestReading, recentReadings, source } =
    snap;

  if (!device) {
    return (
      <EmptyState
        title="No device registered yet"
        message="Register your ESP32 on the Devices page, calibrate a container, and readings will appear here automatically."
        action={
          <a
            href="/devices"
            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500"
          >
            Go to Devices
          </a>
        }
      />
    );
  }

  const percent = latestReading?.water_level_percent ?? null;
  const percentNumber =
    percent !== null && latestReading?.sensor_valid ? percent : null;

  return (
    <div className="space-y-6">
      {/* Demo-mode banner */}
      {source === "mock" && (
        <p className="rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-800 ring-1 ring-inset ring-amber-600/20">
          Showing <strong>demo data</strong> — create the Supabase database
          (see <code className="font-mono">supabase/schema.sql</code>) and add
          your keys to <code className="font-mono">.env.local</code> to go live.
        </p>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Water level"
          accent
          value={
            percentNumber !== null ? `${percentNumber}%` : "—"
          }
          sub={activeContainer?.container_name ?? "No active container"}
        />
        <Stat
          label="Water height"
          value={
            latestReading?.sensor_valid
              ? `${latestReading.water_height_cm} cm`
              : "—"
          }
          sub={
            activeContainer
              ? `reference ${activeContainer.empty_distance_cm} cm`
              : undefined
          }
        />
        <Stat
          label="Free space"
          value={
            latestReading?.sensor_valid ? `${latestReading.free_space_cm} cm` : "—"
          }
          sub={latestReading?.sensor_valid ? "surface → reference plane" : undefined}
        />
        <Stat
          label="Device status"
          value={
            device.is_online || device.online ? (
              <span className="text-emerald-600">Online</span>
            ) : (
              <span className="text-slate-400">Offline</span>
            )
          }
          sub={
            <>
              {device.device_code} · last seen{" "}
              {formatLastSeen(device.last_seen, now)}
            </>
          }
        />
      </div>

      {/* Visualization + recent readings */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card
          title="Water level visualization"
          subtitle={`${activeContainer?.container_name ?? "No container"} · illustrative display`}
          action={
            activeContainer && percentNumber !== null ? (
              <LevelStatusChip status={levelStatus(percentNumber)} />
            ) : (
              <StatusChip variant="offline">No data</StatusChip>
            )
          }
        >
          <WaterLevelDisplay
            percent={percentNumber ?? 0}
            containerName={activeContainer?.container_name}
            valid={latestReading?.sensor_valid ?? false}
          />
        </Card>

        <Card
          title="Latest readings"
          subtitle={
            latestReading
              ? `From ${formatClock(latestReading.recorded_at)} · newest first`
              : "Awaiting first reading"
          }
        >
          <ReadingRows readings={recentReadings.slice(0, 10)} />
        </Card>
      </div>

      <p className="px-1 text-xs text-slate-400">
        Last updated {formatClock(snap.now)} ·{" "}
        {source === "live" ? "streaming via Supabase Realtime" : "demo data"}
      </p>
    </div>
  );
}

function ReadingRows({
  readings,
}: {
  readings: DashboardSnapshot["recentReadings"];
}) {
  if (readings.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-slate-400">
        No readings yet. The device POSTs to{" "}
        <code className="font-mono">/api/readings</code>.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-slate-100">
      {readings.map((r) => (
        <li key={r.id} className="flex items-center justify-between py-2.5">
          <div className="flex items-center gap-3">
            <span className="w-20 text-sm text-slate-600">
              {formatClock(r.recorded_at)}
            </span>
            {!r.sensor_valid && (
              <StatusChip variant="error">invalid</StatusChip>
            )}
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-slate-500">
              {r.water_height_cm} cm
            </span>
            <span
              className={`w-14 text-right text-base font-semibold ${
                r.water_level_percent >= 90
                  ? "text-red-600"
                  : "text-slate-900"
              }`}
            >
              {r.water_level_percent}%
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}
