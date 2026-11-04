"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: "◧" },
  { href: "/containers", label: "Containers", icon: "▣" },
  { href: "/history", label: "History", icon: "📊" },
  { href: "/devices", label: "Devices", icon: "📡" },
  { href: "/settings", label: "Settings", icon: "⚙" },
] as const;

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + "/");
}

/** Static nav — no runtime data, part of the prerendered shell. */
export function Sidebar({ children }: { children?: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <>
      {/* Desktop rail */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-slate-800 bg-slate-900 md:flex">
        <div className="flex items-center gap-2 px-5 py-5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-sky-400 to-cyan-600 text-lg">
            💧
          </span>
          <span className="text-base font-bold tracking-tight text-white">
            WaterMonitor
          </span>
        </div>

        <nav className="flex-1 space-y-1 px-3">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                isActive(pathname, item.href)
                  ? "bg-sky-500/10 text-sky-300"
                  : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              }`}
            >
              <span className="w-5 text-center" aria-hidden>
                {item.icon}
              </span>
              {item.label}
            </Link>
          ))}
        </nav>

        {/* Server-rendered user panel (streamed inside Suspense) */}
        {children ?? null}

        <div className="px-5 py-4 text-[11px] leading-4 text-slate-600">
          ESP32 + ultrasonic · HTTP POST · Supabase Realtime
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="sticky top-0 z-10 border-b border-slate-800 bg-slate-900 md:hidden">
        <div className="flex items-center gap-2 px-4 py-3">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-sky-400 to-cyan-600 text-sm">
            💧
          </span>
          <span className="text-sm font-bold text-white">WaterMonitor</span>
        </div>
        <nav className="flex gap-2 overflow-x-auto px-3 pb-3">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                isActive(pathname, item.href)
                  ? "bg-sky-500/10 text-sky-300"
                  : "bg-slate-800 text-slate-400"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </>
  );
}
