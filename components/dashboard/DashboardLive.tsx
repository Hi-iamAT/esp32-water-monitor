"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Reading } from "@/types/database";
import type { DashboardSnapshot, DeviceWithOnline } from "@/lib/view-types";
import { DashboardView } from "@/components/dashboard/DashboardView";

type CoState = {
  /** The server-sent snapshot the state object was built from. */
  initial: DashboardSnapshot;
  /** What the UI currently shows (server initial + realtime merges). */
  snap: DashboardSnapshot;
  /** Ticking clock for friendly relative times. */
  now: Date;
  /** True once the realtime socket has successfully delivered anything. */
  realtimeOn: boolean;
};

/**
 * Live dashboard shell:
 *  - subscribes to Supabase Realtime INSERTs on `readings` and UPDATEs on
 *    `devices` (RLS-filtered automatically, only own rows are delivered),
 *  - keeps a ticking clock for friendly "last seen" strings,
 *  - falls back to a full server refresh (polling) if the socket drops.
 */
export function DashboardLive({ initial }: { initial: DashboardSnapshot }) {
  const router = useRouter();

  // State bundle; the "adopt refreshed server data" adjustment happens
  // during render (React-sanctioned pattern) — not inside an effect.
  const [co, setCo] = useState<CoState>(() => ({
    initial: initial,
    snap: initial,
    now: new Date(initial.now),
    realtimeOn: false,
  }));
  if (co.initial !== initial) {
    setCo({
      initial: initial,
      snap: co.realtimeOn ? co.snap : initial,
      now: new Date(
        Math.max(co.now.getTime(), new Date(initial.now).getTime()),
      ),
      realtimeOn: co.realtimeOn,
    });
  }

  // Ticking clock (client only, after hydration; async callback = allowed).
  useEffect(() => {
    const t = setInterval(() => {
      setCo((prev) => ({ ...prev, now: new Date() }));
    }, 15_000);
    return () => clearInterval(t);
  }, []);

  // Realtime subscription (only meaningful for live snapshots).
  useEffect(() => {
    if (co.initial.source !== "live") return;
    if (
      !process.env.NEXT_PUBLIC_SUPABASE_URL ||
      !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )
      return;

    const supabase = createSupabaseBrowserClient();
    const channel = supabase
      .channel("dashboard-live")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "readings" },
        (payload) => {
          const reading = payload.new as Reading;
          setCo((prev) => {
            const s = prev.snap;
            const merged =
              s.activeContainer?.id === reading.container_id
                ? {
                    ...s,
                    latestReading: reading,
                    recentReadings: [
                      reading,
                      ...s.recentReadings.filter((r) => r.id !== reading.id),
                    ].slice(0, 10),
                  }
                : s;
            return { ...prev, now: new Date(), realtimeOn: true, snap: merged };
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "devices" },
        (payload) => {
          const updated = payload.new as DeviceWithOnline;
          setCo((prev) => {
            const s = prev.snap;
            const merged =
              s.device?.id === updated.id
                ? { ...s, device: { ...s.device, ...updated } }
                : s;
            return { ...prev, now: new Date(), realtimeOn: true, snap: merged };
          });
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setCo((prev) => ({ ...prev, realtimeOn: true }));
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setCo((prev) => ({ ...prev, realtimeOn: false }));
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
    // Re-subscribe when the snapshot turns live (demo → configured).
  }, [co.initial.source]);

  // Polling fallback while nothing flows through the socket.
  useEffect(() => {
    if (co.realtimeOn) return;
    const t = setInterval(() => router.refresh(), 30_000);
    return () => clearInterval(t);
  }, [co.realtimeOn, router]);

  return <DashboardView snap={co.snap} now={co.now} />;
}
