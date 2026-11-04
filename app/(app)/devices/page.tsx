import { Suspense } from "react";
import { getDevicesData } from "@/lib/data";
import { Card, EmptyState } from "@/components/Card";
import { AddDevicePanel, DeviceCard } from "@/components/devices/DevicePanels";
import type { DeviceEvent } from "@/types/database";

export const metadata = { title: "Devices" };

const EVENTS: Record<DeviceEvent["event_type"], { label: string; when: string }> = {
  device_connected: { label: "🟢 Connected", when: "green" },
  device_disconnected: { label: "🔴 Disconnected", when: "red" },
  calibration_completed: { label: "🎯 Calibration", when: "sky" },
  container_changed: { label: "🔁 Container switch", when: "sky" },
  sensor_error: { label: "⚠️ Sensor error", when: "amber" },
  water_level_90: { label: "🔔 90% warning", when: "red" },
};

export default function DevicesPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-sky-600">
          Devices
        </p>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Device management
        </h1>
      </header>

      <Suspense
        fallback={
          <div className="h-40 animate-pulse rounded-2xl bg-slate-200/70" />
        }
      >
        <DevicesContent />
      </Suspense>
    </div>
  );
}

async function DevicesContent() {
  const data = await getDevicesData();

  return (
    <div className="space-y-4">
      {data.source === "mock" && (
        <p className="rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-800 ring-1 ring-inset ring-amber-600/20">
          Demo data — connect Supabase to register your real ESP32.
        </p>
      )}

      <AddDevicePanel />

      {data.devices.length === 0 ? (
        <EmptyState
          title="No devices registered"
          message="Register your ESP32 above, then configure it to send readings to /api/readings with its API key."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {data.devices.map((d) => (
            <DeviceCard
              key={d.id}
              device={d}
              containers={(data.containersByDevice[d.id] ?? []).map((c) => ({
                id: c.id,
                container_name: c.container_name,
                is_active: c.is_active,
              }))}
              latestOnline={d.online}
            />
          ))}
        </div>
      )}

      <Card title="Recent device events" subtitle="Connectivity, calibration, alerts and errors">
        <EventLog events={data.events} />
      </Card>
    </div>
  );
}

function EventLog({ events }: { events: DeviceEvent[] }) {
  if (events.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-slate-400">
        No events yet.
      </p>
    );
  }
  return (
    <ul className="space-y-2.5">
      {events.map((ev) => {
        const meta = EVENTS[ev.event_type] ?? {
          label: (ev.event_type as string).replaceAll("_", " "),
          when: "neutral",
        };
        return (
          <li
            key={ev.id}
            className="flex items-start justify-between gap-4 rounded-xl bg-slate-50 px-3.5 py-2.5"
          >
            <div>
              <p className="text-sm font-medium text-slate-800">{meta.label}</p>
              <p className="text-xs text-slate-600">{ev.message}</p>
            </div>
            <time className="shrink-0 text-[11px] text-slate-400">
              {new Date(ev.created_at).toLocaleString([], {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </time>
          </li>
        );
      })}
    </ul>
  );
}
