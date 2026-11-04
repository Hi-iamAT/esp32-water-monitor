"use client";

import { useState, useTransition } from "react";
import {
  changePassword,
  updateDeviceConfig,
  updateProfile,
} from "@/app/actions";
import type { Container, Device } from "@/types/database";
import type { SettingsData } from "@/lib/view-types";
import { Card } from "@/components/Card";

export function SettingsManager({ data }: { data: SettingsData }) {
  return (
    <div className="space-y-4">
      {data.source === "mock" && (
        <p className="rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-800 ring-1 ring-inset ring-amber-600/20">
          Demo data — run <code className="font-mono">supabase/schema.sql</code>{" "}
          to make settings persistent.
        </p>
      )}
      <AccountCard profile={data.profile} />
      {data.devices.map((device) => (
        <DeviceConfigCard key={device.id} device={device} />
      ))}
      <ContainerSummaryCard containers={data.containers} />
    </div>
  );
}

/* ── Account ─────────────────────────────────────────────── */

function AccountCard({
  profile,
}: {
  profile: SettingsData["profile"];
}) {
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(profile?.full_name ?? "");
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [pwFeedback, setPwFeedback] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  return (
    <Card title="Account" subtitle="Profile details and password">
      {!profile ? (
        <p className="text-sm text-slate-500">
          Sign in to manage your account.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div>
            <p className="mb-1 text-xs font-medium text-slate-500">
              Email: {profile.email}
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setFeedback(null);
                startTransition(async () => {
                  const res = await updateProfile({ fullName: name });
                  setFeedback(
                    res.error
                      ? { ok: false, text: res.error }
                      : { ok: true, text: "Profile updated." },
                  );
                });
              }}
              className="space-y-2"
            >
              <label className="block text-xs font-medium text-slate-600">
                Full name
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <button
                type="submit"
                disabled={pending}
                className="rounded-lg bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-60"
              >
                Save profile
              </button>
              {feedback && (
                <p
                  className={`rounded-lg px-3 py-2 text-xs ${
                    feedback.ok
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-red-50 text-red-600"
                  }`}
                >
                  {feedback.text}
                </p>
              )}
            </form>
          </div>

          <div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setPwFeedback(null);
                startTransition(async () => {
                  const res = await changePassword({
                    currentPassword: currentPw,
                    newPassword: newPw,
                  });
                  setPwFeedback(
                    res.error
                      ? { ok: false, text: res.error }
                      : { ok: true, text: "Password changed." },
                  );
                  if (!res.error) {
                    setCurrentPw("");
                    setNewPw("");
                  }
                });
              }}
              className="space-y-2"
            >
              <label className="block text-xs font-medium text-slate-600">
                Change password
              </label>
              <input
                type="password"
                required
                placeholder="Current password"
                value={currentPw}
                onChange={(e) => setCurrentPw(e.target.value)}
                autoComplete="current-password"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <input
                type="password"
                required
                minLength={8}
                placeholder="New password (min. 8 chars)"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                autoComplete="new-password"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <button
                type="submit"
                disabled={pending}
                className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
              >
                Update password
              </button>
              {pwFeedback && (
                <p
                  className={`rounded-lg px-3 py-2 text-xs ${
                    pwFeedback.ok
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-red-50 text-red-600"
                  }`}
                >
                  {pwFeedback.text}
                </p>
              )}
            </form>
          </div>
        </div>
      )}
    </Card>
  );
}

/* ── Device config ───────────────────────────────────────── */

function DeviceConfigCard({ device }: { device: Device }) {
  const [pending, startTransition] = useTransition();
  const [interval, setInterval] = useState(String(device.interval_seconds));
  const [t25, setT25] = useState(String(device.threshold_led25));
  const [t50, setT50] = useState(String(device.threshold_led50));
  const [t75, setT75] = useState(String(device.threshold_led75));
  const [buzzer, setBuzzer] = useState(String(device.threshold_buzzer));
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  return (
    <Card
      title={`Alerts & measurement — ${device.device_name}`}
      subtitle="Applied locally by the ESP32 (LEDs + buzzer) so alerts work without internet. New values reach the device on its next reading POST."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setFeedback(null);
          startTransition(async () => {
            const res = await updateDeviceConfig({
              deviceId: device.id,
              intervalSeconds: parseFloat(interval),
              thresholdLed25: parseFloat(t25),
              thresholdLed50: parseFloat(t50),
              thresholdLed75: parseFloat(t75),
              thresholdBuzzer: parseFloat(buzzer),
            });
            setFeedback(
              res.error
                ? { ok: false, text: res.error }
                : { ok: true, text: "Saved — device will pick this up on its next POST." },
            );
          });
        }}
        className="space-y-4"
      >
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">
              Measurement interval (seconds)
            </label>
            <select
              value={interval}
              onChange={(e) => setInterval(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              {[10, 15, 30, 60, 120, 300, 600, 1800].map((s) => (
                <option key={s} value={String(s)}>
                  {s < 60 ? `${s} s` : `${s / 60} min`}
                </option>
              ))}
            </select>
          </div>

          {[
            { label: "LED 25%", value: t25, set: setT25, hint: "1st LED on at" },
            { label: "LED 50%", value: t50, set: setT50, hint: "2nd LED" },
            { label: "LED 75%", value: t75, set: setT75, hint: "3rd LED" },
            { label: "Buzzer", value: buzzer, set: setBuzzer, hint: "alarm at" },
          ].map((f) => (
            <div key={f.label}>
              <label className="mb-1 block text-xs font-medium text-slate-600">
                {f.label} threshold (%)
              </label>
              <input
                type="number"
                min="0"
                max="100"
                value={f.value}
                onChange={(e) => f.set(e.target.value)}
                className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          ))}

          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-60"
          >
            {pending ? "Saving…" : "Save configuration"}
          </button>
        </div>

        {feedback && (
          <p
            className={`rounded-lg px-3 py-2 text-xs ${
              feedback.ok
                ? "bg-emerald-50 text-emerald-700"
                : "bg-red-50 text-red-600"
            }`}
          >
            {feedback.text}
          </p>
        )}
      </form>
    </Card>
  );
}

/* ── Container quick-actions ─────────────────────────────── */

function ContainerSummaryCard({
  containers,
}: {
  containers: Container[];
}) {
  return (
    <Card
      title="Calibrated containers"
      subtitle="Rename containers in full from the Containers page"
    >
      {containers.length === 0 ? (
        <p className="text-sm text-slate-500">No containers calibrated yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {containers.map((c) => (
            <li key={c.id} className="flex items-center justify-between py-2.5">
              <span className="text-sm text-slate-700">
                {c.container_name}
                {c.is_active && (
                  <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-700">
                    active
                  </span>
                )}
              </span>
              <span className="text-xs text-slate-500">
                ref {c.empty_distance_cm} cm ·{" "}
                <a
                  href="/containers"
                  className="font-medium text-sky-600 hover:underline"
                >
                  manage
                </a>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
