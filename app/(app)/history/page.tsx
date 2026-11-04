import { Suspense } from "react";
import { getHistoryData } from "@/lib/data";
import { Card } from "@/components/Card";
import { HistoryFilterBar } from "@/components/history/HistoryFilterBar";
import { ReadingChart } from "@/components/history/ReadingChart";
import { ReadingTable } from "@/components/history/ReadingTable";

export const metadata = { title: "History" };

type SearchParams = {
  container?: string;
  from?: string;
  to?: string;
};

export default function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-sky-600">
          History
        </p>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Historic measurements & analytics
        </h1>
      </header>

      <Suspense
        fallback={
          <>
            <div className="h-20 animate-pulse rounded-2xl bg-slate-200/70" />
            <div className="h-80 animate-pulse rounded-2xl bg-slate-200/70" />
          </>
        }
      >
        <HistoryContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function HistoryContent({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams; // request-time filter state
  const data = await getHistoryData({
    containerId: params.container,
    from: params.from ? `${params.from}T00:00:00` : undefined,
    to: params.to ? `${params.to}T23:59:59.999` : undefined,
  });

  const latest = [...data.readings].reverse().slice(0, 10); // newest first

  return (
    <div className="space-y-4">
      {data.source === "mock" && (
        <p className="rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-800 ring-1 ring-inset ring-amber-600/20">
          Demo data — run <code className="font-mono">supabase/schema.sql</code>{" "}
          to see your real measurement history.
        </p>
      )}

      <HistoryFilterBar
        containers={data.containers.map((c) => ({
          id: c.id,
          container_name: c.container_name,
        }))}
        selectedContainerId={data.selectedContainerId}
        fromDate={data.fromDate}
        toDate={data.toDate}
      />

      <Card
        title="Water level over time"
        subtitle={`${data.readings.length} readings in range`}
      >
        <ReadingChart readings={data.readings} />
      </Card>

      <Card title="Latest 10 readings" subtitle="In the selected range">
        <ReadingTable readings={latest} />
      </Card>
    </div>
  );
}
