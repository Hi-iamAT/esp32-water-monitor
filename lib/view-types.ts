/**
 * Shared view-model types (client-safe — no "server-only").
 * The data layer (lib/data.ts, server-only) implements fetchers that
 * produce these shapes, with identical demo-mode fallbacks.
 */

import type {
  Container,
  Device,
  DeviceCommand,
  DeviceEvent,
  PumpEvent,
  Reading,
} from "@/types/database";

export type Source = "live" | "mock";

/** Device enriched with a derived connectivity flag (see deriveOnline). */
export type DeviceWithOnline = Device & { online: boolean };

export type DashboardSnapshot = {
  source: Source;
  /** ISO timestamp the snapshot was assembled (request time). */
  now: string;
  device: DeviceWithOnline | null;
  activeContainer: Container | null;
  latestReading: Reading | null;
  recentReadings: Reading[];
  /* SmartFill 2.0 pump data (nulls/empty until schema-pump.sql runs) */
  /** Current stored command for the device (null = AUTO/OFF default). */
  command: DeviceCommand | null;
  /** Orphaned? never — recent ACTUAL pump transitions, newest first. */
  pumpEvents: PumpEvent[];
  /** Pump runtime today in seconds (stopped events + current run). */
  todayPumpSeconds: number | null;
  /** Number of pump STARTED transitions today (filling cycles). */
  cyclesToday: number | null;
};

export type ContainersData = {
  source: Source;
  devices: Device[];
  containers: Array<
    Omit<Container, "empty_distance_cm"> & {
      empty_distance_cm: number;
      current_reading: Reading | null;
    }
  >;
};

export type HistoryData = {
  source: Source;
  containers: Array<Pick<Container, "id" | "container_name" | "device_id">>;
  selectedContainerId: string | null;
  fromDate: string | null;
  toDate: string | null;
  readings: Reading[];
};

export type DevicesData = {
  source: Source;
  devices: DeviceWithOnline[];
  events: DeviceEvent[];
  containersByDevice: Record<string, Container[]>;
};

export type SettingsData = {
  source: Source;
  profile: {
    id: string;
    email: string | null;
    full_name: string | null;
  } | null;
  devices: DeviceWithOnline[];
  containers: Container[];
};
