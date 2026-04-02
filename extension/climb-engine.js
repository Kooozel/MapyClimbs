/**
 * climb-engine.js — Mapy.cz Climb Analyzer
 * Pure climb-detection algorithm. No Chrome APIs — fully testable in isolation.
 *
 * Public API
 * ----------
 *   detectClimbs(elevationData) → Climb[]
 *
 * Where elevationData is an array of [distance_m, elevation_m, lat, lon] tuples
 * as produced by gpx-parser.js, and Climb is:
 *   { distance, elevation, avgGrade, difficulty, category,
 *     segments, markerCoords, endCoords }
 */

// ─── Pipeline entry point ────────────────────────────────────────────────────

/**
 * Climb Detection Algorithm
 * Processes elevation profile to identify and categorize climbs.
 *
 * Pipeline (7 steps):
 *  1. Build structured profile from raw tuples
 *  2. Resample — remove GPS micro-jitter (<12 m gap)
 *  3. Smooth — adaptive window rolling average + spike filter
 *  4. Segment gradient → detect raw climbs → merge valleys (2000 m threshold)
 *  5. Trim flat lead-in/tail → categorize
 *  6. Anti-green split — divide climbs with >400 m of <2% grade
 *  7. Re-merge adjacent splits with tighter 1500 m threshold → re-trim/categorize
 *
 * @param {Array} elevationData - [[distance_m, elevation_m, lat, lon], ...]
 * @returns {Climb[]}
 */
export function detectClimbs(elevationData) {
  if (!elevationData || elevationData.length < 2) return [];

  // Step 1: Build structured profile from raw [distance, elevation, lat, lon] tuples
  const profile = elevationData.map((point) => ({
    distance: point[0],
    elevation: point[1],
    lat: point[2] ?? null,
    lon: point[3] ?? null,
  }));

  // Step 2: Resample to remove GPS micro-jitter (points < 12m apart)
  const resampled = resamplePoints(profile);

  // Step 3: Smooth elevation with adaptive window, then compute per-segment gradients
  const smoothed = smoothElevationProfile(resampled);
  const segments = calculateGradients(smoothed);

  // Step 4: Detect raw climb candidates and merge valleys between them
  const rawClimbs = identifyClimbs(segments);
  const mergedClimbs = mergeNearbyClimbs(rawClimbs, segments);

  // Step 5: Trim flat lead-in/tail from each climb and assign category
  let processedClimbs = mergedClimbs
    .map((climb) => {
      const trimmed = trimClimbEndpoints(climb);
      if (trimmed.totalDistance > 0 && trimmed.totalElevation > 0) {
        return categorizeClimb(trimmed);
      }
      return null;
    })
    .filter((c) => c !== null);

  // Step 6: Split climbs that contain long flat sections (>400m at <2%)
  processedClimbs = processedClimbs
    .flatMap((climb) => splitAntiGreenClimbs(climb))
    .filter((c) => c !== null);

  // Step 7: Re-merge any adjacent split pieces that still belong together.
  // Uses a tighter 1500m gap threshold (vs 2000m initial merge) so that the flat-tail
  // stripping in step 6 correctly exposes real valleys (>1500m) and prevents them re-merging,
  // while still joining sub-climbs separated only by a small internal flat section (<1500m).
  // mergeNearbyClimbs emits a fresh {totalDistance, totalElevation} object when it
  // merges two climbs; unmerged items pass through unchanged (categorized, without totalDistance).
  if (processedClimbs.length > 1) {
    const reMerged = mergeNearbyClimbs(processedClimbs, segments, 1500);
    processedClimbs = reMerged
      .map((c) => {
        if (c.totalDistance === undefined) return c; // unchanged — already categorized
        const trimmed = trimClimbEndpoints(c);
        return trimmed.totalDistance > 0 && trimmed.totalElevation > 0
          ? categorizeClimb(trimmed)
          : null;
      })
      .filter((c) => c !== null);
  }

  return processedClimbs;
}

// ─── Step 2: Resampling ───────────────────────────────────────────────────────

/**
 * Remove GPS points closer than RESAMPLE_THRESHOLD to eliminate micro-jitter
 * and unnecessary intermediate points in flat/low-gradient areas.
 *
 * @param {Array} profile - [{distance, elevation, lat, lon}, ...]
 * @returns {Array}
 */
function resamplePoints(profile) {
  if (profile.length <= 2) return profile;

  const RESAMPLE_THRESHOLD = 12; // meters — points closer than this are merged

  const resampled = [profile[0]];

  for (let i = 1; i < profile.length; i++) {
    const prev = resampled[resampled.length - 1];
    const curr = profile[i];
    if (curr.distance - prev.distance >= RESAMPLE_THRESHOLD) {
      resampled.push(curr);
    }
  }

  // Always include the final point
  if (resampled[resampled.length - 1].distance !== profile[profile.length - 1].distance) {
    resampled.push(profile[profile.length - 1]);
  }

  return resampled;
}

// ─── Step 3: Smoothing ────────────────────────────────────────────────────────

/**
 * Smooth elevation using an adaptive window:
 *   steep (>8%)  → 50 m   window  (preserves sharp ramps)
 *   rolling      → scales 50–250 m
 *   flat (<3%)   → 250 m  window  (filters DEM noise)
 *
 * Then passes the result through filterNoiseSpikes.
 *
 * @param {Array} profile - [{distance, elevation, lat, lon}, ...]
 * @returns {Array}
 */
function smoothElevationProfile(profile) {
  if (profile.length <= 2) return profile;

  // Pass 1: Estimate local gradient magnitude at each point using a 500 m window.
  // Two-pointer sweep — O(n) instead of O(n²).
  const localGradients = new Array(profile.length);
  let lo = 0,
    hi = 0;
  let sumGrad = 0,
    sumWeight = 0;
  const GRAD_WINDOW = 500;

  for (let i = 0; i < profile.length; i++) {
    const center = profile[i].distance;

    // Expand hi to include all points within GRAD_WINDOW ahead
    while (hi < profile.length && profile[hi].distance - center <= GRAD_WINDOW) {
      const dist = Math.abs(profile[hi].distance - center);
      const weight = 1 - dist / GRAD_WINDOW;
      const eleChange = Math.abs(profile[hi].elevation - profile[i].elevation);
      const grad = dist > 0 ? eleChange / dist : 0;
      sumGrad += grad * weight;
      sumWeight += weight;
      hi++;
    }

    // Shrink lo to drop points that have fallen behind the window
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

  // Pass 2: Rolling average with adaptive window width. Two-pointer sweep — O(n).
  const smoothed = new Array(profile.length);
  let wlo = 0,
    whi = 0;
  let wSumElev = 0,
    wCount = 0;

  for (let i = 0; i < profile.length; i++) {
    const localGrad = localGradients[i];

    let windowMeters;
    if (localGrad > 0.08) {
      windowMeters = 50;
    } else if (localGrad > 0.03) {
      windowMeters = 50 + ((0.08 - localGrad) / 0.05) * 100; // 50–150
    } else {
      windowMeters = 150 + ((0.03 - localGrad) / 0.03) * 100; // 150–250
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

  // Pass 3: Remove one-sided elevation spikes introduced by DEM noise
  return filterNoiseSpikes(smoothed);
}

/**
 * Interpolate away one-sided elevation spikes (DEM artifacts).
 * A point is a spike when the gradient approaching it is steep (>12%)
 * while the gradient leaving it is gentle (<8%), or vice versa.
 *
 * @param {Array} profile - [{distance, elevation, ...}, ...]
 * @returns {Array}
 */
function filterNoiseSpikes(profile) {
  if (profile.length <= 2) return profile;

  const SPIKE_THRESHOLD = 0.12; // >12% gradient is suspicious
  const NEIGHBOR_THRESHOLD = 0.08; // gentle side must be <8%

  const result = profile.map((p) => ({ ...p }));
  const original = profile; // immutable reference for neighbor reads

  for (let i = 1; i < result.length - 1; i++) {
    const prev = original[i - 1];
    const curr = original[i];
    const next = original[i + 1];

    const prevGrad = Math.abs((curr.elevation - prev.elevation) / (curr.distance - prev.distance));
    const nextGrad = Math.abs((next.elevation - curr.elevation) / (next.distance - curr.distance));

    // One-sided spike: steep on one side, gentle on the other → interpolate
    if (
      (prevGrad > SPIKE_THRESHOLD && nextGrad < NEIGHBOR_THRESHOLD) ||
      (nextGrad > SPIKE_THRESHOLD && prevGrad < NEIGHBOR_THRESHOLD)
    ) {
      result[i].elevation = (prev.elevation + next.elevation) / 2;
    }
  }

  return result;
}

// ─── Step 3b: Gradient calculation ──────────────────────────────────────────

/**
 * Compute per-segment gradient: (Δelevation / Δdistance) × 100.
 *
 * @param {Array} profile - [{distance, elevation, lat, lon}, ...]
 * @returns {Segment[]} - [{startDistance, endDistance, distance, elevation, gradient,
 *                          startElevation, endElevation, startLat, startLon, endLat, endLon}]
 */
function calculateGradients(profile) {
  const segments = [];

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
      gradient: gradient,
      startElevation: prev.elevation,
      endElevation: curr.elevation,
      startLat: prev.lat ?? null,
      startLon: prev.lon ?? null,
      endLat: curr.lat ?? null,
      endLon: curr.lon ?? null,
    });
  }

  return segments;
}

// ─── Step 4: Climb identification ────────────────────────────────────────────

/**
 * Identify climb regions using a sliding window.
 *
 * Design decisions:
 * - Start grade 2% (not 3%) — catches gentler Czech/Slovak hills
 * - Min length 300 m (not 500 m) — catches shorter real climbs
 * - Descent closes a climb after 150 m cumulative (not 300 m)
 * - Descent trigger at −1% — brief −0.5% rollers don't split a climb
 * - Always reset after sufficient descent — prevents descents poisoning the
 *   next climb candidate
 * - Trailing descent stripped before saving — avoids dragging avg grade down
 *
 * @param {Segment[]} segments
 * @returns {RawClimb[]} - [{segments, totalDistance, totalElevation}]
 */
function identifyClimbs(segments) {
  const CLIMB_START_GRADE = 2; // % — gradient that opens a climb
  const MIN_CLIMB_DISTANCE = 300; // m
  const MIN_CLIMB_ELEV = 30; // m — minimum net elevation gain
  const DESCENT_GRADE = -1; // % — gradient counted as descent
  const DESCENT_DISTANCE = 150; // m — cumulative descent that closes a climb
  const MIN_AVG_GRADE = 2; // % — minimum average grade

  const climbs = [];
  let currentClimb = null;
  let descentDistance = 0;

  for (const segment of segments) {
    if (segment.gradient <= DESCENT_GRADE) {
      descentDistance += segment.distance;
    } else {
      descentDistance = 0;
    }

    if (segment.gradient >= CLIMB_START_GRADE && currentClimb === null) {
      currentClimb = {
        segments: [segment],
        totalDistance: segment.distance,
        totalElevation: segment.elevation,
      };
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

  // Save a climb that ends at the route finish (no trailing descent)
  if (currentClimb && currentClimb.totalDistance >= MIN_CLIMB_DISTANCE) {
    pushClimb(currentClimb, climbs, MIN_CLIMB_DISTANCE, MIN_CLIMB_ELEV, MIN_AVG_GRADE);
  }

  return climbs;
}

/**
 * Validate a climb candidate and push it to the results array.
 * Strips any downhill tail to keep stats reflecting only the ascent.
 *
 * @param {RawClimb} climb
 * @param {RawClimb[]} climbs - destination array (mutated)
 * @param {number} minDist
 * @param {number} minElev
 * @param {number} minGrade
 */
function pushClimb(climb, climbs, minDist, minElev, minGrade) {
  const candidate = { ...climb, segments: [...climb.segments] };

  while (
    candidate.segments.length > 0 &&
    candidate.segments[candidate.segments.length - 1].gradient < 0
  ) {
    const removed = candidate.segments.pop();
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

/**
 * Merge consecutive climbs separated by a short valley.
 *
 * Two climbs are merged when BOTH:
 *   1. Gap distance ≤ maxGapDistance
 *   2. Valley depth ≤ max(50 m, combinedGain × 15%)
 *
 * Applied left-to-right so a chain A→B→C collapses into ABC naturally.
 *
 * @param {Object[]} climbs      - from identifyClimbs or a previous pipeline step
 * @param {Segment[]} allSegments - full gradient array (used to fill the gap)
 * @param {number} [maxGapDistance=2000] - hard upper bound on valley length (m)
 * @returns {Object[]}
 */
function mergeNearbyClimbs(climbs, allSegments, maxGapDistance = 2000) {
  if (climbs.length <= 1) return climbs;

  const MAX_VALLEY_DROP_ABS = 50; // m  — always merge when drop ≤ this
  const RELATIVE_VALLEY_RATIO = 0.15; // 15% of combined gain is also acceptable

  const result = [climbs[0]];

  for (let i = 1; i < climbs.length; i++) {
    const prev = result[result.length - 1];
    const curr = climbs[i];

    const prevLastSeg = prev.segments[prev.segments.length - 1];
    const currFirstSeg = curr.segments[0];

    const gapDistance = currFirstSeg.startDistance - prevLastSeg.endDistance;
    const elevDrop = prevLastSeg.endElevation - currFirstSeg.startElevation;

    // Supports both field conventions: totalElevation (pre-categorize) and elevation (post-categorize)
    const combinedGain =
      (prev.totalElevation ?? prev.elevation ?? 0) + (curr.totalElevation ?? curr.elevation ?? 0);
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

/**
 * Strip flat lead-in and tail from a climb (segments with grade < 1.5%).
 * Interior segments are preserved regardless of gradient.
 *
 * @param {Object} climb - {segments, totalDistance, totalElevation, ...}
 * @returns {Object} - same shape, possibly with trimmed segments
 */
function trimClimbEndpoints(climb) {
  const TRIM_THRESHOLD = 1.5; // % — trim below this at either end
  const MIN_REMAINING = 100; // m — discard if less than this remains

  const trimmed = { ...climb, segments: [...climb.segments] };
  if (!trimmed.segments || trimmed.segments.length === 0) return trimmed;

  let startIndex = 0;
  while (
    startIndex < trimmed.segments.length &&
    trimmed.segments[startIndex].gradient < TRIM_THRESHOLD
  ) {
    startIndex++;
  }

  let endIndex = trimmed.segments.length - 1;
  while (endIndex >= 0 && trimmed.segments[endIndex].gradient < TRIM_THRESHOLD) {
    endIndex--;
  }

  if (startIndex > endIndex) {
    trimmed.segments = [];
    trimmed.totalDistance = 0;
    trimmed.totalElevation = 0;
    return trimmed;
  }

  const climbSegments = trimmed.segments.slice(startIndex, endIndex + 1);
  let newDistance = 0,
    newElev = 0;
  for (const seg of climbSegments) {
    newDistance += seg.distance;
    newElev += seg.elevation;
  }

  if (newDistance >= MIN_REMAINING) {
    trimmed.segments = climbSegments;
    trimmed.totalDistance = newDistance;
    trimmed.totalElevation = newElev;
  } else {
    trimmed.segments = [];
    trimmed.totalDistance = 0;
    trimmed.totalElevation = 0;
  }

  return trimmed;
}

/**
 * Assign a ProCyclingStats difficulty score and category to a climb.
 *
 * Score = distance(km) × avgGrade(%) × 100
 *   HC  ≥ 40 000
 *   1   ≥ 16 000
 *   2   ≥  8 000
 *   3   ≥  3 000
 *   4   <  3 000
 *
 * @param {Object} climb - {segments, totalDistance, totalElevation, ...}
 * @returns {Climb|null}
 */
function categorizeClimb(climb) {
  if (!climb || climb.totalDistance === 0 || climb.totalElevation === 0) return null;

  const distanceKm = climb.totalDistance / 1000;
  const avgGrade = (climb.totalElevation / climb.totalDistance) * 100;
  const difficulty = distanceKm * avgGrade * 100;

  let category = "4";
  if (difficulty >= 40000) category = "HC";
  else if (difficulty >= 16000) category = "1";
  else if (difficulty >= 8000) category = "2";
  else if (difficulty >= 3000) category = "3";

  const firstSeg = climb.segments[0];
  const lastSeg = climb.segments[climb.segments.length - 1];

  return {
    distance: climb.totalDistance,
    elevation: climb.totalElevation,
    avgGrade: avgGrade,
    difficulty: difficulty,
    category: category,
    segments: climb.segments,
    markerCoords:
      firstSeg?.startLat != null ? { lat: firstSeg.startLat, lon: firstSeg.startLon } : null,
    endCoords: lastSeg?.endLat != null ? { lat: lastSeg.endLat, lon: lastSeg.endLon } : null,
  };
}

// ─── Step 6: Anti-green splitting ────────────────────────────────────────────

/**
 * Split a climb that contains a section > 400 m with grade < 2%
 * to avoid a large green void in the elevation chart UI.
 *
 * Each resulting sub-climb has its flat tail stripped so that the
 * post-split re-merge step can correctly measure the valley gap.
 *
 * @param {Climb} climb
 * @returns {Object[]} - 1 (unchanged) or 2+ sub-climbs
 */
function splitAntiGreenClimbs(climb) {
  if (!climb || !climb.segments || climb.segments.length < 2) return [climb];

  const FLAT_THRESHOLD = 2; // % gradient
  const FLAT_LENGTH_THRESHOLD = 400; // m — flat run that triggers a split
  const MINIMUM_CLIMB_DISTANCE = 300; // m
  const MINIMUM_CLIMB_ELEVATION = 30; // m
  const MINIMUM_CLIMB_GRADE = 2; // %

  const splits = [];
  let currentClimb = null;
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
        // Strip flat tail to expose the true valley to the re-merge step
        while (
          currentClimb.segments.length > 0 &&
          currentClimb.segments[currentClimb.segments.length - 1].gradient < FLAT_THRESHOLD
        ) {
          const removed = currentClimb.segments.pop();
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
          // coords resolved from own segments once sub-climb is finalized
          avgGrade: climb.avgGrade,
          difficulty: climb.difficulty,
          category: climb.category,
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
    sc.markerCoords = first?.startLat != null ? { lat: first.startLat, lon: first.startLon } : null;
    sc.endCoords = last?.endLat != null ? { lat: last.endLat, lon: last.endLon } : null;
  }

  return splits;
}

// ─── Test exports ─────────────────────────────────────────────────────────────
// These are not consumed by the Chrome extension. They exist solely so that
// the Vitest suite can unit-test the internal pipeline steps in isolation.
export { resamplePoints, smoothElevationProfile, mergeNearbyClimbs, categorizeClimb };
