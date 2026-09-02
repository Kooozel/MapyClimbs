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
  ClimbCategory,
  ClimbDebugSink,
  Coords,
  DetectClimbsOptions,
  ElevationTuple,
  GpsPoint,
  RawClimb,
  Segment,
  ScoringModel,
  AnalysisResult,
} from "./types";
import { applyScore, applyHikingScore } from "./scoring";
import {
  RESAMPLE_MIN_INTERVAL_M,
  SMOOTH_GRAD_WINDOW_M,
  SMOOTH_STEEP_GRADE_THRESHOLD,
  SMOOTH_MID_GRADE_THRESHOLD,
  SMOOTH_WINDOW_MIN_M,
  SMOOTH_WINDOW_MID_M,
  SMOOTH_WINDOW_MAX_M,
  INTERPOLATE_MAX_GAP_M,
  SPIKE_GRADIENT_THRESHOLD,
  SPIKE_NEIGHBOR_THRESHOLD,
  SPIKE_MAX_SEGMENT_M,
  CLIMB_START_GRADE_PCT,
  CLIMB_CONTINUE_GRADE_PCT,
  CLIMB_LEADIN_GRADE_PCT,
  CLIMB_LEADIN_MAX_DISTANCE_M,
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
  MERGE_COHERENT_ASCENT_RATIO,
  TRIM_START_GRADE_PCT,
  TRIM_END_GRADE_PCT,
  TRIM_TAIL_WINDOW_M,
  TRIM_STEEP_RATIO,
  MAX_SUSTAINED_GRADIENT_WINDOW_M,
} from "./climb-engine.config";
import { maxGradientOverWindow } from "./max-gradient";
import type { GradientPoint } from "./max-gradient";

/** Stand-in sink for callers that pass none, so every emit site can call
 *  `emit(...)` unconditionally instead of guarding on an optional. */
const NOOP_DEBUG: ClimbDebugSink = () => {};

// ─── Pipeline entry point ────────────────────────────────────────────────────

/**
 * Climb Detection Algorithm — 5-step pipeline.
 * See types.ts for the Climb interface definition.
 *
 * @param elevationData - [[distance_m, elevation_m, lat, lon], ...]
 */
export function detectClimbs(
  elevationData: ElevationTuple[],
  scoringModel: ScoringModel = "aso",
  options: DetectClimbsOptions = {}
): AnalysisResult {
  const emit: ClimbDebugSink = options.debug ?? NOOP_DEBUG;

  if (!elevationData || elevationData.length < 2)
    return {
      climbs: [],
      totalDistance: 0,
      totalElevationGain: 0,
      totalElevationLoss: 0,
      timestamp: Date.now(),
    };

  // Step 1: Build structured profile from raw elevation tuples
  const profile: GpsPoint[] = elevationData.map((point) => ({
    distance: point[0],
    elevation: point[1],
    lat: point[2] ?? null,
    lon: point[3] ?? null,
  }));

  // Step 2: Remove GPS micro-jitter, fill wide gaps, smooth elevation, compute gradients
  const resampled = resamplePoints(profile);
  // Step 2b: Fill gaps > INTERPOLATE_MAX_GAP_M so the smoother's window covers a
  // consistent number of points regardless of local GPS sampling density.
  // rawProfile stays as `resampled` — rawElevationGain/rawElevationAt already
  // interpolate the raw profile internally and must not see artificial points.
  const interpolated = interpolateProfile(resampled);
  const smoothed = smoothElevationProfile(interpolated);
  const segments = calculateGradients(smoothed);

  emit({
    stage: "pipeline",
    rawPoints: profile.length,
    resampled: resampled.length,
    interpolated: interpolated.length,
    smoothed: smoothed.length,
    segments: segments.length,
  });

  // Step 3: Identify raw climb candidates
  // A candidate ends when it accumulates DESCENT_END_DISTANCE_M of descent
  // (≤ DESCENT_END_GRADE_PCT) or CLIMB_END_FLAT_M of flat/low-grade terrain.
  // The flat-end threshold strips the trailing flat tail before closing, so
  // each candidate ends just before the gap — giving the merge step a real
  // distance to evaluate rather than an artificial 0 m gap.
  const rawClimbs = identifyClimbs(segments, resampled, emit);

  // Step 4: Merge adjacent climb candidates across short valleys or flat gaps.
  // The permitted gap scales with combined elevation gain so that two large
  // climbs separated by a brief descent always merge, while two small climbs
  // separated by the same distance stay separate.
  const mergedClimbs = mergeNearbyClimbs(rawClimbs, segments, resampled, emit);

  // Step 5: Trim flat lead-in / tail, then score and categorize
  const rawCandidates: RawClimb[] = [];
  const trimmedClimbs = mergedClimbs
    .map((raw) => {
      const before = raw.segments;
      const trimmed = trimClimbEndpoints(raw);
      const kept = trimmed.totalDistance > 0 && trimmed.totalElevation > 0;
      if (before.length > 0) {
        const beforeStart = before[0].startDistance;
        const beforeEnd = before[before.length - 1].endDistance;
        let droppedHead = 0;
        let droppedTail = 0;
        if (kept && trimmed.segments.length > 0) {
          const ts = trimmed.segments[0].startDistance;
          const te = trimmed.segments[trimmed.segments.length - 1].endDistance;
          for (const s of before) {
            if (s.endDistance <= ts) droppedHead++;
            if (s.startDistance >= te) droppedTail++;
          }
        } else {
          droppedHead = before.length;
        }
        emit({
          stage: "trim",
          startKm: beforeStart / 1000,
          endKm: beforeEnd / 1000,
          droppedHeadSegs: droppedHead,
          droppedTailSegs: droppedTail,
          remainingDistanceM: trimmed.totalDistance,
          kept,
        });
      }
      if (!kept) return null;
      rawCandidates.push(trimmed);
      const scored = categorizeClimb(trimmed, scoringModel);
      const s0 = trimmed.segments[0];
      const sN = trimmed.segments[trimmed.segments.length - 1];
      emit({
        stage: "categorize",
        startKm: s0.startDistance / 1000,
        endKm: sN.endDistance / 1000,
        distanceM: trimmed.totalDistance,
        avgGradePct: (trimmed.totalElevation / trimmed.totalDistance) * 100,
        difficulty: scored ? scored.difficulty : null,
        category: scored ? scored.category : null,
      });
      return scored;
    })
    .filter((c): c is Climb => c !== null);

  // Snap each climb's endCoords to the raw-profile elevation peak within a
  // conservative lookahead (≤ 300 m, clamped to half the gap before the next
  // climb) to correct for smoothing-induced under-extension at the summit.
  for (let i = 0; i < trimmedClimbs.length; i++) {
    const nextStart =
      i + 1 < trimmedClimbs.length ? trimmedClimbs[i + 1].segments[0].startDistance : Infinity;
    const lastSeg = trimmedClimbs[i].segments[trimmedClimbs[i].segments.length - 1];
    const lookahead = Math.min(300, (nextStart - lastSeg.endDistance) / 2);
    trimmedClimbs[i] = snapEndCoordsToRawPeak(trimmedClimbs[i], resampled, lookahead);
  }

  const { gain, descent } = calculateStats(resampled);
  return {
    climbs: trimmedClimbs,
    candidates: rawCandidates,
    totalDistance: profile[profile.length - 1].distance,
    totalElevationGain: gain,
    totalElevationLoss: descent,
    timestamp: Date.now(),
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

// ─── Step 2b: Profile interpolation ─────────────────────────────────────────

export function interpolateProfile(profile: GpsPoint[]): GpsPoint[] {
  if (profile.length <= 1) return profile;

  const result: GpsPoint[] = [profile[0]];

  for (let i = 1; i < profile.length; i++) {
    const prev = profile[i - 1];
    const curr = profile[i];
    const gap = curr.distance - prev.distance;

    if (gap > INTERPOLATE_MAX_GAP_M) {
      const steps = Math.round(gap / RESAMPLE_MIN_INTERVAL_M);
      for (let s = 1; s < steps; s++) {
        const t = s / steps;
        result.push({
          distance: prev.distance + t * gap,
          elevation: prev.elevation + t * (curr.elevation - prev.elevation),
          lat: prev.lat != null && curr.lat != null ? prev.lat + t * (curr.lat - prev.lat) : null,
          lon: prev.lon != null && curr.lon != null ? prev.lon + t * (curr.lon - prev.lon) : null,
        });
      }
    }

    result.push(curr);
  }

  return result;
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
      sumWeight = 0;

    for (let j = i; j >= 0 && center - profile[j].distance <= windowMeters; j--) {
      const w = 1 - (center - profile[j].distance) / windowMeters;
      sumElev += profile[j].elevation * w;
      sumWeight += w;
    }
    for (let j = i + 1; j < profile.length && profile[j].distance - center <= windowMeters; j++) {
      const w = 1 - (profile[j].distance - center) / windowMeters;
      sumElev += profile[j].elevation * w;
      sumWeight += w;
    }

    smoothed[i] = {
      distance: profile[i].distance,
      elevation: sumWeight > 0 ? sumElev / sumWeight : profile[i].elevation,
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

    const leftDist = curr.distance - prev.distance;
    const rightDist = next.distance - curr.distance;

    // Long segments represent real terrain, not GPS jitter — skip spike detection.
    if (leftDist > SPIKE_MAX_SEGMENT_M || rightDist > SPIKE_MAX_SEGMENT_M) continue;

    const prevGrad = Math.abs((curr.elevation - prev.elevation) / leftDist);
    const nextGrad = Math.abs((next.elevation - curr.elevation) / rightDist);

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

function identifyClimbs(
  segments: Segment[],
  rawProfile: GpsPoint[],
  emit: ClimbDebugSink
): RawClimb[] {
  const climbs: RawClimb[] = [];
  let currentClimb: RawClimb | null = null;
  let descentDistance = 0;
  let flatDistance = 0;
  // Rolling buffer of recent ≥ CLIMB_LEADIN_GRADE_PCT segments held while
  // no candidate is open. When the START trigger fires, these get prepended
  // to the new candidate so its first displayed segment reflects the
  // natural sub-trigger approach. The buffer is bounded in distance.
  let leadinBuffer: Segment[] = [];
  let leadinDistance = 0;
  const resetLeadin = () => {
    leadinBuffer = [];
    leadinDistance = 0;
  };
  const trimLeadinTo = (maxM: number) => {
    while (leadinBuffer.length > 0 && leadinDistance - leadinBuffer[0].distance >= maxM) {
      leadinDistance -= leadinBuffer[0].distance;
      leadinBuffer.shift();
    }
  };

  const closeCurrentClimb = (tailTrimGrade: number, reason: "descent" | "flat", atKm: number) => {
    if (!currentClimb) return;
    emit({ stage: "identify-close", reason, atKm, tailTrimGradePct: tailTrimGrade });
    // Strip the accumulated flat/descent tail so the candidate ends at the
    // last climbing segment — creating a real gap the merge step can measure.
    const finalized = finalizeRawClimb(currentClimb, tailTrimGrade, emit);
    if (finalized) {
      const s0 = finalized.segments[0];
      const sN = finalized.segments[finalized.segments.length - 1];
      const rawGain = rawElevationGain(rawProfile, s0.startDistance, sN.endDistance);
      emit({
        stage: "identify-candidate",
        index: climbs.length,
        startKm: s0.startDistance / 1000,
        endKm: sN.endDistance / 1000,
        distanceM: finalized.totalDistance,
        elevationM: finalized.totalElevation,
        avgGradePct: (finalized.totalElevation / finalized.totalDistance) * 100,
        rawGainM: rawGain,
      });
      climbs.push(finalized);
    }
    currentClimb = null;
    descentDistance = 0;
    flatDistance = 0;
  };

  for (const segment of segments) {
    const isClimbing = segment.gradient >= CLIMB_START_GRADE_PCT;
    const isContinuing = segment.gradient >= CLIMB_CONTINUE_GRADE_PCT;
    const isLeadin = segment.gradient >= CLIMB_LEADIN_GRADE_PCT;
    const isDescent = segment.gradient <= DESCENT_END_GRADE_PCT;

    descentDistance = isDescent ? descentDistance + segment.distance : 0;
    // Continue-threshold hysteresis: a segment that's still climbing (≥ CONTINUE)
    // but not steep enough to start a new candidate (< START) keeps an open
    // climb alive without resetting the open-candidate gate.
    flatDistance = isContinuing ? 0 : flatDistance + segment.distance;

    // Maintain a bounded buffer of ≥ LEADIN segments while no candidate is open.
    // Cleared by descents and any sub-LEADIN segment so the lead-in we prepend
    // only reflects an unbroken approach toward the trigger point.
    if (currentClimb === null) {
      if (isLeadin) {
        leadinBuffer.push(segment);
        leadinDistance += segment.distance;
        trimLeadinTo(CLIMB_LEADIN_MAX_DISTANCE_M);
      } else {
        resetLeadin();
      }
    }

    if (isClimbing && currentClimb === null) {
      // Prepend the accumulated lead-in. The just-pushed `segment` is already in
      // leadinBuffer (it's ≥ START ⇒ ≥ LEADIN), so use it as-is.
      const segs = [...leadinBuffer];
      let totDist = 0;
      let totElev = 0;
      for (const s of segs) {
        totDist += s.distance;
        totElev += s.elevation;
      }
      currentClimb = {
        segments: segs,
        totalDistance: totDist,
        totalElevation: totElev,
      };
      resetLeadin();
      descentDistance = 0;
      flatDistance = 0;
    } else if (currentClimb !== null) {
      currentClimb.segments.push(segment);
      currentClimb.totalDistance += segment.distance;
      currentClimb.totalElevation += segment.elevation;

      if (descentDistance >= DESCENT_END_DISTANCE_M) {
        // Trim tail to grade ≥ 0: keeps the last climbing/neutral segment,
        // avoids leaving a descent stub that trimClimbEndpoints would strip anyway.
        closeCurrentClimb(0, "descent", segment.endDistance / 1000);
      } else if (flatDistance >= CLIMB_END_FLAT_M) {
        // Strip the flat tail so the climb ends just before the gap
        closeCurrentClimb(CLIMB_START_GRADE_PCT, "flat", segment.endDistance / 1000);
      }
    }
  }

  closeCurrentClimb(0, "descent", segments[segments.length - 1]?.endDistance / 1000 || 0);
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
  emit: ClimbDebugSink
): RawClimb | null {
  const candidate: RawClimb = { ...climb, segments: [...climb.segments] };
  const origStartKm = climb.segments[0] ? climb.segments[0].startDistance / 1000 : 0;
  const origEndKm = climb.segments[climb.segments.length - 1]
    ? climb.segments[climb.segments.length - 1].endDistance / 1000
    : 0;

  while (
    candidate.segments.length > 0 &&
    candidate.segments[candidate.segments.length - 1].gradient < tailTrimGrade
  ) {
    const removed = candidate.segments.pop()!;
    candidate.totalDistance -= removed.distance;
    candidate.totalElevation -= removed.elevation;
  }

  if (candidate.segments.length === 0 || candidate.totalDistance <= 0) {
    emit({
      stage: "identify-reject",
      reason: "empty",
      startKm: origStartKm,
      endKm: origEndKm,
    });
    return null;
  }

  return candidate;
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
  rawProfile: GpsPoint[] = [],
  emit: ClimbDebugSink = NOOP_DEBUG
): RawClimb[] {
  if (climbs.length <= 1) return climbs;

  const result: RawClimb[] = [climbs[0]];

  for (let i = 1; i < climbs.length; i++) {
    const prev = result[result.length - 1];
    const curr = climbs[i];

    const prevStart = prev.segments[0];
    const prevEnd = prev.segments[prev.segments.length - 1];
    const currStart = curr.segments[0];
    const currEnd = curr.segments[curr.segments.length - 1];

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

    // combinedRawRise is computed for debug visibility only — useful when
    // diagnosing whether a *failed* merge looked like one coherent ascent.
    // We deliberately do NOT use it as a force-merge signal: experiments
    // showed it over-merges on rolling cycling routes (bk / grun / hukvaldy)
    // where adjacent climbs share a high start-to-end rise but are genuinely
    // distinct ascents. A net-gain-over-window primary trigger would handle
    // this better — deferred to a Phase 2 refactor.
    const combinedRawRise =
      rawProfile.length > 0
        ? rawElevationAt(rawProfile, currEnd.endDistance) -
          rawElevationAt(rawProfile, prevStart.startDistance)
        : 0;
    const coherentAscent =
      combinedGain > 0 && combinedRawRise >= MERGE_COHERENT_ASCENT_RATIO * combinedGain;

    emit({
      stage: "merge-pair",
      prevStartKm: prevStart.startDistance / 1000,
      prevEndKm: prevEnd.endDistance / 1000,
      currStartKm: currStart.startDistance / 1000,
      currEndKm: currEnd.endDistance / 1000,
      gapM: gapDistance,
      valleyDropM: valleyDrop,
      effectiveMaxGapM: effectiveMaxGap,
      maxAllowedDropM: maxAllowedDrop,
      coherentAscent,
      combinedRawRiseM: combinedRawRise,
      decision: shouldMerge ? "merge" : "skip",
      reason: shouldMerge
        ? "within-gap-and-valley"
        : gapDistance < 0
          ? "negative-gap"
          : gapDistance > effectiveMaxGap
            ? "gap-too-large"
            : "valley-too-deep",
    });

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

/**
 * Extends the climb to the highest raw-profile point within
 * [lastSeg.endDistance, lastSeg.endDistance + lookaheadM].
 *
 * Corrects for smoothing-induced under-extension: the flat summit plateau
 * bleeds into the smoothing window and lowers the apparent gradient at the
 * peak, causing trimClimbEndpoints to cut off the final metres before the
 * true summit. A synthetic extension segment is appended so the route
 * polyline, elevation chart, and end-pin all reach the real top.
 *
 * If the raw peak is not actually higher than the current smoothed endpoint
 * (rare over-smoothing artefact), the climb is returned unchanged.
 */
function snapEndCoordsToRawPeak(climb: Climb, rawProfile: GpsPoint[], lookaheadM: number): Climb {
  if (lookaheadM <= 0) return climb;
  const lastSeg = climb.segments[climb.segments.length - 1];
  if (!lastSeg) return climb;

  const endDist = lastSeg.endDistance;
  const limitDist = endDist + lookaheadM;

  // Use the RAW terrain elevation at endDist as the baseline — not the smoothed
  // lastSeg.endElevation. The smoother can depress the endpoint by 1–3 m, which
  // would cause every post-summit raw point to look like an upward extension.
  const rawEndElev = rawElevationAt(rawProfile, endDist);

  // Walk forward tracking the running maximum. Stop as soon as the elevation
  // drops more than 2 m below that maximum — that marks the start of a real
  // descent and prevents snapping past the actual summit into a later hill.
  const DESCENT_STOP_M = 2;
  let runningMax = rawEndElev;
  let peakPoint: GpsPoint | null = null;

  for (const pt of rawProfile) {
    if (pt.distance < endDist) continue;
    if (pt.distance > limitDist) break;
    if (pt.elevation > runningMax) {
      runningMax = pt.elevation;
      if (pt.lat != null && pt.lon != null) peakPoint = pt;
    } else if (pt.elevation < runningMax - DESCENT_STOP_M) {
      break;
    }
  }

  if (!peakPoint || peakPoint.lat == null || peakPoint.lon == null) return climb;
  if (peakPoint.distance <= endDist) return climb;

  const distToPeak = peakPoint.distance - endDist;

  // Reject GPS-noise micro-highs: the raw peak must be at least 1.5 m above
  // the raw trim baseline.
  if (peakPoint.elevation - rawEndElev < 1.5) return climb;

  // Reject long post-summit extensions: the maximum smoothing-induced trim gap
  // is half the widest smoothing window (250 m / 2 = 125 m). 150 m gives a
  // safe margin while excluding the 200–300 m false-plateau cases.
  if (distToPeak > 150) return climb;

  const distExtension = peakPoint.distance - endDist;
  const elevExtension = peakPoint.elevation - lastSeg.endElevation;
  if (elevExtension <= 0) return climb;

  const extensionSeg: Segment = {
    startDistance: endDist,
    endDistance: peakPoint.distance,
    distance: distExtension,
    elevation: elevExtension,
    gradient: (elevExtension / distExtension) * 100,
    startElevation: lastSeg.endElevation,
    endElevation: peakPoint.elevation,
    startLat: lastSeg.endLat,
    startLon: lastSeg.endLon,
    endLat: peakPoint.lat,
    endLon: peakPoint.lon,
  };

  const newDistance = climb.distance + distExtension;
  const newElevation = climb.elevation + elevExtension;

  return {
    ...climb,
    segments: [...climb.segments, extensionSeg],
    distance: newDistance,
    elevation: newElevation,
    avgGrade: (newElevation / newDistance) * 100,
    endCoords: { lat: peakPoint.lat, lon: peakPoint.lon },
  };
}

function trimClimbEndpoints(climb: RawClimb): RawClimb {
  const trimmed: RawClimb = { ...climb, segments: [...climb.segments] };
  if (!trimmed.segments || trimmed.segments.length === 0) return trimmed;

  let startIndex = 0;
  while (
    startIndex < trimmed.segments.length &&
    trimmed.segments[startIndex].gradient < TRIM_START_GRADE_PCT
  ) {
    startIndex++;
  }

  let endIndex = trimmed.segments.length - 1;
  while (endIndex >= 0 && trimmed.segments[endIndex].gradient < TRIM_END_GRADE_PCT) {
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
      if (trimmed.segments[j].gradient >= TRIM_END_GRADE_PCT) {
        steepDist += trimmed.segments[j].distance;
      }
    }
    // If we have less than half a window of context (very short climb), accept as-is
    // to avoid over-trimming. Otherwise require the steep fraction to pass the threshold.
    if (windowDist < TRIM_TAIL_WINDOW_M * 0.5 || steepDist / windowDist >= TRIM_STEEP_RATIO) break;
    // Noise spike — scan backward to next steep candidate
    endIndex--;
    while (endIndex >= 0 && trimmed.segments[endIndex].gradient < TRIM_END_GRADE_PCT) {
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

  return { segments: climbSegments, totalDistance: newDistance, totalElevation: newElev };
}

/**
 * Returns the maximum *sustained* gradient (as a decimal, e.g. 0.30 for 30%)
 * over any contiguous window of at least `windowM` metres within `segments`.
 *
 * "Sustained" is the distinguishing word: this reads the dense smoothed profile
 * over a wide window, so it is what a rider feels for a couple of hundred
 * metres — deliberately *not* the steepest short pitch the card's chart shows.
 * That figure is maxPitchGradient (gradient-zones.ts); both are one scan
 * (max-gradient.ts) under two configurations.
 *
 * The former body took a distance-weighted mean of the per-segment gradients,
 * which is the same number: each term is (Δe/d · 100) · d = 100 · Δe, so the
 * weighted mean divided by the span *is* geometric rise/run over the span.
 */
export function computeMaxSustainedGradient(
  segments: Segment[],
  windowM = MAX_SUSTAINED_GRADIENT_WINDOW_M
): number {
  if (segments.length === 0) return 0;
  const last = segments[segments.length - 1];
  // Absolute startDistance, not re-based to 0 the way buildProfilePoints does:
  // only differences are read, and reusing that helper would make the engine
  // depend on gradient-zones.ts, which must not travel with it.
  const points: GradientPoint[] = segments.map((s) => ({
    distance: s.startDistance,
    elevation: s.startElevation,
  }));
  points.push({ distance: last.endDistance, elevation: last.endElevation });
  return maxGradientOverWindow(points, windowM) / 100;
}

function scoreForHiking(
  elevation: number,
  distance: number,
  segments: Segment[]
): { difficulty: number; category: ClimbCategory } | null {
  const maxGradientDecimal = computeMaxSustainedGradient(segments);
  return applyHikingScore({
    totalElevationM: elevation,
    totalDistanceM: distance,
    maxGradientDecimal,
  });
}

export function categorizeClimb(climb: RawClimb, scoringModel: ScoringModel = "aso"): Climb | null {
  if (!climb || climb.totalDistance === 0 || climb.totalElevation === 0) return null;

  const avgGrade = (climb.totalElevation / climb.totalDistance) * 100;

  const scored =
    scoringModel === "hiking"
      ? scoreForHiking(climb.totalElevation, climb.totalDistance, climb.segments)
      : applyScore(climb.totalDistance, avgGrade, scoringModel);

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
 * Re-scores a list of pre-trimmed RawClimb candidates under a new scoring
 * model without re-running the detection pipeline. Candidates that don't
 * reach the model's lowest threshold are dropped. Accepts all trimmed
 * candidates (not just those that passed the original model) so switching
 * from a permissive model to a strict one and back is fully reversible.
 */
export function recategorizeClimbs(candidates: RawClimb[], model: ScoringModel): Climb[] {
  return candidates.map((c) => categorizeClimb(c, model)).filter((c): c is Climb => c !== null);
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
export {
  resamplePoints as _resamplePoints,
  smoothElevationProfile as _smoothElevationProfile,
  interpolateProfile as _interpolateProfile,
};
