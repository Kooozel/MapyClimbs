/**
 * test/climb-engine.test.js
 *
 * Unit tests for the climb-detection pipeline in `src/climb-engine.ts`.
 * Each internal step is tested in isolation; detectClimbs covers the full pipeline.
 *
 * Run: npm test
 * Coverage: npm run test:coverage
 */

import { describe, it, expect } from 'vitest';
import {
  detectClimbs,
  DEFAULT_CLIMB_CONFIG,
  _resamplePoints as resamplePoints,
  _interpolateProfile as interpolateProfile,
  _smoothElevationProfile as smoothElevationProfile,
  _mergeNearbyClimbs as mergeNearbyClimbs,
  _measureClimb as measureClimb,
  _trimAndMeasure as trimAndMeasure,
  _snapAllEndCoords as snapAllEndCoords,
} from '../src/climb-engine.ts';

// ─── Shared helpers ──────────────────────────────────────────────────────────

/** Create a structured profile point (the shape resamplePoints / smoothElevation expect). */
function pt(distance, elevation, lat = 48.0, lon = 16.0) {
  return { distance, elevation, lat, lon };
}

/**
 * Create a minimal segment object (the shape mergeNearbyClimbs / measureClimb expect).
 * grade is derived automatically from the elevation arguments.
 */
function seg(startDist, endDist, startElev, endElev, lat1 = 48.0, lon1 = 16.0, lat2 = 48.1, lon2 = 16.1) {
  const dist = endDist - startDist;
  const elev = endElev - startElev;
  return {
    startDistance:  startDist,
    endDistance:    endDist,
    distance:       dist,
    elevation:      elev,
    gradient:       dist > 0 ? (elev / dist) * 100 : 0,
    startElevation: startElev,
    endElevation:   endElev,
    startLat: lat1, startLon: lon1,
    endLat:   lat2, endLon:   lon2,
  };
}

/**
 * Wrap segments in the climb shape that mergeNearbyClimbs accepts
 * (totalDistance / totalElevation fields, same as identifyClimbs output).
 */
function rawClimb(segments) {
  let totalDistance = 0, totalElevation = 0;
  for (const s of segments) {
    totalDistance  += s.distance;
    totalElevation += s.elevation;
  }
  return { segments, totalDistance, totalElevation };
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

/**
 * Fixture 1 — flat route.
 * 200 points spaced 30 m apart at a constant elevation of 250 m → 0 climbs expected.
 */
const FLAT_ROUTE = Array.from({ length: 200 }, (_, i) => [i * 30, 250, 48.0 + i * 0.00025, 16.0]);

/**
 * Fixture 2 — single steady climb.
 * 1 km flat lead-in → 8 km ramp at 7.5 % → short flat tail.
 * Expected: 1 climb, Cat 2 (score ≈ 450, within [300, 600)).
 *
 * Points are spaced 25 m apart (well above the 12 m resample threshold so
 * none are dropped and the gradient is preserved accurately through the pipeline).
 */
function makeSingleClimbRoute() {
  const points = [];
  // 1 km flat approach (40 points × 25 m)
  for (let i = 0; i <= 40; i++) {
    points.push([i * 25, 300, 48.0 + i * 0.00022, 16.0]);
  }
  // 8 km at exactly 7.5 % grade (320 points × 25 m = 8 000 m, +600 m elevation)
  for (let i = 1; i <= 320; i++) {
    const d = 1000 + i * 25;
    const e = 300 + (i * 25) * 0.075;
    points.push([d, e, 48.009 + i * 0.00022, 16.0]);
  }
  // 500 m flat tail so the trimmer has something to strip
  for (let i = 1; i <= 20; i++) {
    points.push([9000 + i * 25, 900, 48.079 + i * 0.00022, 16.0]);
  }
  return points;
}

/**
 * Fixture 3 — two distinct climbs separated by a 6 km valley.
 * Climb A: 0–5 km at 6 % (+300 m).
 * Valley : 5–11 km descent at 4 % then flat (well over the 2 000 m merge threshold).
 * Climb B: 11–19 km at 8 % (+640 m).
 * Expected: 2 climbs.
 */
function makeMultiClimbRoute() {
  const points = [];

  // Climb A — 5 km at 6 %
  for (let i = 0; i <= 200; i++) {
    points.push([i * 25, 400 + i * 25 * 0.06, 48.0 + i * 0.00022, 16.0]);
  }

  // Valley — 4 km descent at −4 % (from ~700 m down to ~540 m)
  const c1EndElev = points[points.length - 1][1];
  for (let i = 1; i <= 160; i++) {
    const d = 5000 + i * 25;
    const e = c1EndElev - i * 25 * 0.04;
    points.push([d, e, 48.044 + i * 0.00022, 16.0]);
  }

  // Flat bottom — 2 km flat at 380 m (ensures total valley > 6 km)
  for (let i = 1; i <= 80; i++) {
    points.push([9000 + i * 25, 380, 48.079 + i * 0.00022, 16.0]);
  }

  // Climb B — 8 km at 8 % (from d = 11 000)
  for (let i = 1; i <= 320; i++) {
    const d = 11000 + i * 25;
    const e = 380 + i * 25 * 0.08;
    points.push([d, e, 48.097 + i * 0.00022, 16.0]);
  }

  return points;
}

// ─── resamplePoints ──────────────────────────────────────────────────────────

describe('resamplePoints', () => {
  it('returns profiles of 2 or fewer points unchanged', () => {
    const one = [pt(0, 100)];
    expect(resamplePoints(one)).toBe(one);

    const two = [pt(0, 100), pt(500, 150)];
    expect(resamplePoints(two)).toBe(two);
  });

  it('keeps the first and last point regardless of spacing', () => {
    // All interior points are < 12 m apart and will be dropped.
    const profile = [
      pt(0, 100),
      pt(5, 101),
      pt(8, 102),
      pt(11, 103),
      pt(5000, 200), // last point — very far, must always be kept
    ];
    const result = resamplePoints(profile);
    expect(result[0]).toBe(profile[0]);
    expect(result[result.length - 1]).toBe(profile[profile.length - 1]);
  });

  it('drops points that are closer than 12 m to the previous kept point', () => {
    const profile = [
      pt(0,   100),
      pt(5,   101),  // 5 m gap → drop
      pt(9,   102),  // 4 m gap → drop
      pt(13,  103),  // 4 m gap from prev kept (0) but 13 m from start → keep
      pt(20,  104),  // 7 m gap from 13 → drop
      pt(50,  105),  // 37 m gap from 13 → keep
      pt(100, 110),  // 50 m gap → keep
    ];
    const result = resamplePoints(profile);
    // Gaps between consecutive kept points must all be >= 12 m
    for (let i = 1; i < result.length - 1; i++) {
      expect(result[i].distance - result[i - 1].distance).toBeGreaterThanOrEqual(12);
    }
  });

  it('produces at least 2 points for a non-trivial profile', () => {
    // 50 tightly packed points (2 m apart) — only first and last survive
    const profile = Array.from({ length: 50 }, (_, i) => pt(i * 2, 100 + i * 0.1));
    const result = resamplePoints(profile);
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it('does not drop points that are exactly 12 m apart', () => {
    const profile = [pt(0, 100), pt(12, 101), pt(24, 102), pt(36, 103)];
    const result = resamplePoints(profile);
    // 12 m gap is exactly the threshold — points should be kept
    expect(result.length).toBe(4);
  });
});

// ─── interpolateProfile ───────────────────────────────────────────────────────

describe('interpolateProfile', () => {
  it('returns a single point unchanged', () => {
    const single = [pt(0, 100)];
    expect(interpolateProfile(single)).toBe(single);
  });

  it('does not insert points when all gaps are within INTERPOLATE_MAX_GAP_M (25 m)', () => {
    const profile = [pt(0, 100), pt(20, 110), pt(40, 120)];
    const result = interpolateProfile(profile);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual(profile[0]);
    expect(result[1]).toEqual(profile[1]);
    expect(result[2]).toEqual(profile[2]);
  });

  it('fills a wide gap so the maximum inter-point distance is approximately RESAMPLE_MIN_INTERVAL_M', () => {
    const profile = [pt(0, 0), pt(120, 60)]; // 120 m gap → exceeds 25 m threshold, should be filled
    const result = interpolateProfile(profile);
    expect(result.length).toBeGreaterThan(2);
    for (let i = 1; i < result.length; i++) {
      expect(result[i].distance - result[i - 1].distance).toBeLessThanOrEqual(25);
    }
    // Original endpoints preserved
    expect(result[0].distance).toBe(0);
    expect(result[result.length - 1].distance).toBe(120);
  });

  it('interpolates elevation linearly between endpoints', () => {
    const profile = [pt(0, 0), pt(120, 120)]; // 120 m gap, 120 m elevation (slope = 1)
    const result = interpolateProfile(profile);
    for (const p of result) {
      // On a straight line: elevation == distance (slope = 1)
      expect(p.elevation).toBeCloseTo(p.distance, 6);
    }
  });

  it('interpolates lat/lon linearly between endpoints', () => {
    const a = { distance: 0, elevation: 0, lat: 48.0, lon: 16.0 };
    const b = { distance: 120, elevation: 10, lat: 48.12, lon: 16.12 };
    const result = interpolateProfile([a, b]);
    expect(result.length).toBeGreaterThan(2);
    for (const p of result) {
      const t = p.distance / 120;
      expect(p.lat).toBeCloseTo(48.0 + t * 0.12, 8);
      expect(p.lon).toBeCloseTo(16.0 + t * 0.12, 8);
    }
  });

  it('sets lat/lon to null for interpolated points when either endpoint has null coords', () => {
    const a = { distance: 0, elevation: 0, lat: null, lon: null };
    const b = { distance: 100, elevation: 10, lat: null, lon: null };
    const result = interpolateProfile([a, b]);
    for (const p of result) {
      expect(p.lat).toBeNull();
      expect(p.lon).toBeNull();
    }
  });
});

// ─── smoothElevationProfile ───────────────────────────────────────────────────

describe('smoothElevationProfile', () => {
  it('returns profiles with 2 or fewer points unchanged', () => {
    const two = [pt(0, 100), pt(500, 150)];
    expect(smoothElevationProfile(two)).toBe(two);
  });

  it('returns the same number of points as the input', () => {
    const profile = Array.from({ length: 100 }, (_, i) => pt(i * 30, 300 + i * 0.5));
    const result = smoothElevationProfile(profile);
    expect(result.length).toBe(profile.length);
  });

  it('does not change distance or coordinate values — only elevation', () => {
    const profile = Array.from({ length: 40 }, (_, i) => pt(i * 50, 200 + i));
    const result = smoothElevationProfile(profile);
    for (let i = 0; i < profile.length; i++) {
      expect(result[i].distance).toBe(profile[i].distance);
      expect(result[i].lat).toBe(profile[i].lat);
      expect(result[i].lon).toBe(profile[i].lon);
    }
  });

  it('reduces a prominent one-sided spike', () => {
    // 51 points at 12 m spacing (matching post-interpolation point density):
    // 25 flat at 100 m, one spike at 300 m, 25 flat at 103 m.
    // With a 50 m triangular-kernel window the spike gains 4 neighbours on each
    // side (12, 24, 36, 48 m away), all at ~100 m, pulling the weighted average
    // well below the raw peak.
    const profile = [
      ...Array.from({ length: 25 }, (_, i) => pt(i * 12, 100)),
      pt(25 * 12, 300),  // spike
      ...Array.from({ length: 25 }, (_, i) => pt((26 + i) * 12, 103)),
    ];

    const result = smoothElevationProfile(profile);
    // Spike must be substantially reduced toward the flat baseline (~100 m)
    expect(result[25].elevation).toBeLessThan(200);
  });

  it('leaves a smooth monotone climb largely intact (elevation keeps rising)', () => {
    // 200 points, each 25 m and +1.25 m elevation = 5 % grade
    const profile = Array.from({ length: 200 }, (_, i) => pt(i * 25, 200 + i * 1.25));
    const result = smoothElevationProfile(profile);
    // Profile should still be generally increasing end-to-end
    expect(result[result.length - 1].elevation).toBeGreaterThan(result[0].elevation);
    // The overall range should be preserved within ±20 % of the input range
    const inputRange  = profile[profile.length - 1].elevation - profile[0].elevation;
    const outputRange = result[result.length - 1].elevation  - result[0].elevation;
    expect(outputRange).toBeGreaterThan(inputRange * 0.8);
  });
});

// ─── mergeNearbyClimbs ────────────────────────────────────────────────────────

describe('mergeNearbyClimbs', () => {
  it('returns a single-element array unchanged', () => {
    const climb = rawClimb([seg(0, 3000, 100, 280)]);          // +180 m
    const result = mergeNearbyClimbs([climb], []);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(climb);
  });

  it('merges two climbs when gap ≤ 2000 m and valley drop ≤ threshold', () => {
    //   Climb A: d=0..3000, 100→300 (+200 m)
    //   Valley : d=3000..4000, 300→260 (−40 m drop — well within max(50, 450×0.15)=67.5 m)
    //   Climb B: d=4000..7000, 260→510 (+250 m)
    const segA    = seg(0,    3000, 100, 300);
    const valSeg  = seg(3000, 4000, 300, 260);
    const segB    = seg(4000, 7000, 260, 510);

    const climbA = rawClimb([segA]);    // totalElevation = 200
    const climbB = rawClimb([segB]);    // totalElevation = 250

    const allSegs    = [segA, valSeg, segB];
    const result     = mergeNearbyClimbs([climbA, climbB], allSegs);

    expect(result).toHaveLength(1);
    expect(result[0].totalDistance).toBeCloseTo(segA.distance + valSeg.distance + segB.distance, 0);
    expect(result[0].totalElevation).toBeCloseTo(segA.elevation + valSeg.elevation + segB.elevation, 1);
  });

  it('does NOT merge climbs when gap > 2000 m', () => {
    const segA = seg(0,    3000, 100, 300);
    const segB = seg(6000, 9000, 200, 460); // gap = 6000 - 3000 = 3000 m > 2000 m

    const result = mergeNearbyClimbs([rawClimb([segA]), rawClimb([segB])], [segA, segB]);
    expect(result).toHaveLength(2);
  });

  it('does NOT merge climbs when valley drop exceeds the threshold', () => {
    //   Climb A ends at 300 m; Climb B starts at 150 m → drop = 150 m.
    //   Combined gain = 200 + 250 = 450 m → maxAllowed = max(50, 67.5) = 67.5 m.
    //   150 > 67.5 → no merge.
    const segA = seg(0,    3000, 100, 300);
    const segB = seg(3500, 6500, 150, 400);  // gap = 500 m, drop = 300 - 150 = 150 m

    const result = mergeNearbyClimbs([rawClimb([segA]), rawClimb([segB])], [segA, segB]);
    expect(result).toHaveLength(2);
  });

  it('gap tolerance scales with combined elevation gain', () => {
    // Both scenarios have a 1 400 m gap between two climbs.
    // Small climbs (30 m + 30 m = 60 m combined): bonus = min(60×2, 4000) = 120 m
    //   → effectiveMaxGap = 1000 + 120 = 1120 m  <  1400 m  → NOT merged.
    // Large climbs (400 m + 380 m = 780 m combined): bonus = min(780×2, 4000) = 1560 m
    //   → effectiveMaxGap = 1000 + 1560 = 2560 m  >  1400 m  → merged.
    const smallA = seg(0,    1000, 100, 130);   // +30 m
    const smallB = seg(2400, 3400, 129, 159);   // +30 m, gap = 1400 m, drop = 1 m
    const resultSmall = mergeNearbyClimbs([rawClimb([smallA]), rawClimb([smallB])], [smallA, smallB]);
    expect(resultSmall).toHaveLength(2);

    const largeA = seg(0,    5000, 100, 500);   // +400 m
    const largeB = seg(6400, 10000, 495, 875);  // +380 m, gap = 1400 m, drop = 5 m
    const resultLarge = mergeNearbyClimbs([rawClimb([largeA]), rawClimb([largeB])], [largeA, largeB]);
    expect(resultLarge).toHaveLength(1);
  });

  it('merges a chain of three climbs in one pass', () => {
    const s1 = seg(0,    2000, 100, 260);   // +160 m
    const s2 = seg(2100, 4000, 255, 375);   // +120 m, gap 100 m, drop 5 m
    const s3 = seg(4200, 6000, 368, 520);   // +152 m, gap 200 m, drop 7 m

    const all = [s1, s2, s3];
    const result = mergeNearbyClimbs([rawClimb([s1]), rawClimb([s2]), rawClimb([s3])], all);
    expect(result).toHaveLength(1);
  });
});

// ─── measureClimb ────────────────────────────────────────────────────────────

describe('measureClimb', () => {
  /**
   * Helper: build a minimal but valid climb object that measureClimb accepts.
   * The single segment gives the function start/end coords + gradient.
   */
  function makeClimb(totalDistanceM, totalElevationM) {
    const segment = seg(0, totalDistanceM, 100, 100 + totalElevationM);
    return { segments: [segment], totalDistance: totalDistanceM, totalElevation: totalElevationM };
  }

  // The only nulls left. They are degenerate shapes, not verdicts: scoring left
  // the pipeline in #77, so nothing here can reject a real climb any more.

  it('returns null for a climb with zero distance', () => {
    expect(measureClimb(makeClimb(0, 100))).toBeNull();
  });

  it('returns null for a climb with zero elevation', () => {
    expect(measureClimb(makeClimb(5000, 0))).toBeNull();
  });

  it('returns null for a null climb', () => {
    expect(measureClimb(null)).toBeNull();
  });

  it('measures a climb no scoring model would keep', () => {
    // 300 m at 4 %: below ASO's Uncategorized floor of 8, so the old pipeline
    // dropped it here and stored it in droppedCandidates. It is a measurement
    // like any other now, and deciding it is not a climb is the caller's job.
    const result = measureClimb(makeClimb(300, 12));

    expect(result).not.toBeNull();
    expect(result.distance).toBe(300);
    expect(result.avgGrade).toBeCloseTo(4, 5);
    expect(result).not.toHaveProperty('category');
    expect(result).not.toHaveProperty('difficulty');
  });

  it('returns a complete measurement with all required fields', () => {
    const result = measureClimb(makeClimb(8000, 480));

    expect(result).toMatchObject({
      distance: expect.any(Number),
      elevation: expect.any(Number),
      avgGrade: expect.any(Number),
      maxSustainedGradient: expect.any(Number),
      segments: expect.any(Array),
    });
    expect(result.markerCoords).not.toBeNull(); // seg() supplies lat/lon
    expect(result.endCoords).not.toBeNull();
  });

  it('computes avgGrade correctly', () => {
    // 6 000 m gain 300 m → avgGrade = 5 %
    const result = measureClimb(makeClimb(6000, 300));
    expect(result.avgGrade).toBeCloseTo(5, 5);
  });

  it('measures maxSustainedGradient so no scorer has to walk the segments', () => {
    // One 6 % segment well over the 200 m window: the sustained figure is the
    // segment's own gradient, as a decimal.
    const result = measureClimb(makeClimb(1000, 60));
    expect(result.maxSustainedGradient).toBeCloseTo(0.06, 5);
  });
});

// ─── trimAndMeasure (step 5a) ────────────────────────────────────────────────

describe('trimAndMeasure', () => {
  /** Collecting sink, so the emitted trace can be asserted on directly. */
  function sink() {
    const events = [];
    const fn = (e) => events.push(e);
    fn.events = events;
    return fn;
  }

  it('strips the flat lead-in and tail before measuring', () => {
    // 200 m flat → 3 km at 5 % → 200 m flat. Only the ramp survives the trim.
    const candidate = rawClimb([
      seg(0, 200, 100, 100),
      seg(200, 3200, 100, 250),
      seg(3200, 3400, 250, 250),
    ]);

    const climbs = trimAndMeasure([candidate], sink());

    expect(climbs).toHaveLength(1);
    expect(climbs[0].segments).toHaveLength(1);
    expect(climbs[0].distance).toBe(3000);
    expect(climbs[0].avgGrade).toBeCloseTo(5, 5);
  });

  it('returns a candidate no model would score, rather than dropping it', () => {
    // 300 m at 4 % → ASO score 4.8, below its Uncategorized threshold of 8.
    // This step used to drop it into droppedCandidates so a switch to a more
    // permissive model could recover it; there is nothing to recover from now
    // because nothing is thrown away (#77).
    const candidate = rawClimb([seg(0, 300, 100, 112)]);

    const climbs = trimAndMeasure([candidate], sink());

    expect(climbs).toHaveLength(1);
    expect(climbs[0].distance).toBe(300);
  });

  it('drops a candidate that trims away to nothing', () => {
    const flat = rawClimb([seg(0, 500, 100, 100)]);

    expect(trimAndMeasure([flat], sink())).toHaveLength(0);
  });

  it('emits trim then measure for a survivor, and trim alone for a reject', () => {
    const kept = rawClimb([seg(0, 200, 100, 100), seg(200, 3200, 100, 250)]);
    const dropped = rawClimb([seg(4000, 4500, 250, 250)]);
    const emit = sink();

    trimAndMeasure([kept, dropped], emit);

    expect(emit.events.map((e) => e.stage)).toEqual(['trim', 'measure', 'trim']);
    expect(emit.events[0].kept).toBe(true);
    expect(emit.events[0].droppedHeadSegs).toBe(1);
    expect(emit.events[1].distanceM).toBe(3000);
    expect(emit.events[1].avgGradePct).toBeCloseTo(5, 5);
    expect(emit.events[2].kept).toBe(false);
  });
});

// ─── snapAllEndCoords (step 5b) ──────────────────────────────────────────────

describe('snapAllEndCoords', () => {
  /**
   * Raw profile at 20 m spacing. lat is derived from distance so the point a
   * climb snapped to can be identified from the resulting endCoords.
   */
  function profile(lengthM, elevAt) {
    const points = [];
    for (let d = 0; d <= lengthM; d += 20) points.push(pt(d, elevAt(d), 48 + d / 1e6, 16));
    return points;
  }

  const latAt = (d) => 48 + d / 1e6;

  /** A measured climb, built the way detectClimbs builds the ones it snaps. */
  function climb(segments) {
    return measureClimb(rawClimb(segments));
  }

  it('extends a lone climb to the raw peak past its summit', () => {
    // Ramp to 200 m at d = 1 000, still rising to 210 m at d = 1 100, then down.
    const raw = profile(1300, (d) =>
      d <= 1000 ? 100 + d * 0.1 : d <= 1100 ? 200 + (d - 1000) * 0.1 : 210 - (d - 1100) * 0.1
    );

    const [snapped] = snapAllEndCoords([climb([seg(0, 1000, 100, 200)])], raw);

    expect(snapped.segments).toHaveLength(2);
    expect(snapped.distance).toBe(1100);
    expect(snapped.endCoords.lat).toBeCloseTo(latAt(1100), 6);
  });

  // The peak sits 140 m past climb 1's summit — inside the 150 m the single-climb
  // helper allows, so only the half-gap clamp can keep the two climbs apart.
  const twoClimbElev = (d) =>
    d <= 1000 ? 100 + d * 0.1 : d <= 1060 ? 200 : d <= 1140 ? 200 + (d - 1060) * 0.125 : 210;

  it('clamps the lookahead to half the gap before the next climb', () => {
    const raw = profile(1300, twoClimbElev);
    const climbs = [climb([seg(0, 1000, 100, 200)]), climb([seg(1100, 2100, 200, 300)])];

    const [first] = snapAllEndCoords(climbs, raw);

    // Gap 100 m → lookahead 50 m, which stops short of the rise at 1 060 m.
    expect(first).toBe(climbs[0]);
  });

  it('reaches the same peak once the next climb is far enough away', () => {
    const raw = profile(1300, twoClimbElev);
    const climbs = [climb([seg(0, 1000, 100, 200)]), climb([seg(1400, 2400, 200, 300)])];

    const [first] = snapAllEndCoords(climbs, raw);

    // Gap 400 m → lookahead 200 m, which reaches the peak at 1 140 m.
    expect(first.segments).toHaveLength(2);
    expect(first.endCoords.lat).toBeCloseTo(latAt(1140), 6);
  });

  it('gives the last climb the full lookahead', () => {
    const raw = profile(2600, (d) =>
      d <= 1000
        ? 100 + d * 0.1
        : d <= 1400
          ? 200
          : d <= 2400
            ? 200 + (d - 1400) * 0.1
            : d <= 2500
              ? 300 + (d - 2400) * 0.1
              : 310 - (d - 2500) * 0.1
    );
    const climbs = [climb([seg(0, 1000, 100, 200)]), climb([seg(1400, 2400, 200, 300)])];

    const [, last] = snapAllEndCoords(climbs, raw);

    expect(last.segments).toHaveLength(2);
    expect(last.endCoords.lat).toBeCloseTo(latAt(2500), 6);
  });
});

// ─── detectClimbs (full pipeline) ─────────────────────────────────────────────

describe('detectClimbs', () => {
  it('returns [] for null input', () => {
    expect(detectClimbs(null).climbs).toEqual([]);
  });

  it('returns [] for undefined input', () => {
    expect(detectClimbs(undefined).climbs).toEqual([]);
  });

  it('returns [] for a single-point array', () => {
    expect(detectClimbs([[0, 100, 48, 16]]).climbs).toEqual([]);
  });

  it('zeroes every route-level field when there is nothing to detect', () => {
    // The empty result comes from one factory (emptyAnalysisResult). This pins
    // its shape so a field added to AnalysisResult but forgotten in the factory
    // fails here rather than only in review.
    expect(detectClimbs([])).toEqual({
      climbs: [],
      totalDistance: 0,
      totalElevationGain: 0,
      totalElevationLoss: 0,
    });
  });

  it('returns the same result for the same input — no clock in the engine', () => {
    // The engine is a library (#68): identical input must give identical output,
    // or snapshot tests and byte-comparing consumers break. Compared as strings
    // rather than with toEqual because a Date.now() landing in the same
    // millisecond would pass a deep-equal check and hide the very thing this
    // pins. The stamp the extension needs is applied at the storage boundary
    // instead — stampResult() in storage.ts.
    const route = makeSingleClimbRoute();
    expect(JSON.stringify(detectClimbs(route))).toBe(JSON.stringify(detectClimbs(route)));
    expect(detectClimbs(route)).not.toHaveProperty('timestamp');
    expect(detectClimbs([])).not.toHaveProperty('timestamp');
  });

  it('returns [] for a flat route with no elevation gain', () => {
    const result = detectClimbs(FLAT_ROUTE);
    expect(result.climbs).toEqual([]);
  });

  it('detects exactly one climb on a clean single-climb route', () => {
    const result = detectClimbs(makeSingleClimbRoute());
    expect(result.climbs).toHaveLength(1);
  });

  it('single climb has correct structure', () => {
    const [climb] = detectClimbs(makeSingleClimbRoute()).climbs;
    expect(climb).toMatchObject({
      distance:             expect.any(Number),
      elevation:            expect.any(Number),
      avgGrade:             expect.any(Number),
      maxSustainedGradient: expect.any(Number),
      segments:             expect.any(Array),
    });
    // Measurement only. A difficulty and a category are what score() adds.
    expect(climb).not.toHaveProperty('difficulty');
    expect(climb).not.toHaveProperty('category');
  });

  it('measures a real maxSustainedGradient for every climb it returns', () => {
    // The hiking model and the CLI's max_grade column both read this field, so
    // a candidate that reached them as 0 would be reported as flat (#69, #77).
    for (const climb of detectClimbs(makeMultiClimbRoute()).climbs) {
      expect(climb.maxSustainedGradient).toBeGreaterThan(0);
    }
  });

  it('snaps every candidate’s summit, including ones no model would keep', () => {
    // The snap used to run after scoring and only over the kept climbs, so a
    // rejected candidate never got a summit at all. Every returned climb now
    // carries endCoords from the same pass (#77).
    for (const climb of detectClimbs(makeMultiClimbRoute()).climbs) {
      expect(climb.endCoords).not.toBeNull();
    }
  });

  it('single climb elevation gain is within ±15 % of the design value (600 m)', () => {
    const [climb] = detectClimbs(makeSingleClimbRoute()).climbs;
    // After trimming and smoothing the 8 km × 7.5 % ramp, gain should be near 600 m
    expect(climb.elevation).toBeGreaterThan(600 * 0.85);
    expect(climb.elevation).toBeLessThan(600 * 1.15);
  });

  it('detects exactly three climbs on a multi-climb route', () => {
    const result = detectClimbs(makeMultiClimbRoute());
    expect(result.climbs).toHaveLength(3);
  });

  it('two climbs are ordered by start distance', () => {
    const [a, b] = detectClimbs(makeMultiClimbRoute()).climbs;
    const aStart = a.segments[0].startDistance;
    const bStart = b.segments[0].startDistance;
    expect(aStart).toBeLessThan(bStart);
  });

  it('last climb has greater elevation gain than first (640 m vs 300 m design)', () => {
    const result = detectClimbs(makeMultiClimbRoute()).climbs;
    const first = result[0];
    const last = result[result.length - 1];
    expect(last.elevation).toBeGreaterThan(first.elevation);
  });

  it('markerCoords and endCoords are populated when lat/lon data is present', () => {
    const [climb] = detectClimbs(makeSingleClimbRoute()).climbs;
    expect(climb.markerCoords).not.toBeNull();
    expect(climb.endCoords).not.toBeNull();
    expect(climb.markerCoords).toHaveProperty('lat');
    expect(climb.markerCoords).toHaveProperty('lon');
  });

  it('returns [] when lat/lon are absent but still runs without error', () => {
    // Elevation data without lat/lon (only [dist, elev])
    const minimal = [
      [0,    300], [25,  302], [50,  304],
      [1000, 300], [1025,298], [1050,297],
    ];
    expect(() => detectClimbs(minimal)).not.toThrow();
  });

  it('two ramps joined by a 2 km flat stay as two climbs', () => {
    // identifyClimbs accumulates 2 km of flat (CLIMB_END_FLAT_M) after ramp 1,
    // strips the flat tail via finalizeRawClimb, and closes the candidate at
    // d = 3 000 m — creating a real 2 000 m gap to ramp 2.
    // Combined gain ≈ 300 m → effectiveMaxGap = 1000 + min(300×2, 4000) = 1600 m.
    // 2 000 m gap > 1 600 m effectiveMaxGap → NOT merged → two separate climbs.
    const points = [];
    // Ramp 1: 0–3 km at 5 % (+150 m)
    for (let i = 0; i <= 150; i++) {
      points.push([i * 20, 500 + i * 20 * 0.05, 48.0 + i * 0.00018, 16.0]);
    }
    // Flat middle: 3 000–5 000 m (2 km, well above 400 m threshold)
    for (let i = 1; i <= 100; i++) {
      points.push([3000 + i * 20, 650, 48.027 + i * 0.00018, 16.0]);
    }
    // Ramp 2: 5 000–8 000 m at 5 % (+150 m)
    for (let i = 1; i <= 150; i++) {
      const d = 5000 + i * 20;
      points.push([d, 650 + i * 20 * 0.05, 48.045 + i * 0.00018, 16.0]);
    }

    const result = detectClimbs(points);
    expect(result.climbs).toHaveLength(2);
  });

  it('detects a short steep climb at 40 % grade', () => {
    // 75 m at 40 % grade (+30 m elevation) followed by a 330 m flat tail.
    // Without geometric floors, the trimmed ~105 m steep section reaches scoring
    // and passes as Cat3 (ASO score ≈ 86).
    const points = [];
    // Steep section: 5 intervals × 15 m, each +6 m (40 % grade)
    for (let i = 0; i <= 5; i++) points.push([i * 15, i * 6, 48.0, 16.0]);
    // Flat tail: 22 intervals × 15 m at elevation 30 m
    for (let i = 1; i <= 22; i++) points.push([75 + i * 15, 30, 48.0 + i * 0.00013, 16.0]);

    const result = detectClimbs(points).climbs;
    expect(result).toHaveLength(1);
  });
});

// ─── Configurable thresholds ─────────────────────────────────────────────────

/**
 * Fixture 4 — a single sustained ramp just above the default start trigger.
 * 500 m flat lead-in → 4 km at 4 % → 500 m flat tail.
 *
 * 4 % sits above CLIMB_START_GRADE_PCT's default of 3.75 and well below 6, so
 * the same route is one climb or none depending purely on that one key.
 */
function makeGentleRampRoute() {
  const points = [];
  for (let i = 0; i <= 20; i++) {
    points.push([i * 25, 300, 48.0 + i * 0.00022, 16.0]);
  }
  for (let i = 1; i <= 160; i++) {
    points.push([500 + i * 25, 300 + i * 25 * 0.04, 48.0044 + i * 0.00022, 16.0]);
  }
  for (let i = 1; i <= 20; i++) {
    points.push([4500 + i * 25, 460, 48.04 + i * 0.00022, 16.0]);
  }
  return points;
}

/**
 * Fixture 5 — two 3 km ramps at 5 % separated by 2 km of flat.
 * The gap is wider than the default effective merge gap, so they stay apart
 * until MERGE_MAX_GAP_M is widened.
 */
function makeTwoRampRoute() {
  const points = [];
  for (let i = 0; i <= 150; i++) {
    points.push([i * 20, 500 + i * 20 * 0.05, 48.0 + i * 0.00018, 16.0]);
  }
  for (let i = 1; i <= 100; i++) {
    points.push([3000 + i * 20, 650, 48.027 + i * 0.00018, 16.0]);
  }
  for (let i = 1; i <= 150; i++) {
    points.push([5000 + i * 20, 650 + i * 20 * 0.05, 48.045 + i * 0.00018, 16.0]);
  }
  return points;
}

/**
 * Fixture 6 — a 5 % ramp sampled every 30 m with a ±15 m alternating spike.
 * 30 m segments are longer than the default SPIKE_MAX_SEGMENT_M of 24, so the
 * spike filter skips them; at 60 it would not. That gap is what makes the
 * "is SPIKE_MAX_SEGMENT_M re-derived from RESAMPLE_MIN_INTERVAL_M?" question
 * observable from outside.
 */
function makeSpikyRampRoute() {
  const points = [];
  for (let i = 0; i <= 200; i++) {
    const d = i * 30;
    points.push([d, 300 + d * 0.05 + (i % 2 === 1 ? 15 : 0), 48.0 + i * 0.0002, 16.0]);
  }
  return points;
}

describe('configurable thresholds', () => {
  it('omitting config is identical to passing an empty one', () => {
    // The whole change is meant to be additive (#76): a caller that passes
    // nothing must get byte-identical output, or the extension and the CLI
    // both moved without anyone asking them to.
    const route = makeMultiClimbRoute();
    expect(detectClimbs(route, { config: {} })).toEqual(detectClimbs(route));
    expect(detectClimbs(route, {})).toEqual(detectClimbs(route));
  });

  it('CLIMB_START_GRADE_PCT decides whether a 4 % ramp opens a candidate', () => {
    const route = makeGentleRampRoute();
    expect(detectClimbs(route).climbs).toHaveLength(1);
    expect(detectClimbs(route, { config: { CLIMB_START_GRADE_PCT: 6 } }).climbs).toHaveLength(0);
  });

  it('MERGE_MAX_GAP_M collapses two candidates into one', () => {
    // A second, independent key on a different branch of the pipeline: threading
    // that is accidentally correct for identification only would pass the test
    // above and fail this one.
    const route = makeTwoRampRoute();
    expect(detectClimbs(route).climbs).toHaveLength(2);
    expect(detectClimbs(route, { config: { MERGE_MAX_GAP_M: 6000 } }).climbs).toHaveLength(1);
  });

  it('does not mutate DEFAULT_CLIMB_CONFIG', () => {
    // An in-place merge would leak one caller's tuning into every later call in
    // the same process — invisible in every other test here, and the nastiest
    // bug this change can introduce.
    const before = DEFAULT_CLIMB_CONFIG.CLIMB_START_GRADE_PCT;
    detectClimbs(makeGentleRampRoute(), { config: { CLIMB_START_GRADE_PCT: 6 } });
    expect(DEFAULT_CLIMB_CONFIG.CLIMB_START_GRADE_PCT).toBe(before);
    expect(detectClimbs(makeGentleRampRoute()).climbs).toHaveLength(1);
  });

  it('does not re-derive SPIKE_MAX_SEGMENT_M from RESAMPLE_MIN_INTERVAL_M', () => {
    // The merged config is flat: the × 2 derivation produced the default and
    // stops there. Re-deriving it would make one key's value depend on which
    // *other* keys the caller happened to pass.
    expect(DEFAULT_CLIMB_CONFIG.SPIKE_MAX_SEGMENT_M).toBe(24);

    const route = makeSpikyRampRoute();
    const widened = detectClimbs(route, { config: { RESAMPLE_MIN_INTERVAL_M: 30 } });
    const pinnedAt24 = detectClimbs(route, {
      config: { RESAMPLE_MIN_INTERVAL_M: 30, SPIKE_MAX_SEGMENT_M: 24 },
    });
    const reDerived = detectClimbs(route, {
      config: { RESAMPLE_MIN_INTERVAL_M: 30, SPIKE_MAX_SEGMENT_M: 60 },
    });

    expect(widened).toEqual(pinnedAt24);
    expect(widened).not.toEqual(reDerived);
  });
});
