"use client";

import { useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Reading } from "@/types/database";

type MetricKey = "water_level_percent" | "water_height_cm" | "free_space_cm";

const METRICS: Array<{
  key: MetricKey;
  label: string;
  unit: string;
  color: string;
  yMax: number;
}> = [
  {
    key: "water_level_percent",
    label: "Water %",
    unit: "%",
    color: "#0ea5e9",
    yMax: 100,
  },
  { key: "water_height_cm", label: "Height", unit: "cm", color: "#8b5cf6", yMax: undefined as unknown as number },
  { key: "free_space_cm", label: "Free space", unit: "cm", color: "#10b981", yMax: undefined as unknown as number },
];

/**
 * Water-percentage / height / free-space over time (tabbed).
 * Invalid readings are excluded from the chart.
 */
export function ReadingChart({ readings }: { readings: Reading[] }) {
  const [metric, setMetric] = useState<MetricKey>("water_level_percent");
  const active = METRICS.find((m) => m.key === metric)!;

  const data = readings    .filter((r) => r.sensor_valid)
    .map((r) => ({
      t: new Date(r.recorded_at).getTime(),
      value:
        metric === "water_level_percent"
          ? r.water_level_percent
          : metric === "water_height_cm"
            ? r.water_height_cm
            : r.free_space_cm,
    }));

  return (
    <div>
      <div className="mb-3 flex gap-1.5">
        {METRICS.map((m) => (
          <button
            key={m.key}
            onClick={() => setMetric(m.key)}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
              metric === m.key
                ? "bg-sky-600 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {data.length === 0 ? (
        <p className="flex h-64 items-center justify-center text-sm text-slate-400">
          No valid readings in this range.
        </p>
      ) : (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={data}
              margin={{ top: 6, right: 8, bottom: 0, left: -14 }}
            >
              <defs>
                <linearGradient id="fillMetric" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={active.color} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={active.color} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                dataKey="t"
                type="number"
                domain={["dataMin", "dataMax"]}
                tickFormatter={(t: number) =>
                  new Date(t).toLocaleString([], {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })
                }
                tick={{ fontSize: 10 }}
                stroke="#94a3b8"
              />
              <YAxis
                unit={active.unit}
                tick={{ fontSize: 10 }}
                stroke="#94a3b8"
                {...(active.key === "water_level_percent"
                  ? { domain: [0, 100] }
                  : { domain: [0, "auto"] })}
              />
              <Tooltip
                formatter={(v) => [`${v}${active.unit}`, active.label]}
                labelFormatter={(t) =>
                  new Date(Number(t)).toLocaleString()
                }
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
              />
              <Area
                type="stepAfter"
                dataKey="value"
                stroke={active.color}
                strokeWidth={2}
                fill="url(#fillMetric)"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
