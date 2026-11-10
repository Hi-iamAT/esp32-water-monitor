import { formatLastSeen } from "@/lib/view-helpers";
import type { DashboardSnapshot } from "@/lib/view-types";
import type { ControlMode, PumpEvent } from "@/types/database";
import { levelStatus } from "@/lib/level";
import { Card, Stat, EmptyState } from "@/components/Card";
import { LevelStatusChip, StatusChip } from "@/components/StatusChip";
import { WaterLevelDisplay } from "@/components/WaterLevelDisplay";
import { PumpControl } from "@/components/dashboard/PumpControl";

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

  /* ── SmartFill 2.0 pump state — ACTUAL device data only ─── */
  const actualPump: boolean | null = latestReading?.pump_status ?? null;
  const actualMode: ControlMode | null =
    actualPump !== null || latestReading?.control_mode !== undefined
      ? (latestReading?.control_mode ?? (actualPump !== null ? "AUTO" : null))
      : null;
  const autoOnPercent = Number(device.threshold_led25);
  const autoOffPercent = Number(device.threshold_buzzer);

  /* Estimated filling rate + time to target (clearly labelled estimates,
     only when enough valid readings exist and the level is rising). */
  const validReadings = recentReadings.filter((r) => r.sensor_valid);
  let fillRatePerMin: number | null = null;
  if (validReadings.length >= 2) {
    const newest = validReadings[0];
    const oldest = validReadings[validReadings.length - 1];
    const minutes =
      (new Date(newest.recorded_at).getTime() -
        new Date(oldest.recorded_at).getTime()) /
      60_000;
    if (minutes >= 1) {
      fillRatePerMin =
        (newest.water_level_percent - oldest.water_level_percent) / minutes;
    }
  }
  const rising = fillRatePerMin !== null && fillRatePerMin > 0.01;
  const etaSeconds =
    rising && percentNumber !== null && percentNumber < 100
      ? Math.round(((100 - percentNumber) / (fillRatePerMin as number)) * 60)
      : null;

  return (
    <div className="space-y-6">
      {/* Demo-mode banner */}
      {source === "mock" && (
        <p className="rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-800 ring-1 ring-inset ring-amber-600/20">
          Showing <strong>demo data</strong> — run{" "}
          <code className="font-mono">supabase/schema.sql</code> in your
          Supabase project, then add the secret key to{" "}
          <code className="font-mono">.env.local</code> to go live.
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

      {/* Pump control + activity */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card
          title="Pump control"
          subtitle="Requests only — the ESP32 owns the relay and applies commands locally"
        >
          <PumpControl
            deviceCode={device.device_code}
            deviceOnline={Boolean(device.is_online || device.online)}
            command={snap.command}
            actualMode={actualMode}
            autoOnPercent={autoOnPercent}
            autoOffPercent={autoOffPercent}
          />

          <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <PumpRow label="Pump state (actual)">
              {actualPump === null ? (
                <span className="text-slate-400 dark:text-slate-500">
                  — (needs firmware + migration)
                </span>
              ) : (
                <StatusChip variant={actualPump ? "online" : "offline"} pulse={actualPump}>
                  {actualPump ? "ON" : "OFF"}
                </StatusChip>
              )}
            </PumpRow>
            <PumpRow label="Control mode">
              {actualMode ?? (
                <span className="text-slate-400 dark:text-slate-500">—</span>
              )}
            </PumpRow>
            <PumpRow label="Current run">
              {formatDuration(latestReading?.pump_status ? (latestReading.pump_runtime_seconds ?? null) : null)}
            </PumpRow>
            <PumpRow label="Runtime today">
              {snap.todayPumpSeconds === null ? "—" : formatDuration(snap.todayPumpSeconds)}
            </PumpRow>
            <PumpRow label="Filling cycles today">
              {snap.cyclesToday === null ? "—" : snap.cyclesToday}
            </PumpRow>
            <PumpRow label="Est. fill rate">
              {fillRatePerMin === null ? (
                <span className="text-slate-400 dark:text-slate-500">not enough data</span>
              ) : (
                <span className="text-sky-700 dark:text-sky-400">
                  ≈ {fillRatePerMin.toFixed(2)} %/min
                </span>
              )}
            </PumpRow>
            <PumpRow label="Est. time to 100%">
              {etaSeconds === null ? (
                <span className="text-slate-400 dark:text-slate-500">
                  {rising ? "—" : "level not rising"}
                </span>
              ) : (
                <span className="text-sky-700 dark:text-sky-400">
                  ≈ {formatDuration(etaSeconds)} (estimate)
                </span>
              )}
            </PumpRow>
          </dl>
        </Card>

        <Card
          title="Pump activity"
          subtitle="Actual relay transitions — recorded once per real state change"
        >
          <PumpEventsTable events={snap.pumpEvents} />
        </Card>
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

const STOP_REASON_LABEL: Record<string, string> = {
  TARGET_REACHED: "target reached",
  MANUAL_OFF: "manual off",
  SENSOR_INVALID: "sensor invalid",
  MAX_RUNTIME: "max runtime",
  COMMAND_EXPIRED: "command expired",
  DEVICE_REBOOT: "device reboot",
  SAFETY_CUTOFF: "safety cutoff",
};

function PumpEventsTable({ events }: { events: PumpEvent[] }) {
  if (events.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-slate-400 dark:text-slate-500">
        No pump transitions recorded yet. Requires{" "}
        <code className="font-mono">supabase/schema-pump.sql</code> and the
        updated firmware (which reports pump status).
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 dark:border-slate-700 text-left text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">
            <th className="pb-2 pr-3 font-medium">Time</th>
            <th className="pb-2 pr-3 font-medium">Event</th>
            <th className="pb-2 pr-3 font-medium">Runtime</th>
            <th className="pb-2 font-medium">Reason</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {events.slice(0, 10).map((e) => (
            <tr key={e.id}>
              <td className="py-2 pr-3 text-slate-600 dark:text-slate-300">
                {new Date(e.occurred_at).toLocaleString([], {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </td>
              <td className="py-2 pr-3">
                <StatusChip variant={e.event_type === "STARTED" ? "online" : "offline"}>
                  {e.event_type === "STARTED" ? "Started" : "Stopped"}
                </StatusChip>
              </td>
              <td className="py-2 pr-3 text-slate-600 dark:text-slate-300">
                {e.runtime_seconds !== null ? formatDuration(e.runtime_seconds) : "—"}
              </td>
              <td className="py-2 text-slate-600 dark:text-slate-300">
                {e.stop_reason
                  ? (STOP_REASON_LABEL[e.stop_reason] ?? e.stop_reason)
                  : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PumpRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
        {label}
      </dt>
      <dd className="mt-0.5 font-semibold text-slate-900 dark:text-white">
        {children}
      </dd>
    </div>
  );
}

function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
  }
  if (m > 0) return `${m}m ${r}s`;
  return `${r}s`;
}
