import { Suspense } from "react";
import { LoginForm } from "@/components/LoginForm";

export const metadata = { title: "Sign in" };

type SearchParams = { next?: string; setup?: string };

// Build-time inlined (NEXT_PUBLIC_*), safe outside the Suspense boundary.
function isConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const configured = isConfigured();

  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-950 px-4 py-12">
      <div className="w-full max-w-md">
        {/* Brand */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-400 to-cyan-600 text-2xl shadow-lg shadow-sky-900/40">
            💧
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            WaterMonitor
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Portable water-level meter dashboard
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl">
          {!configured ? (
            <div className="space-y-4 text-center">
              <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
                Supabase is not configured yet. Create your database first
                (see <code className="font-mono">supabase/schema.sql</code>
                ), then copy{" "}
                <code className="font-mono">.env.local.example</code> to{" "}
                <code className="font-mono">.env.local</code> and fill in your
                project keys.
              </p>
              <p className="text-sm text-slate-500">
                Until then you can explore the pages with demo data — the UI
                is fully built.
              </p>
              <a
                href="/dashboard"
                className="inline-block rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500"
              >
                Explore with demo data →
              </a>
            </div>
          ) : (
            <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-white/10" />}>
              <LoginPanel searchParams={searchParams} />
            </Suspense>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-slate-500">
          ESP32 device? Readings go to{" "}
          <code className="font-mono text-slate-300">POST /api/readings</code>{" "}
          with the device API key.
        </p>
      </div>
    </div>
  );
}

/** Awaits searchParams (request-time) inside the Suspense boundary. */
async function LoginPanel({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;

  return (
    <>
      {params.setup && (
        <p className="mb-4 rounded-lg bg-sky-500/10 px-3 py-2 text-center text-sm text-sky-300">
          Enter your name and the access password to view your dashboard.
        </p>
      )}
      <div className="rounded-xl bg-white p-5">
        <LoginForm next={params.next} />
      </div>
    </>
  );
}

