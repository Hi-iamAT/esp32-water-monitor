\"use client\";

import { useState, useTransition } from \"react\";
import {
  calibrateContainer,
  renameContainer,
  retireContainer,
  setContainerActive,
} from \"@/app/actions\";
import type { Device } from \"@/types/database\";
import type { ContainersData } from \"@/lib/view-types\";
import { levelStatus } from \"@/lib/level\";
import { StatusChip, LevelStatusChip } from \"@/components/StatusChip\";

export function ContainerManager({
  devices,
  containers,
  source,
}: {
  devices: ContainersData[\"devices\"];
  containers: ContainersData[\"containers\"];
  source: \"live\" | \"mock\";
}) {
  return (
    <div className=\"space-y-6\">
      {source === \"mock\" && (
        <p className=\"rounded-xl bg-amber-50 dark:bg-amber-900/20 px-4 py-2.5 text-sm text-amber-800 dark:text-amber-400 ring-1 ring-inset ring-amber-600/20\">
          Demo data — run <code className=\"font-mono\">supabase/schema.sql</code>{\" \"}
          to enable persistence.
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
  const [deviceId, setDeviceId] = useState(devices[0]?.id ?? \"\");
  const [distance, setDistance] = useState(\"\");
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  if (devices.length === 0) {
    return (
      <div className=\"rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 text-center text-sm text-slate-500 dark:text-slate-400\">
        Register a device first (Devices page), then calibrate containers here.
      </div>
    );
  }

  return (
    <section className=\"rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm transition-colors\">
      <h2 className=\"text-sm font-semibold text-slate-900 dark:text-white\">
        Calibrate a new container
      </h2>
      <p className=\"mt-1 max-w-xl text-xs text-slate-500 dark:text-slate-400\">
        With the container <strong className=\"text-slate-900 dark:text-white\">empty</strong>, measure the distance from the
        ultrasonic sensor to the water surface. That reference (D0) defines 0%
        — 100% is the same plane from the other side.
      </p>

      <form
        className=\"mt-4 flex flex-wrap items-end gap-3\"
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
                text: `Saved — assigned \"${res.container_name}\" and set it active.`,
              });
              setDistance(\"\");
            }
          });
        }}
      >
        {devices.length > 1 && (
          <div>
            <label className=\"mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400\">
              Device
            </label>
            <select
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              className=\"rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200\"
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
          <label className=\"mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400\">
            Empty-reference distance (cm)
          </label>
          <input
            type=\"number\"
            step=\"0.1\"
            min=\"0.1\"
            max=\"400\"
            required
            value={distance}
            onChange={(e) => setDistance(e.target.value)}
            placeholder=\"e.g. 27.0\"
            className=\"w-44 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200\"
          />
        </div>
        <button
          type=\"submit\"
          disabled={pending}
          className=\"rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-60\"
        >
          {pending ? \"Saving…\" : \"Calibrate container\"}
        </button>
      </form>

      {feedback && (
        <p
          className={`mt-3 rounded-lg px-3 py-2 text-sm ${
            feedback.ok
              ? \"bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400\"
              : \"bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400\"
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
  containers: ContainersData[\"containers\"];
}) {
  if (containers.length === 0) {
    return (
      <div className=\"rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-10 text-center text-sm text-slate-500 dark:text-slate-400\">
        No containers calibrated yet.
      </div>
    );
  }

  return (
    <div className=\"grid grid-cols-1 gap-4 md:grid-cols-2\">
      {containers.map((c) => (
        <ContainerCard key={c.id} container={c} />
      ))}
    </div>
  );
}

function ContainerCard({
  container: c,
}: {
  container: ContainersData[\"containers\"][number];
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
      if (res.error) setError(res.// la logic is the same
        return {
          error: res.error
        };
      }
      return {
        error: res.error
      };
    });
  }

  return (
    <article
      className={`rounded-2xl border bg-white dark:bg-slate-900 p-5 shadow-sm transition-colors ${
        c.is_active ? \"border-sky-300 ring-1 ring-sky-200 dark:ring-sky-900/50\" : \"border-slate-200 dark:border-slate-800\"
      } ${!c.is_active ? \"opacity-80\" : \"\"}`}
    >
      <header className=\"flex items-start justify-between gap-2\">\n        <div className=\"min-w-0\">\n          {editing ? (\n            <div className=\"flex items-center gap-2\">\n              <input\n                value={draftName}\n                onChange={(e) => setDraftName(e.target.value)}\n                maxLength={60}\n                className=\"w-40 rounded-lg border border-slate-300 dark:border-slate-700 px-2 py-1 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200\"\n                autoFocus\n              />\n              <button\n                onClick={saveName}\n                disabled={pending}\n                className=\"rounded-lg bg-emerald-600 px-2 py-1 text-xs font-semibold text-white hover:bg-emerald-500\"\n              >\n                Save\n              </button>\n              <button\n                onClick={() => {\n                  setEditing(false);\n                  setDraftName(c.container_name);\n                  setError(null);\n                }}\n                className=\"rounded-lg bg-slate-200 dark:bg-slate-800 px-2 py-1 text-xs font-medium text-slate-700 dark:text-slate-400\"\n              >\n                ✕\n              </button>\n            </div\n          ) : (\n            <h3 className=\"truncate text-base font-semibold text-slate-900 dark:text-white\">\n              {c.container_name}\n            </h3>\n          )}\n          <p className=\"mt-0.5 text-xs text-slate-500 dark:text-slate-400\">\n            #{c.container_number} · calibrated{\" \"}\n            {new Date(c.calibrated_at).toLocaleDateString()} · ref{\" \"}\n            {c.empty_distance_cm} cm\n          </p>\n        </div>\n        <div className=\"flex shrink-0 items-center gap-2\">\n          {c.is_active ? (\n            <StatusChip variant=\"online\">Active</StatusChip>\n            ) : (\n            <StatusChip variant=\"neutral\">Inactive</StatusChip>\n          )}\n        </div>\n      </header>\n\n      <div className=\"mt-4 flex items-center justify-between rounded-xl bg-slate-50 dark:bg-slate-800/50 px-4 py-3\">\n        <div>\n          <p className=\"text-2xl font-bold text-slate-900 dark:text-white\">\n            {percent !== null ? `${percent}%` : \"—\"}\n          </p>\n          <p className=\"text-xs text-slate-500 dark:text-slate-400\">\n            {current\n              ? `${current.water_height_cm} cm water · ${current.free_space_cm} cm free`\n              : \"No readings yet\"}\n          </p>\n        </div>\n        {status && <LevelStatusChip status={status} />}\n      </div>\n\n      <footer className=\"mt-4 flex flex-wrap items-center gap-2\">\n        {!editing && (\n          <button\n            onClick={() => setEditing(true)}\n            className=\"rounded-lg border border-slate-300 dark:border-slate-700 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-400 hover:border-slate-400\"\n          >\n            Rename\n          </button>\n        )}\n        {!c.is_active && (\n          <button\n            disabled={pending}\n            onClick={() =>\n              startTransition(async () => {\n                const res = await setContainerActive({ containerId: c.id });\n                if (res.error) setError(res.error);\n              })\n            }\n            className=\"rounded-lg border border-sky-300 dark:border-sky-900 bg-sky-50 dark:bg-sky-900/20 px-2.5 py-1.5 text-xs font-medium text-sky-700 dark:text-sky-400 hover:bg-sky-100 dark:hover:bg-sky-900/30\"\n          >\n            Set active\n          </button>\n        )}\n        {c.is_active && (\n          <button\n            disabled={pending}\n            onClick={() =>\n              startTransition(async () => {\n                const res = await retireContainer({ containerId: c.id });\n                if (res.error) setError(res.error);\n              })\n            }\n            className=\"rounded-lg border border-slate-300 dark:border-slate-700 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-400 hover:border-slate-400\"\n          >\n            Deactivate\n          </button>\n        )}\n        <a\n          href={`/history?container=${c.id}`}\n          className=\"ml-auto rounded-lg bg-slate-900 dark:bg-sky-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-slate-700 dark:hover:bg-sky-500\"\n        >\n          View history →\n        </a>\n      </footer>\n\n      {error && (\n        <p className=\"mt-2 rounded-lg bg-red-50 dark:bg-red-900/20 px-2 py-1 text-xs text-red-600 dark:text-red-400\">\n          {error}\n        </p>\n      )}\n    </article>\n  );\n}\n