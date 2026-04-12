/**
 * format.ts — Shared formatting utilities.
 */

/** Converts meters to km as a display string. */
export function metersToKm(meters: number, decimals = 1): string {
  return (meters / 1000).toFixed(decimals);
}

/** Converts meters to km as a number for calculations. */
export function metersToKmNum(meters: number): number {
  return meters / 1000;
}

export function toPercent(value: number, decimals = 1): string {
  return value.toFixed(decimals) + "%";
}

export function ratioToPercent(part: number, total: number, decimals = 1): string {
  return toPercent(total !== 0 ? (part / total) * 100 : 0, decimals);
}

/** Formats a duration in minutes as e.g. "1h 23min" or "45 min". */
export function formatMinutes(minutes: number): string {
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}h ${Math.round(minutes % 60)}min`
    : `${Math.round(minutes)} min`;
}
