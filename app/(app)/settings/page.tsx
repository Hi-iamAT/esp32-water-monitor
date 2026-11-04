import { Suspense } from "react";
import { getSettingsData } from "@/lib/data";
import { SettingsManager } from "@/components/settings/SettingsManager";

export const metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-sky-600">
          Settings
        </p>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Configuration
        </h1>
      </header>

      <Suspense
        fallback={
          <div className="space-y-4">
            <div className="h-40 animate-pulse rounded-2xl bg-slate-200/70" />
            <div className="h-40 animate-pulse rounded-2xl bg-slate-200/70" />
          </div>
        }
      >
        <SettingsContent />
      </Suspense>
    </div>
  );
}

async function SettingsContent() {
  const data = await getSettingsData();
  return <SettingsManager data={data} />;
}
