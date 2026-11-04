import { LEVEL_STATUS_LABEL, type LevelStatus } from "@/lib/level";

type Variant =
  | "online"
  | "offline"
  | "ok"
  | "error"
  | "warning"
  | "info"
  | "neutral";

const STYLES: Record<Variant, string> = {
  online: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  offline: "bg-slate-100 text-slate-600 ring-slate-500/20",
  ok: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  error: "bg-red-50 text-red-700 ring-red-600/20",
  warning: "bg-amber-50 text-amber-700 ring-amber-600/20",
  info: "bg-sky-50 text-sky-700 ring-sky-600/20",
  neutral: "bg-slate-100 text-slate-600 ring-slate-500/20",
};

const DOTS: Record<Variant, string> = {
  online: "bg-emerald-500 animate-pulse",
  offline: "bg-slate-400",
  ok: "bg-emerald-500",
  error: "bg-red-500",
  warning: "bg-amber-500",
  info: "bg-sky-500",
  neutral: "bg-slate-400",
};

export function StatusChip({
  variant = "neutral",
  children,
  pulse = false,
}: {
  variant?: Variant;
  children: React.ReactNode;
  pulse?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${STYLES[variant]}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${pulse ? STYLES[variant] + " animate-pulse" : DOTS[variant]}`}
        aria-hidden
      />
      {children}
    </span>
  );
}

export function LevelStatusChip({ status }: { status: LevelStatus }) {
  const variant: Variant =
    status === "overflow-risk"
      ? "error"
      : status === "very-high"
        ? "info"
        : status === "high"
          ? "info"
          : status === "medium"
            ? "ok"
            : status === "low"
              ? "warning"
              : "neutral";
  return <StatusChip variant={variant}>{LEVEL_STATUS_LABEL[status]}</StatusChip>;
}
