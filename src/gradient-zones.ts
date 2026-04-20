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
 * Grade threshold → fill color.
 * Each entry covers grades up-to-but-not-including its threshold.
 * Last entry uses Infinity to capture all steeper grades.
 */
export const GRADE_COLORS: [number, string][] = [
  [3, "#4CAF50"],
  [6, "#FBC02D"],
  [9, "#F57C00"],
  [12, "#D32F2F"],
  [Infinity, "#800020"],
];

// ── Private helpers ───────────────────────────────────────────────────────────

function segmentGradient(a: ProfilePoint, b: ProfilePoint): number {
  const dD = b.distance - a.distance;
  return dD > 0 ? ((b.elevation - a.elevation) / dD) * 100 : 0;
}

// ── Public functions ──────────────────────────────────────────────────────────

/** Returns the hex color for a given gradient percentage. */
export function getColorForGrade(g: number): string {
  return GRADE_COLORS.find(([threshold]) => g < threshold)![1];
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
 * Preserves gradient change points; falls back to even-step sampling when
 * too many points exist.
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
  }

  return [...new Set(keys)].sort((a, b) => a - b).map((i) => profile[i]);
}

/**
 * Converts a profile into contiguous color zones.
 * Adjacent segments with the same color are merged into a single zone.
 */
export function buildGradientZones(profile: ProfilePoint[]): GradientZone[] {
  const zones: GradientZone[] = [];
  for (let i = 0; i < profile.length - 1; i++) {
    const a = profile[i],
      b = profile[i + 1];
    const col = getColorForGrade(segmentGradient(a, b));
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
 * `zoneFilter` and `zoom` are both optional; omitting them gives the standard
 * unfiltered zone array (current behaviour).
 */
export function buildClimbZones(
  segments: Segment[],
  totalDistance: number,
  zoneFilter?: ZoneFilterFn,
  zoom?: number
): GradientZone[] {
  const zones = buildGradientZones(simplifyProfile(buildProfilePoints(segments)));
  if (zoneFilter != null && zoom != null) {
    return zoneFilter(zones, totalDistance, zoom);
  }
  return zones;
}
