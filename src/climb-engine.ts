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

import type {
  Climb,
  Coords,
  ElevationTuple,
  GpsPoint,
  RawClimb,
  Segment,
  ScoringModel,
} from "./types";
import { applyScore } from "./scoring";
import {
  RESAMPLE_MIN_INTERVAL_M,
  SMOOTH_GRAD_WINDOW_M,
  SMOOTH_STEEP_GRADE_THRESHOLD,
  SMOOTH_MID_GRADE_THRESHOLD,
  SMOOTH_WINDOW_MIN_M,
  SMOOTH_WINDOW_MID_M,
  SMOOTH_WINDOW_MAX_M,
  SPIKE_GRADIENT_THRESHOLD,
  SPIKE_NEIGHBOR_THRESHOLD,
  CLIMB_START_GRADE_PCT,
  CLIMB_MIN_DISTANCE_M,
  CLIMB_MIN_ELEVATION_M,
  CLIMB_MIN_AVG_GRADE_PCT,
  DESCENT_END_GRADE_PCT,
  DESCENT_END_DISTANCE_M,
  CLIMB_END_FLAT_M,
  MERGE_MAX_GAP_M,
  MERGE_RE_MAX_GAP_M,
  MERGE_MAX_VALLEY_DROP_M,
  MERGE_VALLEY_RATIO,
  TRIM_MIN_GRADE_PCT,
  TRIM_MIN_DISTANCE_M,
  SPLIT_FLAT_GRADE_PCT,
  SPLIT_FLAT_LENGTH_M,
} from "./climb-engine.config";

// ─── Pipeline entry point ────────────────────────────────────────────────────

/**
 * Climb Detection Algorithm — 7-step pipeline.
 * See types.ts for the Climb interface definition.
 *
 * @param elevationData - [[distance_m, elevation_m, lat, lon], ...]
 */
export function detectClimbs(
  elevationData: ElevationTuple[],
  scoringModel: ScoringModel = "aso"
): Climb[] {
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
        ? categorizeClimb(trimmed, scoringModel)
        : null;
    })
    .filter((c): c is Climb => c !== null);

  // Step 6: Split climbs with >400 m of <2% grade
  processedClimbs = processedClimbs.flatMap((climb) =>
    splitAntiGreenClimbs(climb)
      .map((raw) => categorizeClimb(raw, scoringModel))
      .filter((c): c is Climb => c !== null)
  );

  // Step 7: Re-merge adjacent splits with a tighter 1500 m threshold
  if (processedClimbs.length > 1) {
    const reMerged = mergeNearbyClimbs(
      processedClimbs.map(toRawClimb),
      segments,
      MERGE_RE_MAX_GAP_M
    );
    processedClimbs = reMerged
      .map((raw): Climb | null => {
        const trimmed = trimClimbEndpoints(raw);
        return trimmed.totalDistance > 0 && trimmed.totalElevation > 0
          ? categorizeClimb(trimmed, scoringModel)
          : null;
      })
      .filter((c): c is Climb => c !== null);
  }

  return processedClimbs;
}

// ─── Step 2: Resampling ───────────────────────────────────────────────────────

export function resamplePoints(profile: GpsPoint[]): GpsPoint[] {
  if (profile.length <= 2) return profile;

  const resampled: GpsPoint[] = [profile[0]];

  for (let i = 1; i < profile.length; i++) {
    const prev = resampled[resampled.length - 1];
    const curr = profile[i];
    if (curr.distance - prev.distance >= RESAMPLE_MIN_INTERVAL_M) {
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

  // Pass 1: estimate local gradient magnitude.
  // Each gradient term is |elev_j − elev_i| / dist_ij — it references the
  // current centre point i, so it changes every iteration. A running-sum
  // two-pointer cannot be used here: the value added when j entered the window
  // (at some earlier i) differs from the value that would be subtracted when j
  // leaves (at the current i). On long routes the accumulated mismatch becomes
  // large enough to corrupt the window estimate and over-smooth climbs away.
  // Per-point scanning is correct and cheap: W ≤ 500 m, d ≥ 12 m → ≤ ~42 iters.
  //
  // Forward and backward estimates are computed separately and the MAX is taken.
  // A symmetric average caused flat terrain before a climb to suppress the
  // gradient estimate at the climb entry, assigning the widest smoothing window
  // and blurring out short climbs on long routes. Taking the max means that if
  // *either* direction contains steep terrain the narrower window is used.
  const localGradients = new Array<number>(profile.length);

  for (let i = 0; i < profile.length; i++) {
    const center = profile[i].distance;
    const centerElev = profile[i].elevation;

    let sumGradBack = 0,
      sumWeightBack = 0;
    for (let j = i; j >= 0 && center - profile[j].distance <= SMOOTH_GRAD_WINDOW_M; j--) {
      const dist = center - profile[j].distance;
      const weight = 1 - dist / SMOOTH_GRAD_WINDOW_M;
      const grad = dist > 0 ? Math.abs(profile[j].elevation - centerElev) / dist : 0;
      sumGradBack += grad * weight;
      sumWeightBack += weight;
    }

    let sumGradFwd = 0,
      sumWeightFwd = 0;
    for (
      let j = i + 1;
      j < profile.length && profile[j].distance - center <= SMOOTH_GRAD_WINDOW_M;
      j++
    ) {
      const dist = profile[j].distance - center;
      const weight = 1 - dist / SMOOTH_GRAD_WINDOW_M;
      const grad = Math.abs(profile[j].elevation - centerElev) / dist;
      sumGradFwd += grad * weight;
      sumWeightFwd += weight;
    }

    const backGrad = sumWeightBack > 0 ? sumGradBack / sumWeightBack : 0;
    const fwdGrad = sumWeightFwd > 0 ? sumGradFwd / sumWeightFwd : 0;
    localGradients[i] = Math.max(backGrad, fwdGrad);
  }

  // Pass 2: rolling average with adaptive window.
  // Per-point scanning avoids a stale-right-boundary bug that occurs when the
  // window shrinks (flat → steep segment): a forward-only two-pointer cannot
  // evict elements that were added while the window was wider.
  // Cost: O(W/d) per point where W ≤ 250 m and d ≥ 12 m, so ≤ ~21 iterations.
  const smoothed = new Array<GpsPoint>(profile.length);

  for (let i = 0; i < profile.length; i++) {
    const localGrad = localGradients[i];

    let windowMeters: number;
    if (localGrad > SMOOTH_STEEP_GRADE_THRESHOLD) {
      windowMeters = SMOOTH_WINDOW_MIN_M;
    } else if (localGrad > SMOOTH_MID_GRADE_THRESHOLD) {
      windowMeters =
        SMOOTH_WINDOW_MIN_M +
        ((SMOOTH_STEEP_GRADE_THRESHOLD - localGrad) /
          (SMOOTH_STEEP_GRADE_THRESHOLD - SMOOTH_MID_GRADE_THRESHOLD)) *
          (SMOOTH_WINDOW_MID_M - SMOOTH_WINDOW_MIN_M);
    } else {
      windowMeters =
        SMOOTH_WINDOW_MID_M +
        ((SMOOTH_MID_GRADE_THRESHOLD - localGrad) / SMOOTH_MID_GRADE_THRESHOLD) *
          (SMOOTH_WINDOW_MAX_M - SMOOTH_WINDOW_MID_M);
    }
    windowMeters = Math.max(SMOOTH_WINDOW_MIN_M, Math.min(SMOOTH_WINDOW_MAX_M, windowMeters));

    const center = profile[i].distance;
    let sumElev = 0,
      count = 0;

    for (let j = i; j >= 0 && center - profile[j].distance <= windowMeters; j--) {
      sumElev += profile[j].elevation;
      count++;
    }
    for (let j = i + 1; j < profile.length && profile[j].distance - center <= windowMeters; j++) {
      sumElev += profile[j].elevation;
      count++;
    }

    smoothed[i] = {
      distance: profile[i].distance,
      elevation: count > 0 ? sumElev / count : profile[i].elevation,
      lat: profile[i].lat,
      lon: profile[i].lon,
    };
  }

  return filterNoiseSpikes(smoothed);
}

function filterNoiseSpikes(profile: GpsPoint[]): GpsPoint[] {
  if (profile.length <= 2) return profile;

  const result: GpsPoint[] = profile.map((p) => ({ ...p }));
  const original = profile;

  for (let i = 1; i < result.length - 1; i++) {
    const prev = original[i - 1];
    const curr = original[i];
    const next = original[i + 1];

    const prevGrad = Math.abs((curr.elevation - prev.elevation) / (curr.distance - prev.distance));
    const nextGrad = Math.abs((next.elevation - curr.elevation) / (next.distance - curr.distance));

    if (
      (prevGrad > SPIKE_GRADIENT_THRESHOLD && nextGrad < SPIKE_NEIGHBOR_THRESHOLD) ||
      (nextGrad > SPIKE_GRADIENT_THRESHOLD && prevGrad < SPIKE_NEIGHBOR_THRESHOLD)
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
  const climbs: RawClimb[] = [];
  let currentClimb: RawClimb | null = null;
  let descentDistance = 0;
  let flatDistance = 0;

  for (const segment of segments) {
    if (segment.gradient <= DESCENT_END_GRADE_PCT) {
      descentDistance += segment.distance;
    } else {
      descentDistance = 0;
    }

    if (segment.gradient >= CLIMB_START_GRADE_PCT) {
      flatDistance = 0;
    } else {
      flatDistance += segment.distance;
    }

    if (segment.gradient >= CLIMB_START_GRADE_PCT && currentClimb === null) {
      currentClimb = {
        segments: [segment],
        totalDistance: segment.distance,
        totalElevation: segment.elevation,
      };
      descentDistance = 0;
      flatDistance = 0;
    } else if (currentClimb !== null) {
      currentClimb.segments.push(segment);
      currentClimb.totalDistance += segment.distance;
      currentClimb.totalElevation += segment.elevation;

      if (descentDistance >= DESCENT_END_DISTANCE_M || flatDistance >= CLIMB_END_FLAT_M) {
        if (currentClimb.totalDistance >= CLIMB_MIN_DISTANCE_M) {
          pushClimb(currentClimb, climbs);
        }
        currentClimb = null;
        descentDistance = 0;
        flatDistance = 0;
      }
    }
  }

  if (currentClimb && currentClimb.totalDistance >= CLIMB_MIN_DISTANCE_M) {
    pushClimb(currentClimb, climbs);
  }

  return climbs;
}

function pushClimb(climb: RawClimb, climbs: RawClimb[]): void {
  const finalized = finalizeRawClimb(climb, 0);
  if (finalized) climbs.push(finalized);
}

/**
 * Strips trailing segments below `tailTrimGrade` from a copy of `climb`, then
 * validates it against the global minimum thresholds. Returns the cleaned
 * RawClimb on success or null if it no longer qualifies.
 */
function finalizeRawClimb(climb: RawClimb, tailTrimGrade: number): RawClimb | null {
  const candidate: RawClimb = { ...climb, segments: [...climb.segments] };

  while (
    candidate.segments.length > 0 &&
    candidate.segments[candidate.segments.length - 1].gradient < tailTrimGrade
  ) {
    const removed = candidate.segments.pop()!;
    candidate.totalDistance -= removed.distance;
    candidate.totalElevation -= removed.elevation;
  }

  if (candidate.segments.length === 0 || candidate.totalDistance <= 0) return null;

  const avgGrade = (candidate.totalElevation / candidate.totalDistance) * 100;

  if (
    candidate.totalDistance >= CLIMB_MIN_DISTANCE_M &&
    candidate.totalElevation >= CLIMB_MIN_ELEVATION_M &&
    avgGrade >= CLIMB_MIN_AVG_GRADE_PCT
  ) {
    return candidate;
  }
  return null;
}

// ─── Step 4 (cont): Merging ───────────────────────────────────────────────────

/** Converts a fully-scored Climb back to the RawClimb shape expected by the merge step. */
function toRawClimb(c: Climb): RawClimb {
  return { segments: c.segments, totalDistance: c.distance, totalElevation: c.elevation };
}

export function mergeNearbyClimbs(
  climbs: RawClimb[],
  allSegments: Segment[],
  maxGapDistance = MERGE_MAX_GAP_M
): RawClimb[] {
  if (climbs.length <= 1) return climbs;

  const result: RawClimb[] = [climbs[0]];

  for (let i = 1; i < climbs.length; i++) {
    const prev = result[result.length - 1];
    const curr = climbs[i];

    const prevLastSeg = prev.segments[prev.segments.length - 1];
    const currFirstSeg = curr.segments[0];

    const gapDistance = currFirstSeg.startDistance - prevLastSeg.endDistance;
    const elevDrop = prevLastSeg.endElevation - currFirstSeg.startElevation;
    const combinedGain = prev.totalElevation + curr.totalElevation;
    const maxAllowedDrop = Math.max(MERGE_MAX_VALLEY_DROP_M, combinedGain * MERGE_VALLEY_RATIO);

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
  const trimmed: RawClimb = { ...climb, segments: [...climb.segments] };
  if (!trimmed.segments || trimmed.segments.length === 0) return trimmed;

  let startIndex = 0;
  while (
    startIndex < trimmed.segments.length &&
    trimmed.segments[startIndex].gradient < TRIM_MIN_GRADE_PCT
  ) {
    startIndex++;
  }

  let endIndex = trimmed.segments.length - 1;
  while (endIndex >= 0 && trimmed.segments[endIndex].gradient < TRIM_MIN_GRADE_PCT) {
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

  if (newDistance >= TRIM_MIN_DISTANCE_M) {
    return { segments: climbSegments, totalDistance: newDistance, totalElevation: newElev };
  }

  return { segments: [], totalDistance: 0, totalElevation: 0 };
}

export function categorizeClimb(climb: RawClimb, scoringModel: ScoringModel = "aso"): Climb | null {
  if (!climb || climb.totalDistance === 0 || climb.totalElevation === 0) return null;

  const avgGrade = (climb.totalElevation / climb.totalDistance) * 100;
  const scored = applyScore(climb.totalDistance, avgGrade, scoringModel);
  if (!scored) return null;

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
    ...scored,
    segments: climb.segments,
    markerCoords,
    endCoords,
  };
}

/**
 * Re-applies scoring/categorisation to an already-detected Climb[] without
 * re-running the detection pipeline. Only `difficulty` and `category` change;
 * all geometric data (segments, coords, distance, elevation) is preserved.
 * Climbs that fall below the model's minimum score are filtered out.
 */
export function recategorizeClimbs(climbs: Climb[], model: ScoringModel): Climb[] {
  return climbs
    .map((climb): Climb | null => {
      const scored = applyScore(climb.distance, climb.avgGrade, model);
      return scored ? { ...climb, ...scored } : null;
    })
    .filter((c): c is Climb => c !== null);
}

// ─── Step 6: Anti-green splitting ────────────────────────────────────────────

/**
 * Splits a climb that contains a long flat section (≥ SPLIT_FLAT_LENGTH_M of
 * gradient < SPLIT_FLAT_GRADE_PCT) into separate RawClimb pieces.
 * Returns a single-element array wrapping the original when no split occurs.
 * Callers are responsible for scoring/categorising the returned raw climbs.
 */
function splitAntiGreenClimbs(climb: Climb): RawClimb[] {
  const asRaw = (): RawClimb => ({
    segments: climb.segments,
    totalDistance: climb.distance,
    totalElevation: climb.elevation,
  });

  if (!climb || !climb.segments || climb.segments.length < 2) return [asRaw()];

  const splits: RawClimb[] = [];
  let currentRaw: RawClimb | null = null;
  let flatDistance = 0;

  for (const seg of climb.segments) {
    if (seg.gradient < SPLIT_FLAT_GRADE_PCT) {
      flatDistance += seg.distance;

      if (currentRaw) {
        currentRaw.segments.push(seg);
        currentRaw.totalDistance += seg.distance;
        currentRaw.totalElevation += seg.elevation;
      }

      if (flatDistance >= SPLIT_FLAT_LENGTH_M && currentRaw) {
        const finalized = finalizeRawClimb(currentRaw, SPLIT_FLAT_GRADE_PCT);
        if (finalized) splits.push(finalized);
        currentRaw = null;
        flatDistance = 0;
      }
    } else {
      flatDistance = 0;

      if (!currentRaw) {
        currentRaw = { segments: [], totalDistance: 0, totalElevation: 0 };
      }

      currentRaw.segments.push(seg);
      currentRaw.totalDistance += seg.distance;
      currentRaw.totalElevation += seg.elevation;
    }
  }

  // Finalize trailing sub-climb
  if (currentRaw) {
    const finalized = finalizeRawClimb(currentRaw, SPLIT_FLAT_GRADE_PCT);
    if (finalized) splits.push(finalized);
  }

  return splits.length > 0 ? splits : [asRaw()];
}

// ─── Test exports ─────────────────────────────────────────────────────────────
export { resamplePoints as _resamplePoints, smoothElevationProfile as _smoothElevationProfile };
