/**
 * gradient-zones.ts — Shared gradient-zone logic for elevation profile coloring.
 *
 * Used by both:
 *   - content/chart.ts  — SVG elevation chart (static, no zoom dependency)
 *   - content/route-highlight.ts — map route polylines (may become zoom-aware)
 *
 * No DOM or browser-API dependencies — pure data transformation.
 */

import type { Segment } from "./types";
import { maxGradientOverWindow } from "./max-gradient";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ProfilePoint {
  distance: number;
  elevation: number;
  gradient: number;
}

export interface GradientZone {
  color: string;
  /** Cumulative distance from climb start where zone begins (metres). */
  start: number;
  /** Cumulative distance from climb start where zone ends (metres). */
  end: number;
}

/**
 * Optional filter applied to the computed gradient zones before they are
 * projected onto map polylines.  Receives the raw zone array, total climb
 * distance, and the current map zoom level.
 *
 * Intended future use: merge short zones at low zoom levels so the route
 * overlay stays readable.  Example:
 *
 * ```ts
 * const filter: ZoneFilterFn = (zones, total, zoom) =>
 *   mergeShortZones(zones, total * 0.07 * (14 / zoom));
 * ```
 *
 * When `undefined` the zones are used as-is.
 */
export type ZoneFilterFn = (
  zones: GradientZone[],
  totalDistance: number,
  zoom: number
) => GradientZone[];

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Cycling grade thresholds (3/6/9/12%) → fill color.
 * Each entry covers grades up-to-but-not-including its threshold.
 * Last entry uses Infinity to capture all steeper grades.
 */
export const CYCLING_GRADE_COLORS: [number, string][] = [
  [3, "#4CAF50"],
  [6, "#FBC02D"],
  [9, "#F57C00"],
  [12, "#D32F2F"],
  [15, "#800020"],
  [Infinity, "#3B0010"],
];

/** Hiking grade thresholds (5/10/20/30%) — wider bands reflect walking pace. */
export const HIKING_GRADE_COLORS: [number, string][] = [
  [5, "#4CAF50"],
  [10, "#FBC02D"],
  [20, "#F57C00"],
  [30, "#D32F2F"],
  [40, "#800020"],
  [Infinity, "#3B0010"],
];

/** Minimum span (m) a chart pitch must cover to be reported as the max grade.
 *  Simplified-profile points normally sit far further apart than this, so the
 *  floor only rejects sub-25 m simplification artefacts rather than acting as a
 *  real averaging window. */
export const CHART_PITCH_MIN_SPAN_M = 25;

// ── Helpers ───────────────────────────────────────────────────────────────────

export function segmentGradient(a: ProfilePoint, b: ProfilePoint): number {
  const dD = b.distance - a.distance;
  return dD > 0 ? ((b.elevation - a.elevation) / dD) * 100 : 0;
}

// ── Public functions ──────────────────────────────────────────────────────────

/** Returns the hex color for a given gradient percentage using the supplied color table. */
export function getColorForGrade(
  g: number,
  gradeColors: [number, string][] = CYCLING_GRADE_COLORS
): string {
  return gradeColors.find(([threshold]) => g < threshold)![1];
}

/**
 * Builds a flat array of profile points from climb segments.
 * Distance is cumulative from 0, matching the coordinate system used by
 * `buildGradientZones` and `buildGeoPoints` in route-highlight.ts.
 */
export function buildProfilePoints(segments: Segment[]): ProfilePoint[] {
  const profile: ProfilePoint[] = [];
  let cumulDist = 0;
  for (const seg of segments) {
    profile.push({ distance: cumulDist, elevation: seg.startElevation, gradient: seg.gradient });
    cumulDist += seg.distance;
  }
  profile.push({
    distance: cumulDist,
    elevation: segments[segments.length - 1].endElevation,
    gradient: 0,
  });
  return profile;
}

/**
 * Reduces a dense profile to 8–20 key inflection points.
 * Preserves gradient change points, then fills any large distance gaps so no
 * portion of the route is skipped in the chart. Falls back to even-step
 * sampling when too many gradient-change points exist.
 */
export function simplifyProfile(profile: ProfilePoint[]): ProfilePoint[] {
  if (profile.length <= 3) return profile;
  const maxSegs = Math.min(20, Math.max(8, Math.ceil(profile.length / 3)));
  const grads = profile.slice(0, -1).map((p) => p.gradient);

  let keys = [0];
  for (let i = 1; i < grads.length - 1; i++) {
    if (Math.abs(grads[i] - grads[i - 1]) >= 1.5) keys.push(i);
  }
  keys.push(profile.length - 1);

  if (keys.length > maxSegs) {
    keys = [0];
    const step = Math.floor(profile.length / maxSegs);
    for (let i = step; i < profile.length - 1; i += step) keys.push(i);
    keys.push(profile.length - 1);
  } else {
    // Fill large distance gaps so the chart covers the full route. Without
    // this, gradient inflections clustered near one end leave a long straight
    // line across the rest (most visible on short routes where the smoothing
    // window causes noisy gradients near the start).
    //
    // Gap-fill can exceed maxSegs — the limit is the profile itself, since
    // adding more bisection keys only improves chart accuracy.
    const totalDist = profile[profile.length - 1].distance;
    const maxGap = totalDist / (maxSegs - 1);
    const hardCap = profile.length;
    let changed = true;
    while (changed && keys.length < hardCap) {
      changed = false;
      for (let i = 0; i < keys.length - 1; i++) {
        const p0 = profile[keys[i]];
        const p1 = profile[keys[i + 1]];
        if (p1.distance - p0.distance <= maxGap) continue;
        // Find the profile point nearest the midpoint distance
        const midDist = (p0.distance + p1.distance) / 2;
        let best = keys[i] + 1;
        for (let j = best + 1; j < keys[i + 1]; j++) {
          if (Math.abs(profile[j].distance - midDist) < Math.abs(profile[best].distance - midDist))
            best = j;
        }
        // Only insert if the midpoint deviates from linear interpolation — a
        // perfectly uniform profile needs no extra points.
        const pb = profile[best];
        const linearElev =
          p0.elevation +
          ((pb.distance - p0.distance) / (p1.distance - p0.distance)) *
            (p1.elevation - p0.elevation);
        if (Math.abs(pb.elevation - linearElev) > 0.5) {
          keys.splice(i + 1, 0, best);
          changed = true;
          break;
        }
      }
    }
  }

  return [...new Set(keys)].sort((a, b) => a - b).map((i) => profile[i]);
}

/**
 * Returns the maximum *pitch* gradient (%) — the steepest span in the profile,
 * measured with the same geometric formula buildGradientZones colours with, so
 * the card's stat can never contradict the steepest colour band above it.
 *
 * Pass the *simplified* profile: its points sit far further apart than the
 * default floor, so at chart resolution this reports the steepest segment the
 * chart actually draws. For the wide-window "what you feel for 200 m" figure,
 * use computeMaxSustainedGradient (climb-engine.ts) — both are one scan
 * (max-gradient.ts) under two configurations.
 */
export function maxPitchGradient(
  profile: ProfilePoint[],
  minSpanM = CHART_PITCH_MIN_SPAN_M
): number {
  return maxGradientOverWindow(profile, minSpanM);
}

/**
 * Converts a profile into contiguous color zones.
 * Adjacent segments with the same color are merged into a single zone.
 */
export function buildGradientZones(
  profile: ProfilePoint[],
  gradeColors: [number, string][] = CYCLING_GRADE_COLORS
): GradientZone[] {
  const zones: GradientZone[] = [];
  for (let i = 0; i < profile.length - 1; i++) {
    const a = profile[i],
      b = profile[i + 1];
    const col = getColorForGrade(segmentGradient(a, b), gradeColors);
    if (zones.length === 0 || zones[zones.length - 1].color !== col) {
      zones.push({ color: col, start: a.distance, end: b.distance });
    } else {
      zones[zones.length - 1].end = b.distance;
    }
  }
  return zones;
}

/**
 * Merges zones shorter than `minLen` metres into their shortest neighbour.
 * Iterates until no zone shorter than `minLen` remains or only one zone is left.
 *
 * This is also the recommended starting-point for a zoom-aware `ZoneFilterFn`:
 * pass `minLen = totalDistance * 0.07 * (14 / zoom)` to merge more aggressively
 * at lower zoom levels.
 */
export function mergeShortZones(zones: GradientZone[], minLen: number): GradientZone[] {
  zones = zones.slice();
  let changed = true;
  while (changed && zones.length > 1) {
    changed = false;
    const si = zones.reduce(
      (mi, z, i) => (z.end - z.start < zones[mi].end - zones[mi].start ? i : mi),
      0
    );
    if (zones[si].end - zones[si].start >= minLen) break;

    const hasLeft = si > 0;
    const hasRight = si < zones.length - 1;
    if (hasLeft && hasRight) {
      const leftLen = zones[si - 1].end - zones[si - 1].start;
      const rightLen = zones[si + 1].end - zones[si + 1].start;
      if (leftLen >= rightLen) zones[si - 1].end = zones[si].end;
      else zones[si + 1].start = zones[si].start;
    } else if (hasLeft) {
      zones[si - 1].end = zones[si].end;
    } else {
      zones[si + 1].start = zones[si].start;
    }
    zones.splice(si, 1);
    changed = true;
  }
  return zones;
}

/**
 * Full pipeline: segments → simplified profile → gradient zones → optional filter.
 *
 * `zoneFilter`, `zoom`, and `gradeColors` are all optional; omitting them gives the
 * standard cycling-color unfiltered zone array (current behaviour).
 */
export function buildClimbZones(
  segments: Segment[],
  totalDistance: number,
  zoneFilter?: ZoneFilterFn,
  zoom?: number,
  gradeColors: [number, string][] = CYCLING_GRADE_COLORS
): GradientZone[] {
  const zones = buildGradientZones(simplifyProfile(buildProfilePoints(segments)), gradeColors);
  if (zoneFilter != null && zoom != null) {
    return zoneFilter(zones, totalDistance, zoom);
  }
  return zones;
}
