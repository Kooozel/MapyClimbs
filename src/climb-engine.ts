/**
 * climb-engine.ts — MapyClimbs
 * Pure climb-detection algorithm. No Chrome APIs — fully testable in isolation.
 *
 * Public API
 * ----------
 *   detectClimbs(elevationData) → Climb[]
 *
 * Where elevationData is an array of [distance_m, elevation_m, lat, lon] tuples
 * as produced by gpx-parser.ts, and Climb is defined in types.ts.
 */

import type { ClimbCategory, Climb, Coords, ElevationTuple, GpsPoint, RawClimb, Segment } from "./types";

// ─── Pipeline entry point ────────────────────────────────────────────────────

/**
 * Climb Detection Algorithm — 7-step pipeline.
 * See types.ts for the Climb interface definition.
 *
 * @param elevationData - [[distance_m, elevation_m, lat, lon], ...]
 */
export function detectClimbs(elevationData: ElevationTuple[]): Climb[] {
  if (!elevationData || elevationData.length < 2) return [];

  // Step 1: Build structured profile from raw tuples
  const profile: GpsPoint[] = elevationData.map((point) => ({
    distance: point[0],
    elevation: point[1],
    lat: point[2] ?? null,
    lon: point[3] ?? null,
  }));

  // Step 2: Remove GPS micro-jitter
  const resampled = resamplePoints(profile);

  // Step 3: Smooth elevation, compute per-segment gradients
  const smoothed = smoothElevationProfile(resampled);
  const segments = calculateGradients(smoothed);

  // Step 4: Detect raw climbs and merge nearby valleys
  const rawClimbs = identifyClimbs(segments);
  const mergedClimbs = mergeNearbyClimbs(rawClimbs, segments);

  // Step 5: Trim flat lead-in/tail, categorize
  let processedClimbs: Climb[] = mergedClimbs
    .map((climb) => {
      const trimmed = trimClimbEndpoints(climb);
      return trimmed.totalDistance > 0 && trimmed.totalElevation > 0
        ? categorizeClimb(trimmed)
        : null;
    })
    .filter((c): c is Climb => c !== null);

  // Step 6: Split climbs with >400 m of <2% grade
  processedClimbs = processedClimbs.flatMap((climb) => splitAntiGreenClimbs(climb));

  // Step 7: Re-merge adjacent splits with a tighter 1500 m threshold
  if (processedClimbs.length > 1) {
    const reMerged = mergeNearbyClimbs(processedClimbs, segments, 1500);
    processedClimbs = reMerged
      .map((c): Climb | null => {
        if (!("totalDistance" in c)) return c; // unchanged — already a Climb
        const trimmed = trimClimbEndpoints(c);
        return trimmed.totalDistance > 0 && trimmed.totalElevation > 0
          ? categorizeClimb(trimmed)
          : null;
      })
      .filter((c): c is Climb => c !== null);
  }

  return processedClimbs;
}

// ─── Step 2: Resampling ───────────────────────────────────────────────────────

export function resamplePoints(profile: GpsPoint[]): GpsPoint[] {
  if (profile.length <= 2) return profile;

  const RESAMPLE_THRESHOLD = 12; // metres
  const resampled: GpsPoint[] = [profile[0]];

  for (let i = 1; i < profile.length; i++) {
    const prev = resampled[resampled.length - 1];
    const curr = profile[i];
    if (curr.distance - prev.distance >= RESAMPLE_THRESHOLD) {
      resampled.push(curr);
    }
  }

  if (resampled[resampled.length - 1].distance !== profile[profile.length - 1].distance) {
    resampled.push(profile[profile.length - 1]);
  }

  return resampled;
}

// ─── Step 3: Smoothing ────────────────────────────────────────────────────────

export function smoothElevationProfile(profile: GpsPoint[]): GpsPoint[] {
  if (profile.length <= 2) return profile;

  // Pass 1: estimate local gradient magnitude (two-pointer O(n))
  const localGradients = new Array<number>(profile.length);
  let lo = 0,
    hi = 0;
  let sumGrad = 0,
    sumWeight = 0;
  const GRAD_WINDOW = 500;

  for (let i = 0; i < profile.length; i++) {
    const center = profile[i].distance;

    while (hi < profile.length && profile[hi].distance - center <= GRAD_WINDOW) {
      const dist = Math.abs(profile[hi].distance - center);
      const weight = 1 - dist / GRAD_WINDOW;
      const eleChange = Math.abs(profile[hi].elevation - profile[i].elevation);
      const grad = dist > 0 ? eleChange / dist : 0;
      sumGrad += grad * weight;
      sumWeight += weight;
      hi++;
    }

    while (lo < i && center - profile[lo].distance > GRAD_WINDOW) {
      const dist = Math.abs(profile[lo].distance - center);
      const weight = 1 - dist / GRAD_WINDOW;
      const eleChange = Math.abs(profile[lo].elevation - profile[i].elevation);
      const grad = dist > 0 ? eleChange / dist : 0;
      sumGrad -= grad * weight;
      sumWeight -= weight;
      lo++;
    }

    localGradients[i] = sumWeight > 0 ? sumGrad / sumWeight : 0;
  }

  // Pass 2: rolling average with adaptive window (two-pointer O(n))
  const smoothed = new Array<GpsPoint>(profile.length);
  let wlo = 0,
    whi = 0;
  let wSumElev = 0,
    wCount = 0;

  for (let i = 0; i < profile.length; i++) {
    const localGrad = localGradients[i];

    let windowMeters: number;
    if (localGrad > 0.08) {
      windowMeters = 50;
    } else if (localGrad > 0.03) {
      windowMeters = 50 + ((0.08 - localGrad) / 0.05) * 100;
    } else {
      windowMeters = 150 + ((0.03 - localGrad) / 0.03) * 100;
    }
    windowMeters = Math.max(50, Math.min(250, windowMeters));

    const center = profile[i].distance;

    while (whi < profile.length && profile[whi].distance - center <= windowMeters) {
      wSumElev += profile[whi].elevation;
      wCount++;
      whi++;
    }
    while (wlo < i && center - profile[wlo].distance > windowMeters) {
      wSumElev -= profile[wlo].elevation;
      wCount--;
      wlo++;
    }

    smoothed[i] = {
      distance: profile[i].distance,
      elevation: wCount > 0 ? wSumElev / wCount : profile[i].elevation,
      lat: profile[i].lat,
      lon: profile[i].lon,
    };
  }

  return filterNoiseSpikes(smoothed);
}

function filterNoiseSpikes(profile: GpsPoint[]): GpsPoint[] {
  if (profile.length <= 2) return profile;

  const SPIKE_THRESHOLD = 0.12;
  const NEIGHBOR_THRESHOLD = 0.08;

  const result: GpsPoint[] = profile.map((p) => ({ ...p }));
  const original = profile;

  for (let i = 1; i < result.length - 1; i++) {
    const prev = original[i - 1];
    const curr = original[i];
    const next = original[i + 1];

    const prevGrad = Math.abs(
      (curr.elevation - prev.elevation) / (curr.distance - prev.distance)
    );
    const nextGrad = Math.abs(
      (next.elevation - curr.elevation) / (next.distance - curr.distance)
    );

    if (
      (prevGrad > SPIKE_THRESHOLD && nextGrad < NEIGHBOR_THRESHOLD) ||
      (nextGrad > SPIKE_THRESHOLD && prevGrad < NEIGHBOR_THRESHOLD)
    ) {
      result[i] = { ...result[i], elevation: (prev.elevation + next.elevation) / 2 };
    }
  }

  return result;
}

// ─── Step 3b: Gradient calculation ──────────────────────────────────────────

function calculateGradients(profile: GpsPoint[]): Segment[] {
  const segments: Segment[] = [];

  for (let i = 1; i < profile.length; i++) {
    const prev = profile[i - 1];
    const curr = profile[i];

    const distanceDelta = curr.distance - prev.distance;
    const elevationDelta = curr.elevation - prev.elevation;
    const gradient = distanceDelta > 0 ? (elevationDelta / distanceDelta) * 100 : 0;

    segments.push({
      startDistance: prev.distance,
      endDistance: curr.distance,
      distance: distanceDelta,
      elevation: elevationDelta,
      gradient,
      startElevation: prev.elevation,
      endElevation: curr.elevation,
      startLat: prev.lat,
      startLon: prev.lon,
      endLat: curr.lat,
      endLon: curr.lon,
    });
  }

  return segments;
}

// ─── Step 4: Climb identification ────────────────────────────────────────────

function identifyClimbs(segments: Segment[]): RawClimb[] {
  const CLIMB_START_GRADE = 2;
  const MIN_CLIMB_DISTANCE = 300;
  const MIN_CLIMB_ELEV = 30;
  const DESCENT_GRADE = -1;
  const DESCENT_DISTANCE = 150;
  const MIN_AVG_GRADE = 2;

  const climbs: RawClimb[] = [];
  let currentClimb: RawClimb | null = null;
  let descentDistance = 0;

  for (const segment of segments) {
    if (segment.gradient <= DESCENT_GRADE) {
      descentDistance += segment.distance;
    } else {
      descentDistance = 0;
    }

    if (segment.gradient >= CLIMB_START_GRADE && currentClimb === null) {
      currentClimb = { segments: [segment], totalDistance: segment.distance, totalElevation: segment.elevation };
      descentDistance = 0;
    } else if (currentClimb !== null) {
      currentClimb.segments.push(segment);
      currentClimb.totalDistance += segment.distance;
      currentClimb.totalElevation += segment.elevation;

      if (descentDistance >= DESCENT_DISTANCE) {
        if (currentClimb.totalDistance >= MIN_CLIMB_DISTANCE) {
          pushClimb(currentClimb, climbs, MIN_CLIMB_DISTANCE, MIN_CLIMB_ELEV, MIN_AVG_GRADE);
        }
        currentClimb = null;
        descentDistance = 0;
      }
    }
  }

  if (currentClimb && currentClimb.totalDistance >= MIN_CLIMB_DISTANCE) {
    pushClimb(currentClimb, climbs, MIN_CLIMB_DISTANCE, MIN_CLIMB_ELEV, MIN_AVG_GRADE);
  }

  return climbs;
}

function pushClimb(
  climb: RawClimb,
  climbs: RawClimb[],
  minDist: number,
  minElev: number,
  minGrade: number
): void {
  const candidate: RawClimb = { ...climb, segments: [...climb.segments] };

  while (
    candidate.segments.length > 0 &&
    candidate.segments[candidate.segments.length - 1].gradient < 0
  ) {
    const removed = candidate.segments.pop()!;
    candidate.totalDistance -= removed.distance;
    candidate.totalElevation -= removed.elevation;
  }

  if (candidate.segments.length === 0 || candidate.totalDistance <= 0) return;

  const avgGrade = (candidate.totalElevation / candidate.totalDistance) * 100;

  if (
    candidate.totalDistance >= minDist &&
    candidate.totalElevation >= minElev &&
    avgGrade >= minGrade
  ) {
    climbs.push(candidate);
  }
}

// ─── Step 4 (cont): Merging ───────────────────────────────────────────────────

export function mergeNearbyClimbs(
  climbs: RawClimb[],
  allSegments: Segment[],
  maxGapDistance?: number
): RawClimb[];
export function mergeNearbyClimbs(
  climbs: Climb[],
  allSegments: Segment[],
  maxGapDistance?: number
): (Climb | RawClimb)[];
export function mergeNearbyClimbs(
  climbs: (RawClimb | Climb)[],
  allSegments: Segment[],
  maxGapDistance = 2000
): (RawClimb | Climb)[] {
  if (climbs.length <= 1) return climbs;

  const MAX_VALLEY_DROP_ABS = 50;
  const RELATIVE_VALLEY_RATIO = 0.15;

  const getGain = (c: RawClimb | Climb): number =>
    "totalElevation" in c ? c.totalElevation : c.elevation;

  const result: (RawClimb | Climb)[] = [climbs[0]];

  for (let i = 1; i < climbs.length; i++) {
    const prev = result[result.length - 1];
    const curr = climbs[i];

    const prevLastSeg = prev.segments[prev.segments.length - 1];
    const currFirstSeg = curr.segments[0];

    const gapDistance = currFirstSeg.startDistance - prevLastSeg.endDistance;
    const elevDrop = prevLastSeg.endElevation - currFirstSeg.startElevation;
    const combinedGain = getGain(prev) + getGain(curr);
    const maxAllowedDrop = Math.max(MAX_VALLEY_DROP_ABS, combinedGain * RELATIVE_VALLEY_RATIO);

    if (gapDistance >= 0 && gapDistance <= maxGapDistance && elevDrop <= maxAllowedDrop) {
      const gapSegs = allSegments.filter(
        (s) =>
          s.startDistance >= prevLastSeg.endDistance - 0.1 &&
          s.startDistance < currFirstSeg.startDistance
      );

      const mergedSegs = [...prev.segments, ...gapSegs, ...curr.segments];
      let totalDist = 0,
        totalElev = 0;
      for (const s of mergedSegs) {
        totalDist += s.distance;
        totalElev += s.elevation;
      }

      result[result.length - 1] = {
        segments: mergedSegs,
        totalDistance: totalDist,
        totalElevation: totalElev,
      };
    } else {
      result.push(curr);
    }
  }

  return result;
}

// ─── Step 5: Trim + categorize ────────────────────────────────────────────────

function trimClimbEndpoints(climb: RawClimb): RawClimb {
  const TRIM_THRESHOLD = 1.5;
  const MIN_REMAINING = 100;

  const trimmed: RawClimb = { ...climb, segments: [...climb.segments] };
  if (!trimmed.segments || trimmed.segments.length === 0) return trimmed;

  let startIndex = 0;
  while (startIndex < trimmed.segments.length && trimmed.segments[startIndex].gradient < TRIM_THRESHOLD) {
    startIndex++;
  }

  let endIndex = trimmed.segments.length - 1;
  while (endIndex >= 0 && trimmed.segments[endIndex].gradient < TRIM_THRESHOLD) {
    endIndex--;
  }

  if (startIndex > endIndex) {
    return { segments: [], totalDistance: 0, totalElevation: 0 };
  }

  const climbSegments = trimmed.segments.slice(startIndex, endIndex + 1);
  let newDistance = 0,
    newElev = 0;
  for (const seg of climbSegments) {
    newDistance += seg.distance;
    newElev += seg.elevation;
  }

  if (newDistance >= MIN_REMAINING) {
    return { segments: climbSegments, totalDistance: newDistance, totalElevation: newElev };
  }

  return { segments: [], totalDistance: 0, totalElevation: 0 };
}

export function categorizeClimb(climb: RawClimb): Climb | null {
  if (!climb || climb.totalDistance === 0 || climb.totalElevation === 0) return null;

  const distanceKm = climb.totalDistance / 1000;
  const avgGrade = (climb.totalElevation / climb.totalDistance) * 100;
  const difficulty = distanceKm * avgGrade * 100;

  let category: ClimbCategory = "4";
  if (difficulty >= 40000) category = "HC";
  else if (difficulty >= 16000) category = "1";
  else if (difficulty >= 8000) category = "2";
  else if (difficulty >= 3000) category = "3";

  const firstSeg = climb.segments[0];
  const lastSeg = climb.segments[climb.segments.length - 1];

  const markerCoords: Coords | null =
    firstSeg?.startLat != null && firstSeg?.startLon != null
      ? { lat: firstSeg.startLat, lon: firstSeg.startLon }
      : null;

  const endCoords: Coords | null =
    lastSeg?.endLat != null && lastSeg?.endLon != null
      ? { lat: lastSeg.endLat, lon: lastSeg.endLon }
      : null;

  return {
    distance: climb.totalDistance,
    elevation: climb.totalElevation,
    avgGrade,
    difficulty,
    category,
    segments: climb.segments,
    markerCoords,
    endCoords,
  };
}

// ─── Step 6: Anti-green splitting ────────────────────────────────────────────

function splitAntiGreenClimbs(climb: Climb): Climb[] {
  if (!climb || !climb.segments || climb.segments.length < 2) return [climb];

  const FLAT_THRESHOLD = 2;
  const FLAT_LENGTH_THRESHOLD = 400;
  const MINIMUM_CLIMB_DISTANCE = 300;
  const MINIMUM_CLIMB_ELEVATION = 30;
  const MINIMUM_CLIMB_GRADE = 2;

  interface SubClimb {
    distance: number;
    elevation: number;
    segments: Segment[];
    avgGrade: number;
    difficulty: number;
    category: ClimbCategory;
    markerCoords: Coords | null;
    endCoords: Coords | null;
  }

  const splits: SubClimb[] = [];
  let currentClimb: SubClimb | null = null;
  let flatDistance = 0;

  for (const seg of climb.segments) {
    if (seg.gradient < FLAT_THRESHOLD) {
      flatDistance += seg.distance;

      if (currentClimb) {
        currentClimb.segments.push(seg);
        currentClimb.distance += seg.distance;
        currentClimb.elevation += seg.elevation;
      }

      if (flatDistance >= FLAT_LENGTH_THRESHOLD && currentClimb) {
        while (
          currentClimb.segments.length > 0 &&
          currentClimb.segments[currentClimb.segments.length - 1].gradient < FLAT_THRESHOLD
        ) {
          const removed = currentClimb.segments.pop()!;
          currentClimb.distance -= removed.distance;
          currentClimb.elevation -= removed.elevation;
        }

        const avgGrade =
          currentClimb.distance > 0 ? (currentClimb.elevation / currentClimb.distance) * 100 : 0;
        if (
          currentClimb.distance >= MINIMUM_CLIMB_DISTANCE &&
          currentClimb.elevation >= MINIMUM_CLIMB_ELEVATION &&
          avgGrade >= MINIMUM_CLIMB_GRADE
        ) {
          currentClimb.avgGrade = avgGrade;
          splits.push(currentClimb);
        }
        currentClimb = null;
        flatDistance = 0;
      }
    } else {
      flatDistance = 0;

      if (!currentClimb) {
        currentClimb = {
          distance: 0,
          elevation: 0,
          segments: [],
          avgGrade: climb.avgGrade,
          difficulty: climb.difficulty,
          category: climb.category,
          markerCoords: null,
          endCoords: null,
        };
      }

      currentClimb.segments.push(seg);
      currentClimb.distance += seg.distance;
      currentClimb.elevation += seg.elevation;
    }
  }

  // Finalize trailing sub-climb
  if (currentClimb) {
    const avgGrade =
      currentClimb.distance > 0 ? (currentClimb.elevation / currentClimb.distance) * 100 : 0;
    if (
      currentClimb.distance >= MINIMUM_CLIMB_DISTANCE &&
      currentClimb.elevation >= MINIMUM_CLIMB_ELEVATION &&
      avgGrade >= MINIMUM_CLIMB_GRADE
    ) {
      currentClimb.avgGrade = avgGrade;
      splits.push(currentClimb);
    }
  }

  if (splits.length === 0) return [climb];

  // Stamp each sub-climb with its own start/end coords
  for (const sc of splits) {
    const first = sc.segments[0];
    const last = sc.segments[sc.segments.length - 1];
    sc.markerCoords =
      first?.startLat != null && first?.startLon != null
        ? { lat: first.startLat, lon: first.startLon }
        : null;
    sc.endCoords =
      last?.endLat != null && last?.endLon != null
        ? { lat: last.endLat, lon: last.endLon }
        : null;
  }

  return splits as Climb[];
}

// ─── Test exports ─────────────────────────────────────────────────────────────
export { resamplePoints as _resamplePoints, smoothElevationProfile as _smoothElevationProfile };
