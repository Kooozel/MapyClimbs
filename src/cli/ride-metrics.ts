/**
 * ride-metrics.ts — moving-time and heart-rate aggregation over a ride's
 * trackpoint stream. Pure: no I/O, no dependency on the climb engine.
 *
 * Moving time is not optional. One climb in the evidence set reads 118 minutes
 * elapsed against 79:44 moving; VAM computed on elapsed time is meaningless.
 */

import type { RidePoint } from "./garmin-gpx";

/** Bounds that decide whether a sample-to-sample interval counts as moving. */
export interface MovingOptions {
  /** Minimum speed in m/s for an interval to count. */
  minSpeedMps: number;
  /** Intervals longer than this (seconds) are recording gaps, not riding. */
  maxGapSec: number;
}

/** Defaults validated against six Garmin rides. */
export const DEFAULT_MOVING: MovingOptions = { minSpeedMps: 0.8, maxGapSec: 30 };

/**
 * Four ascending bpm boundaries `a < b < c < d` defining five zones:
 * Z1 `< a`, Z2 `[a, b)`, Z3 `[b, c)`, Z4 `[c, d)`, Z5 `>= d`.
 *
 * Never hardcoded — these are personal data and this is a public repo.
 */
export type HrZones = readonly [number, number, number, number];

export interface WindowMetrics {
  /** Sum of moving interval durations, in seconds. */
  movingSec: number;
  /** Wall-clock span of the window, in seconds. */
  elapsedSec: number;
  /** Duration-weighted mean HR over moving intervals, or null. */
  avgHr: number | null;
  /** Peak HR anywhere in the window, moving or not, or null. */
  maxHr: number | null;
  /** Moving seconds in Z1..Z5, or null when no zones were supplied. */
  zoneSec: [number, number, number, number, number] | null;
  /** Moving seconds at or above the Z4 boundary, or null when no zones. */
  z4z5Sec: number | null;
}

/**
 * Aggregate the point stream over the inclusive index range [from, to].
 *
 * Heart rate is weighted by interval duration rather than sample count: Garmin
 * smart recording produces uneven spacing (gaps of 20 s or more appear between
 * consecutive samples), so an unweighted mean over-counts dense stretches.
 * Only moving intervals feed the average and the zone split, which keeps a long
 * stop from dragging the average down. `maxHr` deliberately spans the whole
 * window — a peak is a peak, whether or not the bike was rolling at that moment.
 */
export function aggregateWindow(
  points: RidePoint[],
  from: number,
  to: number,
  zones: HrZones | null,
  moving: MovingOptions = DEFAULT_MOVING
): WindowMetrics {
  const zoneSec: [number, number, number, number, number] = [0, 0, 0, 0, 0];

  let movingSec = 0;
  let hrWeightedSum = 0;
  let hrWeight = 0;
  let maxHr: number | null = null;

  const lo = Math.max(0, from);
  const hi = Math.min(points.length - 1, to);

  for (let i = lo; i <= hi; i++) {
    const hr = points[i].hr;
    if (hr !== null && (maxHr === null || hr > maxHr)) maxHr = hr;
  }

  for (let i = lo + 1; i <= hi; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    if (prev.t === null || curr.t === null) continue;

    const dt = curr.t - prev.t;
    if (dt <= 0 || dt >= moving.maxGapSec) continue;
    if ((curr.d - prev.d) / dt < moving.minSpeedMps) continue;

    movingSec += dt;

    // The sample at the end of the interval carries the HR for that interval.
    const hr = curr.hr;
    if (hr === null) continue;

    hrWeightedSum += hr * dt;
    hrWeight += dt;
    if (zones) zoneSec[zoneIndex(hr, zones)] += dt;
  }

  const startTime = points[lo]?.t;
  const endTime = points[hi]?.t;
  const elapsedSec =
    startTime != null && endTime != null && endTime > startTime ? endTime - startTime : 0;

  return {
    movingSec,
    elapsedSec,
    avgHr: hrWeight > 0 ? hrWeightedSum / hrWeight : null,
    maxHr,
    zoneSec: zones ? zoneSec : null,
    z4z5Sec: zones ? zoneSec[3] + zoneSec[4] : null,
  };
}

/** Zone bucket 0..4 for a heart rate. Boundaries are inclusive lower bounds. */
export function zoneIndex(hr: number, zones: HrZones): number {
  if (hr < zones[0]) return 0;
  if (hr < zones[1]) return 1;
  if (hr < zones[2]) return 2;
  if (hr < zones[3]) return 3;
  return 4;
}

/**
 * Parse a `--zones a,b,c,d` argument into four ascending bpm boundaries.
 * Throws with an actionable message on anything malformed.
 */
export function parseZones(spec: string): HrZones {
  const parts = spec.split(",").map((part) => part.trim());
  if (parts.length !== 4) {
    throw new Error(`--zones needs 4 comma-separated bpm boundaries, got ${parts.length}`);
  }

  const values = parts.map((part) => {
    const value = Number(part);
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`--zones: "${part}" is not a positive whole-number bpm`);
    }
    return value;
  });

  for (let i = 1; i < values.length; i++) {
    if (values[i] <= values[i - 1]) {
      throw new Error(`--zones boundaries must strictly ascend, got "${spec}"`);
    }
  }

  return [values[0], values[1], values[2], values[3]];
}

/**
 * Index of the first point at or past `distanceM` along the track.
 *
 * Climb boundaries come back from the engine on the same cumulative-distance
 * axis as the raw trackpoints: resamplePoints() only drops points closer than
 * RESAMPLE_MIN_INTERVAL_M and interpolateProfile() only inserts points at real
 * distances — neither reparametrizes — so the two can be matched directly.
 */
export function indexAtDistance(points: RidePoint[], distanceM: number): number {
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].d < distanceM) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
