import "server-only";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role client — BYPASSES Row Level Security.
 *
 * Use ONLY in server-only code (API routes, server actions):
 *   - /api/readings        (ESP32 device ingest)
 *   - device registration  (API-key creation)
 *   - calibration          (container creation / activation)
 *
 * Never import this from a client component and never reference the
 * service-role key in anything prefixed NEXT_PUBLIC_*.
 */
export function createSupabaseServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY — check .env.local / Vercel env vars.",
    );
  }

  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
