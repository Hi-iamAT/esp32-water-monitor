/**
 * Pure, client-safe helpers shared by server and client components.
 * (No "server-only" here — DashboardView renders inside the client bundle.)
 */

import type { Device } from "@/types/database";

/** Online ⇔ a reading arrived within 2× the configured interval. */
export function deriveOnline(device: Device, now: Date): boolean {
  if (!device.last_seen) return false;
  const ageMs = now.getTime() - new Date(device.last_seen).getTime();
  return ageMs <= Math.max(60, device.interval_seconds * 2) * 1000;
}

export function minutesAgo(
  iso: string | null,
  now: Date,
): number | null {
  if (!iso) return null;
  return Math.max(
    0,
    Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000),
  );
}

export function formatLastSeen(iso: string | null, now: Date): string {
  const minutes = minutesAgo(iso, now);
  if (minutes === null) return "never";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}
