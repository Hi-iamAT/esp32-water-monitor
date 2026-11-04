"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { verifyAccessPassword } from "@/app/actions";

/**
 * Simple no-email login:
 *   1. verify the shared access password server-side (timing-safe action),
 *   2. create an anonymous Supabase session (no email, no confirmation),
 *   3. remember the display name in the user's metadata,
 *   4. straight to the dashboard.
 */
export function LoginForm({ next }: { next?: string }) {
  const router = useRouter();

  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const destination =
    next && next.startsWith("/") && !next.startsWith("//")
      ? next
      : "/dashboard";

  function friendly(err: unknown): string {
    const e = (err ?? {}) as {
      code?: string;
      error_code?: string;
      message?: string;
    };
    if (
      e.error_code === "anonymous_provider_disabled" ||
      e.code === "anonymous_provider_disabled" ||
      /anonymous sign-ins are disabled/i.test(e.message ?? "")
    ) {
      return (
        "Anonymous sign-ins are disabled in the Supabase project. " +
        "Open the Supabase Dashboard → Authentication → Sign In / Up → " +
        "turn ON \"Allow anonymous users\", save, then try again."
      );
    }
    if (e.error_code === "over_request_rate_limit") {
      return "Too many attempts right now — wait a minute and retry.";
    }
    if (/failed to fetch|network/i.test(e.message ?? "")) {
      return "Network problem reaching Supabase — check your connection.";
    }
    return e.message || "Something went wrong. Try again.";
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    try {
      // 1. Shared password gate (server action).
      const gate = await verifyAccessPassword(password);
      if (!gate.ok) throw new Error(gate.error ?? "Wrong access password.");

      // 2. Anonymous session — no email involved.
      const supabase = createSupabaseBrowserClient();
      const { error: signInError } = await supabase.auth.signInAnonymously();
      if (signInError) throw signInError;

      // 3. Store the display name (best-effort; never blocks the redirect).
      const trimmed = name.trim();
      if (trimmed) {
        await supabase.auth
          .updateUser({ data: { full_name: trimmed } })
          .catch(() => undefined);
      }

      // 4. Straight to the dashboard.
      router.replace(destination);
      router.refresh();
    } catch (err) {
      setError(friendly(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label
          htmlFor="name"
          className="mb-1 block text-sm font-medium text-slate-700"
        >
          Your name
        </label>
        <input
          id="name"
          type="text"
          required
          autoComplete="name"
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
          placeholder="e.g. Atal"
        />
      </div>

      <div>
        <label
          htmlFor="password"
          className="mb-1 block text-sm font-medium text-slate-700"
        >
          Access password
        </label>
        <input
          id="password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
          placeholder="••••••••"
        />
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? "Opening dashboard…" : "Open dashboard"}
      </button>

      <p className="text-center text-[11px] leading-4 text-slate-500">
        No email needed — your name and the shared password open a private
        session on this device.
      </p>
    </form>
  );
}
