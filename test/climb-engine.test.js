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
  resamplePoints,
  smoothElevationProfile,
  mergeNearbyClimbs,
  categorizeClimb,
} from '../src/climb-engine.ts';

// ─── Shared helpers ──────────────────────────────────────────────────────────

/** Create a structured profile point (the shape resamplePoints / smoothElevation expect). */
function pt(distance, elevation, lat = 48.0, lon = 16.0) {
  return { distance, elevation, lat, lon };
}

/**
 * Create a minimal segment object (the shape mergeNearbyClimbs / categorizeClimb expect).
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
    // 50 flat points at 100 m, one spike at index 25 (250 m on each side), then flat again.
    // Approach to the spike: 100→300 in 1 step (200 % grade) — spike.
    // Departure from the spike: 300→103 (flat) — one-sided.
    const profile = [
      ...Array.from({ length: 25 }, (_, i) => pt(i * 50, 100)),
      pt(25 * 50, 300),  // spike ← steep in, flat out
      ...Array.from({ length: 25 }, (_, i) => pt((26 + i) * 50, 103)),
    ];

    const result = smoothElevationProfile(profile);
    // Spike must be substantially reduced (rolling average + filterNoiseSpikes)
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

// ─── categorizeClimb ─────────────────────────────────────────────────────────

describe('categorizeClimb', () => {
  /**
   * Helper: build a minimal but valid climb object that categorizeClimb accepts.
   * The single segment gives the function start/end coords + gradient.
   */
  function makeClimb(totalDistanceM, totalElevationM) {
    const segment = seg(0, totalDistanceM, 100, 100 + totalElevationM);
    return { segments: [segment], totalDistance: totalDistanceM, totalElevation: totalElevationM };
  }

  it('returns null for a climb with zero distance', () => {
    expect(categorizeClimb(makeClimb(0, 100))).toBeNull();
  });

  it('returns null for a climb with zero elevation', () => {
    expect(categorizeClimb(makeClimb(5000, 0))).toBeNull();
  });

  it('returns null for a null climb', () => {
    expect(categorizeClimb(null)).toBeNull();
  });

  it('assigns category 4 when score < 75', () => {
    // 5 km × 2 %² = 5 × 4 = 20  →  Cat 4
    const climb = makeClimb(5000, 100);
    const result = categorizeClimb(climb);
    expect(result.category).toBe('4');
    expect(result.difficulty).toBeCloseTo(20, 0);
  });

  it('assigns category 3 at the lower boundary (score = 75)', () => {
    // 3 km × 5 %² = 3 × 25 = 75  →  Cat 3
    const climb = makeClimb(3000, 150);
    const result = categorizeClimb(climb);
    expect(result.category).toBe('3');
    expect(result.difficulty).toBeCloseTo(75, 0);
  });

  it('assigns category 2 at the lower boundary (score = 150)', () => {
    // 6 km × 5 %² = 6 × 25 = 150  →  Cat 2
    const climb = makeClimb(6000, 300);
    const result = categorizeClimb(climb);
    expect(result.category).toBe('2');
    expect(result.difficulty).toBeCloseTo(150, 0);
  });

  it('assigns category 1 at the lower boundary (score = 300)', () => {
    // 12 km × 5 %² = 12 × 25 = 300  →  Cat 1
    const climb = makeClimb(12000, 600);
    const result = categorizeClimb(climb);
    expect(result.category).toBe('1');
    expect(result.difficulty).toBeCloseTo(300, 0);
  });

  it('assigns HC at the lower boundary (score = 600)', () => {
    // 24 km × 5 %² = 24 × 25 = 600  →  HC
    const climb = makeClimb(24000, 1200);
    const result = categorizeClimb(climb);
    expect(result.category).toBe('HC');
    expect(result.difficulty).toBeCloseTo(600, 0);
  });

  it('returns a complete climb object with all required fields', () => {
    const climb = makeClimb(8000, 480);   // 8 km × 6 %² = 8 × 36 = 288 → Cat 2
    const result = categorizeClimb(climb);

    expect(result).toMatchObject({
      distance:   expect.any(Number),
      elevation:  expect.any(Number),
      avgGrade:   expect.any(Number),
      difficulty: expect.any(Number),
      category:   expect.any(String),
      segments:   expect.any(Array),
    });
    expect(result.markerCoords).not.toBeNull(); // seg() supplies lat/lon
    expect(result.endCoords).not.toBeNull();
  });

  it('computes avgGrade correctly', () => {
    // 6 000 m gain 300 m → avgGrade = 5 %
    const result = categorizeClimb(makeClimb(6000, 300));
    expect(result.avgGrade).toBeCloseTo(5, 5);
  });

  // ── Garmin model ──────────────────────────────────────────────────────────

  it('[garmin] assigns category 4 when score ≥ 8 000', () => {
    // 1 000 m × 10 % = 10 000 → Cat 4
    const result = categorizeClimb(makeClimb(1000, 100), 'garmin');
    expect(result.category).toBe('4');
    expect(result.difficulty).toBeCloseTo(10000, 0);
  });

  it('[garmin] assigns category 3 at the lower boundary (score = 16 000)', () => {
    // 2 000 m × 8 % = 16 000 → Cat 3
    const result = categorizeClimb(makeClimb(2000, 160), 'garmin');
    expect(result.category).toBe('3');
    expect(result.difficulty).toBeCloseTo(16000, 0);
  });

  it('[garmin] assigns HC at the lower boundary (score = 64 000)', () => {
    // 8 000 m × 8 % = 64 000 → HC
    const result = categorizeClimb(makeClimb(8000, 640), 'garmin');
    expect(result.category).toBe('HC');
    expect(result.difficulty).toBeCloseTo(64000, 0);
  });

  it('[garmin] returns null when score < 1 500', () => {
    // 200 m × 5 % = 1 000 < 1 500 → discard
    expect(categorizeClimb(makeClimb(200, 10), 'garmin')).toBeNull();
  });
});

// ─── detectClimbs (full pipeline) ─────────────────────────────────────────────

describe('detectClimbs', () => {
  it('returns [] for null input', () => {
    expect(detectClimbs(null)).toEqual([]);
  });

  it('returns [] for undefined input', () => {
    expect(detectClimbs(undefined)).toEqual([]);
  });

  it('returns [] for a single-point array', () => {
    expect(detectClimbs([[0, 100, 48, 16]])).toEqual([]);
  });

  it('returns [] for a flat route with no elevation gain', () => {
    const result = detectClimbs(FLAT_ROUTE);
    expect(result).toEqual([]);
  });

  it('detects exactly one climb on a clean single-climb route', () => {
    const result = detectClimbs(makeSingleClimbRoute());
    expect(result).toHaveLength(1);
  });

  it('single climb has correct structure', () => {
    const [climb] = detectClimbs(makeSingleClimbRoute());
    expect(climb).toMatchObject({
      distance:   expect.any(Number),
      elevation:  expect.any(Number),
      avgGrade:   expect.any(Number),
      difficulty: expect.any(Number),
      category:   expect.any(String),
      segments:   expect.any(Array),
    });
    expect(['4', '3', '2', '1', 'HC']).toContain(climb.category);
  });

  it('single climb elevation gain is within ±15 % of the design value (600 m)', () => {
    const [climb] = detectClimbs(makeSingleClimbRoute());
    // After trimming and smoothing the 8 km × 7.5 % ramp, gain should be near 600 m
    expect(climb.elevation).toBeGreaterThan(600 * 0.85);
    expect(climb.elevation).toBeLessThan(600 * 1.15);
  });

  it('detects exactly two climbs on a multi-climb route', () => {
    const result = detectClimbs(makeMultiClimbRoute());
    expect(result).toHaveLength(2);
  });

  it('two climbs are ordered by start distance', () => {
    const [a, b] = detectClimbs(makeMultiClimbRoute());
    const aStart = a.segments[0].startDistance;
    const bStart = b.segments[0].startDistance;
    expect(aStart).toBeLessThan(bStart);
  });

  it('second climb has greater elevation gain than first (640 m vs 300 m design)', () => {
    const [climbA, climbB] = detectClimbs(makeMultiClimbRoute());
    expect(climbB.elevation).toBeGreaterThan(climbA.elevation);
  });

  it('markerCoords and endCoords are populated when lat/lon data is present', () => {
    const [climb] = detectClimbs(makeSingleClimbRoute());
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
    expect(result).toHaveLength(2);
  });

  it('discards a climb whose steep section is shorter than 100 m after trimming', () => {
    // 75 m at 40 % grade (+30 m elevation) satisfies identifyClimbs minimums when
    // followed by a 330 m flat tail (total 405 m, +30 m, 7.4 % avg).
    // With raw-elevation validation the 30 m gain meets CLIMB_MIN_ELEVATION_M,
    // so the smoothed candidate (285 m after smoothing extends the climbing zone)
    // survives as a valid category-4 climb.
    const points = [];
    // Steep section: 5 intervals × 15 m, each +6 m (40 % grade)
    for (let i = 0; i <= 5; i++) points.push([i * 15, i * 6, 48.0, 16.0]);
    // Flat tail: 22 intervals × 15 m at elevation 30 m
    for (let i = 1; i <= 22; i++) points.push([75 + i * 15, 30, 48.0 + i * 0.00013, 16.0]);

    const result = detectClimbs(points);
    expect(result).toHaveLength(1);
  });
});
