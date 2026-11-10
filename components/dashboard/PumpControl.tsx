"use client";

import { useEffect, useRef, useState } from "react";

import type { ControlMode, PumpState } from "@/types/database";

/**
 * Pump controls — AUTO / MANUAL ON / MANUAL OFF.
 *
 * This UI NEVER touches the relay: it only saves a command in Supabase
 * (via POST /api/pump-command). The ESP32 polls the command and applies
 * it locally, and its own safety cutoffs (invalid sensor, high level,
 * max runtime) always win — even in MANUAL mode.
 */

type CommandInfo = {
  mode: ControlMode;
  pump: PumpState;
  updated_at: string | null;
  expires_at: string | null;
  acknowledged_at: string | null;
};

type Props = {
  deviceCode: string;
  deviceOnline: boolean;
  /** Current stored command (null = no row yet → AUTO/OFF default). */
  command: CommandInfo | null;
  /** ACTUAL state reported by the device, from the latest reading. */
  actualMode: ControlMode | null;
  /** AUTO thresholds the device runs with (start / high cutoff). */
  autoOnPercent: number;
  autoOffPercent: number;
};

export function PumpControl({
  deviceCode,
  deviceOnline,
  command,
  actualMode,
  autoOnPercent,
  autoOffPercent,
}: Props) {
  const [pending, setPending] = useState<ControlMode | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  /** Command the user last saved through this UI (for expiry countdown). */
  const [saved, setSaved] = useState<CommandInfo | null>(null);
  const rateLimited = useRef(0);
  const savedRef = useRef<CommandInfo | null>(null);
  useEffect(() => {
    savedRef.current = saved;
  }, [saved]);

  const shown: CommandInfo | null = saved ?? command;

  /* Countdown until the saved MANUAL ON expires. */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  async function send(
    mode: ControlMode,
    pump: PumpState,
    opts: { silent?: boolean } = {},
  ) {
    const silent = opts.silent === true;

    if (mode === "MANUAL" && pump === "ON" && !silent) {
      const confirmed = window.confirm(
        `Request pump ON?\n\nThe pump will run only while the command is valid (re-checked every few seconds) and the ESP32's safety cutoffs permit it (invalid sensor, high level ${autoOffPercent}%, or max runtime stop it).\nEnsure the tank can receive water.`,
      );
      if (!confirmed) return;
    }

    // Client-side spacing to match the server's 2s rate limit.
    if (!silent && Date.now() - rateLimited.current < 2000) {
      setFeedback({ ok: false, text: "Please wait a moment between commands." });
      return;
    }
    rateLimited.current = Date.now();

    setPending(mode);
    if (!silent) setFeedback(null);
    try {
      const res = await fetch("/api/pump-command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_code: deviceCode, mode, pump }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        error?: string;
        mode?: string;
        pump?: string;
        updated_at?: string;
        expires_at?: string | null;
      };

      if (!res.ok || !data.ok) {
        const errors: Record<string, string> = {
          not_signed_in: "Session expired — sign in again.",
          unauthorized_device: "You don't have access to this device.",
          rate_limited: "Too many commands — wait a couple of seconds.",
          server_not_configured:
            "Server missing SUPABASE_SERVICE_ROLE_KEY — add it in Vercel env vars.",
          storage_failed: "Could not save the command — try again.",
        };
        setFeedback({
          ok: false,
          text: errors[data.error ?? ""] ?? "Could not save the command.",
        });
        return;
      }

      // Success = the command was SAVED. This is not yet the pump running —
      // the actual state below comes only from the device's next reading.
      if (!silent) {
        setFeedback({
          ok: true,
          text:
            pump === "ON"
              ? "Command saved — waiting for device acknowledgement."
              : `Command saved (${mode === "AUTO" ? "AUTO" : "MANUAL OFF"}).`,
        });
      }
      setSaved({
        mode: (data.mode as ControlMode) ?? mode,
        pump: (data.pump as PumpState) ?? pump,
        updated_at: data.updated_at ?? null,
        expires_at: data.expires_at ?? null,
        acknowledged_at: null,
      });
    } catch {
      if (!silent) setFeedback({ ok: false, text: "Network error — try again." });
    } finally {
      setPending(null);
    }
  }

  /* Keep-alive (spec §3.A.7): while MANUAL ON is active and the user is
     viewing the dashboard, renew the short expiry window so the pump
     keeps running with intent. Closing this tab stops renewing — the
     device then stops the pump after its own 30 s no-poll timeout. */
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  });
  useEffect(() => {
    const t = setInterval(() => {
      const c = savedRef.current;
      const left = c?.expires_at
        ? new Date(c.expires_at).getTime() - Date.now()
        : Infinity;
      if (c && c.mode === "MANUAL" && c.pump === "ON" && left <= 15_000) {
        void sendRef.current("MANUAL", "ON", { silent: true });
      }
    }, 6_000);
    return () => clearInterval(t);
  }, []);

  const secondsLeft = shown?.expires_at
    ? Math.max(0, Math.round((new Date(shown.expires_at).getTime() - now) / 1000))
    : null;
  const manualActive = shown?.mode === "MANUAL" && shown.pump === "ON";
  const acknowledged = Boolean(shown?.acknowledged_at);

  return (
    <div>
      {/* Three actions */}
      <div className="grid grid-cols-3 gap-2">
        <button
          disabled={pending !== null}
          onClick={() => send("AUTO", "OFF")}
          className={`rounded-xl px-3 py-2.5 text-sm font-semibold ring-1 ring-inset transition-colors disabled:opacity-60 ${
            actualMode === "AUTO"
              ? "bg-emerald-600 text-white ring-emerald-600 hover:bg-emerald-500"
              : "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 ring-slate-300 dark:ring-slate-700 hover:border-slate-400 dark:hover:ring-slate-600"
          }`}
        >
          {pending === "AUTO" ? "Saving…" : "AUTO"}
        </button>
        <button
          disabled={pending !== null}
          onClick={() => send("MANUAL", "ON")}
          className={`rounded-xl px-3 py-2.5 text-sm font-semibold ring-1 ring-inset transition-colors disabled:opacity-60 ${
            manualActive && actualMode === "MANUAL"
              ? "bg-sky-600 text-white ring-sky-600 hover:bg-sky-500"
              : "bg-amber-500 text-white ring-amber-500 hover:bg-amber-400"
          }`}
        >
          {pending === "MANUAL" ? "Saving…" : "Manual ON"}
        </button>
        <button
          disabled={pending !== null}
          onClick={() => send("MANUAL", "OFF")}
          className="rounded-xl bg-slate-800 dark:bg-slate-800 px-3 py-2.5 text-sm font-semibold text-white ring-1 ring-inset ring-slate-800 dark:ring-slate-700 transition-colors hover:bg-slate-700 dark:hover:bg-slate-700 disabled:opacity-60"
        >
          Manual OFF
        </button>
      </div>

      {/* Command state for the user */}
      {shown && (
        <div className="mt-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 px-3 py-2 text-xs text-slate-600 dark:text-slate-400">
          Saved command: <strong className="text-slate-900 dark:text-white">{shown.mode}{shown.mode === "MANUAL" ? ` + ${shown.pump}` : ""}</strong>
          {manualActive && (
            <>
              {" "}· expires in{" "}
              <span className="font-mono text-slate-900 dark:text-white">
                {secondsLeft !== null && secondsLeft > 0
                  ? `${secondsLeft}s`
                  : "expired"}
              </span>
              {" "}·{" "}
              {acknowledged ? (
                <span className="text-emerald-600 dark:text-emerald-400">
                  device acknowledged ✓
                </span>
              ) : (
                <span className="text-amber-600 dark:text-amber-400">
                  waiting for device acknowledgement
                </span>
              )}
            </>
          )}
          {!deviceOnline && " · device offline — it will apply the command on reconnect (AUTO keeps working locally)"}
        </div>
      )}

      {/* Feedback */}
      {feedback && (
        <p
          className={`mt-3 rounded-lg px-3 py-2 text-sm ${
            feedback.ok
              ? "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400"
              : "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400"
          }`}
        >
          {feedback.text}
        </p>
      )}

      {/* Safety warning */}
      <p className="mt-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
        ⚠ Safety cutoffs stop the pump even in MANUAL mode: invalid sensor,
        level ≥ {autoOffPercent}% (AUTO turns it on at ≤ {autoOnPercent}%),
        or maximum continuous runtime. Commands are requests, not overrides.
      </p>
    </div>
  );
}
