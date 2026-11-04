"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

export function HistoryFilterBar({
  containers,
  selectedContainerId,
  fromDate,
  toDate,
}: {
  containers: Array<{ id: string; container_name: string }>;
  selectedContainerId: string | null;
  fromDate: string | null;
  toDate: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function apply(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const params = new URLSearchParams();
    const container = String(form.get("container") || "");
    const from = String(form.get("from") || "");
    const to = String(form.get("to") || "");
    if (container) params.set("container", container);
    if (from) params.set("from", from);
    if (to) params.set("to", to);

    startTransition(() => {
      router.push(`/history${params.toString() ? `?${params}` : ""}`);
    });
  }

  function isoDatePrefix(iso: string | null) {
    return iso ? new Date(iso).toISOString().slice(0, 10) : "";
  }

  const exportQuery = new URLSearchParams();
  if (selectedContainerId) exportQuery.set("container_id", selectedContainerId);
  if (fromDate) exportQuery.set("from", fromDate);
  if (toDate) exportQuery.set("to", toDate);

  return (
    <form
      onSubmit={apply}
      className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">
          Container
        </label>
        <select
          name="container"
          defaultValue={selectedContainerId ?? ""}
          className="w-48 rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
          {containers.length === 0 && <option value="">No containers</option>}
          {containers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.container_name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">
          From
        </label>
        <input
          type="date"
          name="from"
          defaultValue={isoDatePrefix(fromDate)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">
          To
        </label>
        <input
          type="date"
          name="to"
          defaultValue={isoDatePrefix(toDate)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-60"
      >
        {pending ? "Filtering…" : "Apply"}
      </button>

      <a
        href={`/api/readings/export${exportQuery.toString() ? `?${exportQuery}` : ""}`}
        className="ml-auto rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-400"
      >
        ⬇ Export CSV
      </a>
    </form>
  );
}
