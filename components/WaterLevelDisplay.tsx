"use client";

import { LEVEL_STATUS_LABEL, levelStatus } from "@/lib/level";

/**
 * Visual water-level container: a vertical vessel with animated fill,
 * threshold tick marks, and the percentage inside the fill.
 * Pure CSS transitions — the fill smoothly animates whenever `percent`
 * changes (server stream or realtime update).
 */
export function WaterLevelDisplay({
  percent,
  containerName,
  valid = true,
}: {
  percent: number;
  containerName?: string | null;
  valid?: boolean;
}) {
  const status = levelStatus(percent);
  const clamped = Math.min(100, Math.max(0, percent));

  return (
    <div className="flex items-end justify-center gap-6">
      {/* Vessel */}
      <div className="relative h-64 w-28 overflow-hidden rounded-2xl border-2 border-slate-300 bg-gradient-to-b from-white to-slate-50 shadow-inner">
        {/* Water fill */}
        <div
          className={`absolute inset-x-0 bottom-0 transition-all duration-700 ease-out ${
            valid
              ? status === "overflow-risk"
                ? "bg-gradient-to-b from-cyan-400 to-rose-400"
                : "bg-gradient-to-b from-cyan-300 to-sky-500"
              : "bg-slate-200"
          }`}
          style={{ height: `${valid ? clamped : 0}%` }}
        >
          {/* Surface ripple */}
          <div className="absolute inset-x-0 top-0 h-1.5 bg-white/40" />
        </div>

        {/* Threshold ticks */}
        {[25, 50, 75].map((t) => (
          <div
            key={t}
            className="absolute left-0 h-px w-4 bg-slate-400/70"
            style={{ bottom: `${t}%` }}
            aria-hidden
          />
        ))}
        {[25, 50, 75].map((t) => (
          <span
            key={`label-${t}`}
            className="absolute -left-7 z-10 text-[10px] font-medium text-slate-400"
            style={{ bottom: `calc(${t}% - 6px)` }}
          >
            {t}%
          </span>
        ))}

        {/* Overflow warning */}
        {status === "overflow-risk" && (
          <div className="absolute inset-x-0 top-0 z-10 flex justify-center">
            <span className="mt-1 rounded bg-red-500/90 px-1.5 py-0.5 text-[9px] font-bold text-white">
              ⚠ 90%
            </span>
          </div>
        )}

        {/* Percentage inside */}
        <div className="absolute inset-x-0 top-3 z-10 flex flex-col items-center">
          <span className="text-2xl font-bold text-slate-900 drop-shadow-sm">
            {valid ? Math.round(clamped) : "—"}
            <span className="text-base">%</span>
          </span>
        </div>

        {/* 90% line */}
        <div
          className="absolute inset-x-0 border-t border-dashed border-red-400/80"
          style={{ bottom: "90%" }}
          aria-hidden
        />

        {/* Invalid overlay */}
        {!valid && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-50/80">
            <span className="text-[10px] font-semibold text-slate-500">
              sensor error
            </span>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="pb-2">
        <div className="space-y-2 text-xs text-slate-500">
          <p>
            <span className="font-semibold text-slate-700">
              {valid ? `${round1(clamped)}% full` : "Invalid reading"}
            </span>
          </p>
          {containerName && (
            <p>{containerName}</p>
          )}
          <p>{LEVEL_STATUS_LABEL[status]}</p>
          <p className="text-[11px] leading-4 text-slate-400">
            Dashed line = 90% buzzer threshold.
            <br />
            Ticks = 25 / 50 / 75% LEDs.
          </p>
        </div>
      </div>
    </div>
  );
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}
