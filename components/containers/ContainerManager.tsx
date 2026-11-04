"use client";

import { useState, useTransition } from "react";
import {
  calibrateContainer,
  renameContainer,
  retireContainer,
  setContainerActive,
} from "@/app/actions";
import type { Device } from "@/types/database";
import type { ContainersData } from "@/lib/view-types";
import { levelStatus } from "@/lib/level";
import { StatusChip, LevelStatusChip } from "@/components/StatusChip";

export function ContainerManager({
  devices,
  containers,
  source,
}: {
  devices: ContainersData["devices"];
  containers: ContainersData["containers"];
  source: "live" | "mock";
}) {
  return (
    <div className="space-y-6">
      {source === "mock" && (
        <p className="rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-800 ring-1 ring-inset ring-amber-600/20">
          Demo data — changes are not persisted until Supabase is configured.
        </p>
      )}
      <CalibrateForm devices={devices} />
      <ContainerGrid containers={containers} />
    </div>
  );
}

/* ── Calibration ──────────────────────────────────────────── */

function CalibrateForm({ devices }: { devices: Device[] }) {
  const [pending, startTransition] = useTransition();
  const [deviceId, setDeviceId] = useState(devices[0]?.id ?? "");
  const [distance, setDistance] = useState("");
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  if (devices.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
        Register a device first (Devices page), then calibrate containers here.
      </div>
    );
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">
        Calibrate a new container
      </h2>
      <p className="mt-1 max-w-xl text-xs text-slate-500">
        With the container <strong>empty</strong>, measure the distance from the
        ultrasonic sensor to the water surface. That reference (D0) defines 0%
        — 100% is the same plane from the other side.
      </p>

      <form
        className="mt-4 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const value = parseFloat(distance);
          setFeedback(null);
          startTransition(async () => {
            const res = await calibrateContainer({
              deviceId,
              emptyDistanceCm: value,
            });
            if (res.error) {
              setFeedback({ ok: false, text: res.error });
            } else {
              setFeedback({
                ok: true,
                text: `Saved — assigned "${res.container_name}" and set it active.`,
              });
              setDistance("");
            }
          });
        }}
      >
        {devices.length > 1 && (
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">
              Device
            </label>
            <select
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.device_name} ({d.device_code})
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">
            Empty-reference distance (cm)
          </label>
          <input
            type="number"
            step="0.1"
            min="0.1"
            max="400"
            required
            value={distance}
            onChange={(e) => setDistance(e.target.value)}
            placeholder="e.g. 27.0"
            className="w-44 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-60"
        >
          {pending ? "Saving…" : "Calibrate container"}
        </button>
      </form>

      {feedback && (
        <p
          className={`mt-3 rounded-lg px-3 py-2 text-sm ${
            feedback.ok
              ? "bg-emerald-50 text-emerald-700"
              : "bg-red-50 text-red-600"
          }`}
        >
          {feedback.text}
        </p>
      )}
    </section>
  );
}

/* ── Container cards ──────────────────────────────────────── */

function ContainerGrid({
  containers,
}: {
  containers: ContainersData["containers"];
}) {
  if (containers.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
        No containers calibrated yet.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {containers.map((c) => (
        <ContainerCard key={c.id} container={c} />
      ))}
    </div>
  );
}

function ContainerCard({
  container: c,
}: {
  container: ContainersData["containers"][number];
}) {
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(c.container_name);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const current = c.current_reading;
  const percent = current?.sensor_valid ? current.water_level_percent : null;
  const status = percent !== null ? levelStatus(percent) : null;

  function saveName() {
    startTransition(async () => {
      const res = await renameContainer({
        containerId: c.id,
        name: draftName,
      });
      if (res.error) setError(res.error);
      else {
        setError(null);
        setEditing(false);
      }
    });
  }

  return (
    <article
      className={`rounded-2xl border bg-white p-5 shadow-sm ${
        c.is_active ? "border-sky-300 ring-1 ring-sky-200" : "border-slate-200"
      } ${!c.is_active ? "opacity-80" : ""}`}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {editing ? (
            <div className="flex items-center gap-2">
              <input
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                maxLength={60}
                className="w-40 rounded-lg border border-slate-300 px-2 py-1 text-sm"
                autoFocus
              />
              <button
                onClick={saveName}
                disabled={pending}
                className="rounded-lg bg-emerald-600 px-2 py-1 text-xs font-semibold text-white hover:bg-emerald-500"
              >
                Save
              </button>
              <button
                onClick={() => {
                  setEditing(false);
                  setDraftName(c.container_name);
                  setError(null);
                }}
                className="rounded-lg bg-slate-200 px-2 py-1 text-xs font-medium text-slate-700"
              >
                ✕
              </button>
            </div>
          ) : (
            <h3 className="truncate text-base font-semibold text-slate-900">
              {c.container_name}
            </h3>
          )}
          <p className="mt-0.5 text-xs text-slate-500">
            #{c.container_number} · calibrated{" "}
            {new Date(c.calibrated_at).toLocaleDateString()} · ref{" "}
            {c.empty_distance_cm} cm
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {c.is_active ? (
            <StatusChip variant="online">Active</StatusChip>
          ) : (
            <StatusChip variant="neutral">Inactive</StatusChip>
          )}
        </div>
      </header>

      <div className="mt-4 flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
        <div>
          <p className="text-2xl font-bold text-slate-900">
            {percent !== null ? `${percent}%` : "—"}
          </p>
          <p className="text-xs text-slate-500">
            {current
              ? `${current.water_height_cm} cm water · ${current.free_space_cm} cm free`
              : "No readings yet"}
          </p>
        </div>
        {status && <LevelStatusChip status={status} />}
      </div>

      <footer className="mt-4 flex flex-wrap items-center gap-2">
        {!editing && (
          <button
            onClick={() => setEditing(true)}
            className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-400"
          >
            Rename
          </button>
        )}
        {!c.is_active && (
          <button
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await setContainerActive({ containerId: c.id });
                if (res.error) setError(res.error);
              })
            }
            className="rounded-lg border border-sky-300 bg-sky-50 px-2.5 py-1.5 text-xs font-medium text-sky-700 hover:bg-sky-100"
          >
            Set active
          </button>
        )}
        {c.is_active && (
          <button
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await retireContainer({ containerId: c.id });
                if (res.error) setError(res.error);
              })
            }
            className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-400"
          >
            Deactivate
          </button>
        )}
        <a
          href={`/history?container=${c.id}`}
          className="ml-auto rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
        >
          View history →
        </a>
      </footer>

      {error && (
        <p className="mt-2 rounded-lg bg-red-50 px-2 py-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </article>
  );
}
