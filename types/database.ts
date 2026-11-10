/**
 * Database row types for the Water Monitor schema (supabase/schema.sql).
 * Keep in sync with the SQL — regenerating from the Supabase CLI
 * (`supabase gen types`) is a later refinement.
 */

export type UserProfile = {
  id: string
  email: string | null
  full_name: string | null
  created_at: string
}

export type Device = {
  id: string
  user_id: string
  device_code: string
  device_name: string
  /** SHA-256 of the plaintext API key — only the API route touches this. */
  api_key_hash: string
  /** Last 4 chars of the plaintext key, for the UI ("wm_…a1b2"). */
  api_key_prefix: string
  firmware_version: string | null
  interval_seconds: number
  threshold_led25: number
  threshold_led50: number
  threshold_led75: number
  threshold_buzzer: number
  calibration_pending: boolean
  last_wifi_rssi: number | null
  is_online: boolean
  /** Grace window uses interval_seconds — computed, never trusted as truth. */
  last_seen: string | null
  created_at: string
}

export type Container = {
  id: string
  device_id: string
  container_number: number | null
  container_name: string
  empty_distance_cm: number
  is_active: boolean
  calibrated_at: string
  created_at: string
}

export type Reading = {
  id: number
  device_id: string
  container_id: string
  distance_cm: number
  water_height_cm: number
  water_level_percent: number
  free_space_cm: number
  sensor_valid: boolean
  recorded_at: string
  /* SmartFill 2.0 pump fields (schema-pump.sql). Optional until the
     migration has run — older rows and demo data simply omit them. */
  /** ACTUAL relay state reported by the ESP32 (optional/legacy rows). */
  pump_status?: boolean | null
  /** Control mode the device ran in: AUTO | MANUAL (optional/legacy rows). */
  control_mode?: ControlMode | null
  /** Current continuous run duration in seconds (optional/legacy rows). */
  pump_runtime_seconds?: number | null
}

export type ControlMode = "AUTO" | "MANUAL"

export type PumpState = "ON" | "OFF"

/** One CURRENT command per device — the website's request to the ESP32. */
export type DeviceCommand = {
  id: number
  device_code: string
  mode: ControlMode
  pump: PumpState
  updated_at: string
  expires_at: string | null
  updated_by: string | null
  acknowledged_at: string | null
}

export type PumpEventType = "STARTED" | "STOPPED"

/** An ACTUAL pump transition (recorded once per real relay change). */
export type PumpEvent = {
  id: number
  device_code: string
  event_type: PumpEventType
  occurred_at: string
  runtime_seconds: number | null
  stop_reason: string | null
}

export type DeviceEventType =
  | 'device_connected'
  | 'device_disconnected'
  | 'calibration_completed'
  | 'container_changed'
  | 'sensor_error'
  | 'water_level_90'

export type DeviceEvent = {
  id: number
  device_id: string
  container_id: string | null
  event_type: DeviceEventType
  message: string | null
  created_at: string
}

/** Returned once by the registration action — never stored in plaintext. */
export type DeviceWithApiKey = Device & { api_key: string }
