import { Suspense } from "react";
import { getDashboardSnapshot } from "@/lib/data";
import { DashboardLive } from "@/components/dashboard/DashboardLive";

export const metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-sky-600">
            Dashboard
          </p>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Overview
          </h1>
        </div>
        <a
          href="/history"
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:border-slate-400"
        >
          View history →
        </a>
      </header>

      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardContent />
      </Suspense>
    </div>
  );
}

/**
 * Snapshot fetcher — runs at request time (inside the Suspense boundary)
 * and streams into the live client shell below.
 */
async function DashboardContent() {
  const snapshot = await getDashboardSnapshot();
  return <DashboardLive initial={snapshot} />;
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6" aria-label="Loading dashboard">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-28 animate-pulse rounded-2xl bg-slate-200/70"
          />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="h-72 animate-pulse rounded-2xl bg-slate-200/70" />
        <div className="h-72 animate-pulse rounded-2xl bg-slate-200/70" />
      </div>
    </div>
  );
}
