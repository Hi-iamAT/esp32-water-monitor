import { Suspense } from "react";
import { getContainersData } from "@/lib/data";
import { ContainerManager } from "@/components/containers/ContainerManager";

export const metadata = { title: "Containers" };

export default function ContainersPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-sky-600">
          Containers
        </p>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Calibrations & management
        </h1>
      </header>

      <Suspense
        fallback={
          <div className="space-y-4">
            <div className="h-36 animate-pulse rounded-2xl bg-slate-200/70" />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="h-56 animate-pulse rounded-2xl bg-slate-200/70" />
              <div className="h-56 animate-pulse rounded-2xl bg-slate-200/70" />
            </div>
          </div>
        }
      >
        <ContainersContent />
      </Suspense>
    </div>
  );
}

async function ContainersContent() {
  const data = await getContainersData();
  return (
    <ContainerManager
      devices={data.devices}
      containers={data.containers}
      source={data.source}
    />
  );
}
