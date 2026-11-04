/**
 * Shared water-level math — the single source of truth for both the
 * ESP32 firmware and the server-side ingest API.
 *
 * Conventions (identical on device and server):
 *  - `emptyDistanceCm` (D0): sensor → water-surface distance measured during
 *    calibration with the container EMPTY. It is the reference plane, not
 *    necessarily the physical container height.
 *  - `distanceCm` (d): current sensor → water-surface distance.
 *  - water_height_cm = D0 − d        (0 when empty, D0 when "full")
 *  - percent         = (D0 − d)/D0 × 100, clamped 0…100
 *  - free_space_cm   = d              (water surface up to the reference plane)
 *
 * Example (from the project outline):  D0 = 27.0, d = 8.6
 *   → height 18.4 cm, percent 68 %, free space 8.6 cm
 */

/** HC-SR04 style sensor: echoes closer than ~2 cm are unreliable. */
export const SENSOR_MIN_DISTANCE_CM = 2
/** HC-SR04 style sensor: max unobstructed range (~4 m). */
export const SENSOR_MAX_DISTANCE_CM = 400

/** A distance this far beyond the calibration reference is treated as invalid. */
export const DISTANCE_OVERFLOW_MARGIN_FACTOR = 1.2

export type LevelSummary = {
  distanceCm: number
  waterHeightCm: number
  waterLevelPercent: number
  freeSpaceCm: number
  sensorValid: boolean
}

export function round(value: number, digits: number): number {
  const f = 10 ** digits
  return Math.round(value * f) / f
}

/** Clamp a number into [min, max]; returns NaN as min. */
export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

/**
 * Check whether a raw sensor distance is physically plausible for
 * a container calibrated at `emptyDistanceCm`.
 */
export function isDistancePlausible(
  distanceCm: number,
  emptyDistanceCm: number,
): boolean {
  return (
    Number.isFinite(distanceCm) &&
    Number.isFinite(emptyDistanceCm) &&
    emptyDistanceCm > 0 &&
    distanceCm >= SENSOR_MIN_DISTANCE_CM &&
    distanceCm <= Math.max(
      SENSOR_MAX_DISTANCE_CM,
      emptyDistanceCm * DISTANCE_OVERFLOW_MARGIN_FACTOR,
    )
  )
}

/**
 * Derive the full level summary from a raw sensor distance.
 * Invalid readings are reported with `sensorValid: false` and zeros elsewhere
 * — invalid readings are still worth storing (see `device_events.sensor_error`).
 */
export function computeLevel(
  distanceCm: number,
  emptyDistanceCm: number,
): LevelSummary {
  if (!isDistancePlausible(distanceCm, emptyDistanceCm)) {
    return {
      distanceCm: Number.isFinite(distanceCm) ? round(distanceCm, 2) : 0,
      waterHeightCm: 0,
      waterLevelPercent: 0,
      freeSpaceCm: 0,
      sensorValid: false,
    }
  }
  const waterHeightCm = Math.max(0, emptyDistanceCm - distanceCm)
  const percent = clamp((waterHeightCm / emptyDistanceCm) * 100, 0, 100)
  return {
    distanceCm: round(distanceCm, 2),
    waterHeightCm: round(waterHeightCm, 2),
    waterLevelPercent: round(percent, 1),
    freeSpaceCm: round(distanceCm, 2),
    sensorValid: true,
  }
}

export type LevelStatus =
  | 'empty'
  | 'low'
  | 'medium'
  | 'high'
  | 'very-high'
  | 'overflow-risk'

export function levelStatus(percent: number): LevelStatus {
  if (percent >= 90) return 'overflow-risk'
  if (percent >= 75) return 'very-high'
  if (percent >= 50) return 'high'
  if (percent >= 25) return 'medium'
  if (percent >= 5) return 'low'
  return 'empty'
}

export const LEVEL_STATUS_LABEL: Record<LevelStatus, string> = {
  empty: 'Empty',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  'very-high': 'Very high',
  'overflow-risk': 'Near overflow',
}
