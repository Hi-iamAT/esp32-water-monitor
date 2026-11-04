"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createAccount, logInAccount } from "@/app/actions";

type Mode = "signin" | "signup";

/**
 * Name + personal password accounts.
 *  - "Create account" → first visit, registers the name (name = login ID).
 *  - "Sign in" → same name + password opens the dashboard.
 * Everything runs through server actions; no email is ever involved.
 */
export function LoginForm({ next }: { next?: string }) {
  const router = useRouter();

  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const destination =
    next && next.startsWith("/") && !next.startsWith("//")
      ? next
      : "/dashboard";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const result =
      mode === "signup"
        ? await createAccount({ fullName: name, password })
        : await logInAccount({ fullName: name, password });

    if (result.error) {
      setError(result.error);
      setBusy(false);
      return;
    }

    router.replace(destination);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label
          htmlFor="name"
          className="mb-1 block text-sm font-medium text-slate-700"
        >
          Full name
        </label>
        <input
          id="name"
          type="text"
          required
          autoComplete="name"
          maxLength={60}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
          placeholder="e.g. Atal Ahmad"
        />
        <p className="mt-1 text-[11px] text-slate-500">
          Your name is your login ID — use the same one every time.
        </p>
      </div>

      <div>
        <label
          htmlFor="password"
          className="mb-1 block text-sm font-medium text-slate-700"
        >
          Password
        </label>
        <input
          id="password"
          type="password"
          required
          minLength={6}
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
          placeholder={
            mode === "signup" ? "At least 6 characters" : "••••••••"
          }
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
        {busy
          ? "Working…"
          : mode === "signup"
            ? "Create account"
            : "Sign in"}
      </button>

      <p className="text-center text-[11px] leading-4 text-slate-500">
        No email involved — the account is just your name and password.
      </p>
      <p className="text-center text-sm text-slate-500">
        {mode === "signin" ? "First time here?" : "Already have an account?"}{" "}
        <button
          type="button"
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setError(null);
          }}
          className="font-semibold text-sky-600 hover:underline"
        >
          {mode === "signin" ? "Create an account" : "Sign in"}
        </button>
      </p>
    </form>
  );
}
