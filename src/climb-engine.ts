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
  AnalysisResult,
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
  MERGE_GAP_GAIN_SCALE,
  MERGE_GAP_MAX_BONUS_M,
  MERGE_DESCENT_GAP_MAX_M,
  MERGE_DESCENT_SCALE,
  MERGE_MAX_VALLEY_DROP_M,
  MERGE_VALLEY_RATIO,
  TRIM_MIN_GRADE_PCT,
  TRIM_TAIL_WINDOW_M,
  TRIM_STEEP_RATIO,
  TRIM_MIN_DISTANCE_M,
} from "./climb-engine.config";

// ─── Pipeline entry point ────────────────────────────────────────────────────

/**
 * Climb Detection Algorithm — 5-step pipeline.
 * See types.ts for the Climb interface definition.
 *
 * @param elevationData - [[distance_m, elevation_m, lat, lon], ...]
 */
export function detectClimbs(
  elevationData: ElevationTuple[],
  scoringModel: ScoringModel = "aso"
): AnalysisResult {
  if (!elevationData || elevationData.length < 2)
    return { climbs: [], totalDistance: 0, totalElevationGain: 0, totalElevationLoss: 0 };

  // Step 1: Build structured profile from raw elevation tuples
  const profile: GpsPoint[] = elevationData.map((point) => ({
    distance: point[0],
    elevation: point[1],
    lat: point[2] ?? null,
    lon: point[3] ?? null,
  }));

  // Step 2: Remove GPS micro-jitter, smooth elevation, compute per-segment gradients
  const resampled = resamplePoints(profile);
  const smoothed = smoothElevationProfile(resampled);
  const segments = calculateGradients(smoothed);

  // Step 3: Identify raw climb candidates
  // A candidate ends when it accumulates DESCENT_END_DISTANCE_M of descent
  // (≤ DESCENT_END_GRADE_PCT) or CLIMB_END_FLAT_M of flat/low-grade terrain.
  // The flat-end threshold strips the trailing flat tail before closing, so
  // each candidate ends just before the gap — giving the merge step a real
  // distance to evaluate rather than an artificial 0 m gap.
  const rawClimbs = identifyClimbs(segments, resampled);

  // Step 4: Merge adjacent climb candidates across short valleys or flat gaps.
  // The permitted gap scales with combined elevation gain so that two large
  // climbs separated by a brief descent always merge, while two small climbs
  // separated by the same distance stay separate.
  const mergedClimbs = mergeNearbyClimbs(rawClimbs, segments, resampled);

  // Step 5: Trim flat lead-in / tail, then score and categorize
  const trimmedClimbs = mergedClimbs
    .map((raw) => {
      const trimmed = trimClimbEndpoints(raw);
      return trimmed.totalDistance > 0 && trimmed.totalElevation > 0
        ? categorizeClimb(trimmed, scoringModel)
        : null;
    })
    .filter((c): c is Climb => c !== null);

  return {
    climbs: trimmedClimbs,
    totalDistance: profile[profile.length - 1].distance,
    totalElevationGain: calculateStats(resampled).gain,
    totalElevationLoss: calculateStats(resampled).descent,
  };
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

function identifyClimbs(segments: Segment[], rawProfile: GpsPoint[]): RawClimb[] {
  const climbs: RawClimb[] = [];
  let currentClimb: RawClimb | null = null;
  let descentDistance = 0;
  let flatDistance = 0;

  const closeCurrentClimb = (tailTrimGrade: number) => {
    if (!currentClimb) return;
    // Strip the accumulated flat/descent tail so the candidate ends at the
    // last climbing segment — creating a real gap the merge step can measure.
    if (currentClimb.totalDistance >= CLIMB_MIN_DISTANCE_M) {
      const finalized = finalizeRawClimb(currentClimb, tailTrimGrade, rawProfile);
      if (finalized) climbs.push(finalized);
    }
    currentClimb = null;
    descentDistance = 0;
    flatDistance = 0;
  };

  for (const segment of segments) {
    const isClimbing = segment.gradient >= CLIMB_START_GRADE_PCT;
    const isDescent = segment.gradient <= DESCENT_END_GRADE_PCT;

    descentDistance = isDescent ? descentDistance + segment.distance : 0;
    flatDistance = isClimbing ? 0 : flatDistance + segment.distance;

    if (isClimbing && currentClimb === null) {
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

      if (descentDistance >= DESCENT_END_DISTANCE_M) {
        // Trim tail to grade ≥ 0: keeps the last climbing/neutral segment,
        // avoids leaving a descent stub that trimClimbEndpoints would strip anyway.
        closeCurrentClimb(0);
      } else if (flatDistance >= CLIMB_END_FLAT_M) {
        // Strip the flat tail so the climb ends just before the gap
        closeCurrentClimb(CLIMB_START_GRADE_PCT);
      }
    }
  }

  closeCurrentClimb(0);
  return climbs;
}

/**
 * Computes net elevation gain within [startDist, endDist] directly from the
 * raw (un-smoothed) GPS profile. Used to validate candidates whose smoothed
 * elevation sum may be attenuated by terrain bordering the climb window.
 */
function rawElevationGain(profile: GpsPoint[], startDist: number, endDist: number): number {
  // Find bracketing indices
  let lo = 0;
  while (lo < profile.length - 1 && profile[lo].distance < startDist) lo++;
  let hi = lo;
  while (hi < profile.length - 1 && profile[hi].distance < endDist) hi++;
  if (hi <= lo) return 0;
  // Sum only upward increments (cumulative gain)
  let gain = 0;
  for (let i = lo; i < hi; i++) {
    const delta = profile[i + 1].elevation - profile[i].elevation;
    if (delta > 0) gain += delta;
  }
  return gain;
}

/**
 * Strips trailing segments below `tailTrimGrade` from a copy of `climb`, then
 * validates it against the global minimum thresholds. Returns the cleaned
 * RawClimb on success or null if it no longer qualifies.
 */
function finalizeRawClimb(
  climb: RawClimb,
  tailTrimGrade: number,
  rawProfile: GpsPoint[]
): RawClimb | null {
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

  // Use raw GPS elevation gain for threshold checks so that a narrow
  // smoothing window (which bleeds into adjacent terrain) cannot suppress a
  // real climb that immediately follows a descent.
  const s0 = candidate.segments[0];
  const sN = candidate.segments[candidate.segments.length - 1];
  const measuredGain = rawElevationGain(rawProfile, s0.startDistance, sN.endDistance);
  const measuredAvgGrade = (measuredGain / candidate.totalDistance) * 100;

  if (
    candidate.totalDistance >= CLIMB_MIN_DISTANCE_M &&
    measuredGain >= CLIMB_MIN_ELEVATION_M &&
    measuredAvgGrade >= CLIMB_MIN_AVG_GRADE_PCT
  ) {
    return candidate;
  }
  return null;
}

/**
 * Returns the raw (un-smoothed) elevation at `distanceM` via linear interpolation.
 */
function rawElevationAt(profile: GpsPoint[], distanceM: number): number {
  let lo = 0;
  while (lo < profile.length - 1 && profile[lo + 1].distance <= distanceM) lo++;
  if (lo >= profile.length - 1) return profile[lo].elevation;
  const a = profile[lo],
    b = profile[lo + 1];
  const t = b.distance > a.distance ? (distanceM - a.distance) / (b.distance - a.distance) : 0;
  return a.elevation + t * (b.elevation - a.elevation);
}

// ─── Step 4 (cont): Merging ───────────────────────────────────────────────────

export function mergeNearbyClimbs(
  climbs: RawClimb[],
  allSegments: Segment[],
  rawProfile: GpsPoint[] = []
): RawClimb[] {
  if (climbs.length <= 1) return climbs;

  const result: RawClimb[] = [climbs[0]];

  for (let i = 1; i < climbs.length; i++) {
    const prev = result[result.length - 1];
    const curr = climbs[i];

    const prevEnd = prev.segments[prev.segments.length - 1];
    const currStart = curr.segments[0];

    const gapDistance = currStart.startDistance - prevEnd.endDistance;
    const valleyDrop = prevEnd.endElevation - currStart.startElevation;
    const combinedGain = prev.totalElevation + curr.totalElevation;

    // Gap limit and valley floor both scale on the *smaller* climb's gain so
    // a tiny climb next to a large one doesn't inherit a disproportionate bonus.
    const smallerGain = Math.min(prev.totalElevation, curr.totalElevation);
    const gainBonus = Math.min(smallerGain * MERGE_GAP_GAIN_SCALE, MERGE_GAP_MAX_BONUS_M);

    // If the raw terrain in the gap descends (a real valley), apply a tighter
    // base distance so that two distinct climbs on either side of a shallow
    // valley don't merge just because the gap happens to fit within the
    // generous MERGE_MAX_GAP_M. The cap scales with smallerGain so large climbs
    // (e.g. a levelling section mid-mountain) can still bridge descent gaps.
    // Ascending/flat gaps keep the full base.
    const gapRawNet =
      rawProfile.length > 0
        ? rawElevationAt(rawProfile, currStart.startDistance) -
          rawElevationAt(rawProfile, prevEnd.endDistance)
        : 0;
    const descentCap = Math.max(MERGE_DESCENT_GAP_MAX_M, smallerGain * MERGE_DESCENT_SCALE);
    const adjustedBase = gapRawNet < -1 ? Math.min(MERGE_MAX_GAP_M, descentCap) : MERGE_MAX_GAP_M;
    const effectiveMaxGap = adjustedBase + gainBonus;

    // Valley drop limit: scales with combined gain, but the floor is capped to
    // the smaller climb's gain so two small climbs separated by a real descent
    // don't merge just because the absolute floor happens to exceed the valley.
    const floor = Math.min(MERGE_MAX_VALLEY_DROP_M, smallerGain * 0.5);
    const maxAllowedDrop = Math.max(floor, combinedGain * MERGE_VALLEY_RATIO);

    const shouldMerge =
      gapDistance >= 0 && gapDistance <= effectiveMaxGap && valleyDrop <= maxAllowedDrop;

    if (shouldMerge) {
      const gapSegs = allSegments.filter(
        (s) =>
          s.startDistance >= prevEnd.endDistance - 0.1 && s.startDistance < currStart.startDistance
      );

      const mergedSegs = [...prev.segments, ...gapSegs, ...curr.segments];
      let totalDist = 0,
        totalElev = 0;
      for (const s of mergedSegs) {
        totalDist += s.distance;
        totalElev += s.elevation;
      }

      // Trim leading/trailing flat from the merged result immediately so gap
      // segments don't appear as a flat prologue or epilogue on the merged climb.
      const merged: RawClimb = {
        segments: mergedSegs,
        totalDistance: totalDist,
        totalElevation: totalElev,
      };
      const trimmed = trimClimbEndpoints(merged);
      result[result.length - 1] = trimmed.totalDistance > 0 ? trimmed : merged;
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

  // Secondary check: endIndex must lie in a genuinely steep stretch, not be an isolated
  // noise spike. Compute the fraction of the last TRIM_TAIL_WINDOW_M metres (ending at
  // endIndex) that is steep. If below TRIM_STEEP_RATIO, the current endIndex is noise;
  // scan backward to the next steep candidate and repeat.
  while (endIndex >= 0) {
    let windowDist = 0,
      steepDist = 0;
    for (let j = endIndex; j >= 0 && windowDist < TRIM_TAIL_WINDOW_M; j--) {
      windowDist += trimmed.segments[j].distance;
      if (trimmed.segments[j].gradient >= TRIM_MIN_GRADE_PCT) {
        steepDist += trimmed.segments[j].distance;
      }
    }
    // If we have less than half a window of context (very short climb), accept as-is
    // to avoid over-trimming. Otherwise require the steep fraction to pass the threshold.
    if (windowDist < TRIM_TAIL_WINDOW_M * 0.5 || steepDist / windowDist >= TRIM_STEEP_RATIO) break;
    // Noise spike — scan backward to next steep candidate
    endIndex--;
    while (endIndex >= 0 && trimmed.segments[endIndex].gradient < TRIM_MIN_GRADE_PCT) {
      endIndex--;
    }
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

function calculateStats(resampled: GpsPoint[]) {
  let gain = 0;
  let descent = 0;

  for (let i = 1; i < resampled.length; i++) {
    const diff = resampled[i].elevation - resampled[i - 1].elevation;

    if (diff > 0) {
      gain += diff;
    } else if (diff < 0) {
      descent += Math.abs(diff);
    }
  }

  return { gain, descent };
}

// ─── Test exports ─────────────────────────────────────────────────────────────
export { resamplePoints as _resamplePoints, smoothElevationProfile as _smoothElevationProfile };
