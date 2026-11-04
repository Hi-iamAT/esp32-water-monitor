import type { Reading } from "@/types/database";
import { StatusChip } from "@/components/StatusChip";

/** Latest-10 style readings table (newest first). */
export function ReadingTable({ readings }: { readings: Reading[] }) {
  if (readings.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-slate-400">
        No readings in this range.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="pb-2 pr-4 font-medium">Date &amp; time</th>
            <th className="pb-2 pr-4 text-right font-medium">Level %</th>
            <th className="pb-2 pr-4 text-right font-medium">Height cm</th>
            <th className="pb-2 pr-4 text-right font-medium">Free cm</th>
            <th className="pb-2 text-right font-medium">Sensor</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {readings.map((r) => (
            <tr key={r.id} className="text-slate-700">
              <td className="py-2 pr-4">
                {new Date(r.recorded_at).toLocaleString([], {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </td>
              <td className="py-2 pr-4 text-right font-semibold text-slate-900">
                {r.water_level_percent}
              </td>
              <td className="py-2 pr-4 text-right">{r.water_height_cm}</td>
              <td className="py-2 pr-4 text-right">{r.free_space_cm}</td>
              <td className="py-2 text-right">
                {r.sensor_valid ? (
                  <StatusChip variant="ok">valid</StatusChip>
                ) : (
                  <StatusChip variant="error">invalid</StatusChip>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
