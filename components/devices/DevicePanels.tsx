"use client";

import { useState, useTransition } from "react";
import { registerDevice } from "@/app/actions";
import { StatusChip } from "@/components/StatusChip";
import type { Device } from "@/types/database";

type DeviceWithStatus = Device & { online: boolean };

/**
 * Register a new ESP32. The API key is shown exactly once — only its
 * SHA-256 hash is stored server-side.
 */
export function AddDevicePanel() {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [deviceName, setDeviceName] = useState("");
  const [deviceCode, setDeviceCode] = useState("");
  const [result, setResult] = useState<{
    device_code: string;
    api_key: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await registerDevice({
        deviceName,
        deviceCode: deviceCode || undefined,
      });
      if (res.error) {
        setError(res.error);
      } else {
        setResult({ device_code: res.device_code, api_key: res.api_key });
        setCopied(false);
        setOpen(false);
        setDeviceName("");
        setDeviceCode("");
      }
    });
  }

  return (
    <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm transition-colors">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
            Register a device
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Each ESP32 gets its own credential — the key hash is stored, the
            plaintext is shown once.
          </p>
        </div>
        {!result && (
          <button
            onClick={() => setOpen((v) => !v)}
            className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-500"
          >
            {open ? "Close" : "+ Add device"}
          </button>
        )}
      </div>

      {error && (
        <p className="mt-3 rounded-lg bg-red-50 dark:bg-red-900/20 px-3 py-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {result ? (
        <div className="mt-4 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 p-4">
          <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-400">
            Device registered. Copy the API key now — it cannot be shown
            again.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded-lg bg-white dark:bg-slate-800 px-3 py-2 font-mono text-sm text-slate-900 dark:text-white ring-1 ring-emerald-600/20">
              {result.api_key}
            </code>
            <button
              onClick={async () => {
                await navigator.clipboard.writeText(result.api_key);
                setCopied(true);
              }}
              className="shrink-0 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
            >
              {copied ? "Copied ✓" : "Copy"}
            </button>
          </div>
          <p className="mt-3 rounded-lg bg-white/70 dark:bg-slate-800/50 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-400">
            Configure the ESP32 to POST readings to{" "}
            <code className="font-mono">/api/readings</code> with header{" "}
            <code className="font-mono">
              X-API-Key: {result.api_key.slice(0, 7)}…
            </code>
            , device code{" "}
            <code className="font-mono">{result.device_code}</code>.
          </p>
          <button
            onClick={() => setResult(null)}
            className="mt-3 text-xs font-medium text-emerald-700 dark:text-emerald-400 underline"
          >
            Done — register another device
          </button>
        </div>
      ) : open ? (
        <form
          className="mt-4 flex flex-wrap items-end gap-3"
          onSubmit={submit}
        >
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
              Device name
            </label>
            <input
              required
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              placeholder="e.g. Basement tank meter"
              className="w-52 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
              Device code (optional)
            </label>
            <input
              value={deviceCode}
              onChange={(e) => setDeviceCode(e.target.value)}
              placeholder="ESP32_001"
              className="w-44 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm font-mono bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
            />
          </div>
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-slate-900 dark:bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 dark:hover:bg-sky-500 disabled:opacity-60"
          >
            {pending ? "Creating…" : "Create device + key"}
          </button>
        </form>
      ) : null}
    </section>
  );
}

/** Device summary card (presentational client via server data props). */
export function DeviceCard({
  device,
  containers,
  latestOnline,
}: {
  device: DeviceWithStatus;
  containers: Array<{ id: string; container_name: string; is_active: boolean }>;
  latestOnline: boolean;
}) {
  return (
    <article className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm transition-colors">
      <header className="flex items-start justify-between">
        <div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">
            {device.device_name}
          </h3>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            <code className="font-mono">{device.device_code}</code> · key …
            {device.api_key_prefix}
          </p>
        </div>
        <StatusChip variant={device.online ? "online" : "offline"} pulse={device.online}>
          {device.online ? "Online" : "Offline"}
        </StatusChip>
      </header>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <Row label="Firmware">
          {device.firmware_version ?? "—"}
        </Row>
        <Row label="Wi-Fi RSSI">
          {device.last_wifi_rssi ? `${device.last_wifi_rssi} dBm` : "—"}
        </Row>
        <Row label="Last communication">
          {device.last_seen
            ? new Date(device.last_seen).toLocaleString([], {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })
            : "never"}
        </Row>
        <Row label="Measurement interval">
          {device.interval_seconds}s
        </Row>
        <Row label="Active container">
          {containers.find((c) => c.is_active)?.container_name ?? "none"}
        </Row>
        <Row label="Sensor status">
          {latestOnline ? (
            <StatusChip variant="ok">OK</StatusChip>
          ) : (
            <StatusChip variant="offline">Awaiting data</StatusChip>
          )}
        </Row>
        <Row label="Buzzer threshold">
          {device.threshold_buzzer}%
        </Row>
        <Row label="Registered">
          {new Date(device.created_at).toLocaleDateString()}
        </Row>
      </dl>
    </article>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-slate-800 dark:text-slate-200">{children}</dd>
    </div>
  );
}
