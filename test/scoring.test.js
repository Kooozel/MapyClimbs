/**
 * test/scoring.test.js
 *
 * Unit tests for `src/scoring.ts` — the view that turns a measured climb into a
 * difficulty and a category.
 *
 * Scoring used to live inside the detection pipeline, where a climb that
 * cleared no threshold was *dropped*; recovering it on a model switch needed a
 * second entry point (`recategorizeResult`) replaying a stored partition. This
 * file inherits that suite's invariants — reversibility, and a conserved
 * candidate set — and they are now properties of a pure function over an array
 * rather than of a storage encoding (#77).
 *
 * Run: npm test
 */

import { describe, it, expect } from 'vitest';
import { score, ASO, GARMIN, HIKING, SCORING_CONFIGS } from '../src/scoring.ts';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * A measured climb, with only the fields any scorer reads. `startDistance` on
 * the single segment is what route order is checked against.
 */
function measured(startDistanceM, distanceM, elevationM, maxSustainedGradient = 0) {
  return {
    distance: distanceM,
    elevation: elevationM,
    avgGrade: (elevationM / distanceM) * 100,
    maxSustainedGradient,
    segments: [{ startDistance: startDistanceM, endDistance: startDistanceM + distanceM }],
    markerCoords: null,
    endCoords: null,
  };
}

function result(...climbs) {
  return { climbs, totalDistance: 100000, totalElevationGain: 0, totalElevationLoss: 0 };
}

/** Score one climb and return just its category. */
const categoryOf = (climb, model) => score(result(climb), model)[0].category;

// ─── ASO ─────────────────────────────────────────────────────────────────────

describe('ASO', () => {
  // score = distance (km) × avgGrade²
  it.each([
    ['HC at the lower boundary (600)', 6000, 600, 'HC'],
    ['category 1 at the lower boundary (300)', 12000, 600, '1'],
    ['category 2 at the lower boundary (150)', 6000, 300, '2'],
    ['category 3 at the lower boundary (75)', 3000, 150, '3'],
    ['category 4 at the lower boundary (25)', 1000, 50, '4'],
    ['category 4 when score ≥ 25 and < 75', 5000, 150, '4'],
    ['Uncategorized when score ≥ 8 and < 25', 600, 24, 'uncategorized'],
  ])('assigns %s', (_label, distanceM, elevationM, category) => {
    expect(categoryOf(measured(0, distanceM, elevationM), 'aso')).toBe(category);
  });

  it('gives no category below the Uncategorized threshold — as data, not a drop', () => {
    // 500 m, 9 m gain → avgGrade 1.8 % → score 1.62, under the floor of 8.
    const [climb] = score(result(measured(0, 500, 9)), 'aso');

    // Both go null together: "this model has no verdict here", rather than a
    // score the caller would have to compare against a threshold itself.
    expect(climb.category).toBeNull();
    expect(climb.difficulty).toBeNull();
    // The measurement survives intact; only the verdict is absent — which is
    // the whole difference from the drop this used to be.
    expect(climb.distance).toBe(500);
    expect(climb.avgGrade).toBeCloseTo(1.8, 5);
  });
});

// ─── Garmin ──────────────────────────────────────────────────────────────────

describe('GARMIN', () => {
  // score = distance (m) × avgGrade (%)
  it.each([
    ['HC at the lower boundary (64 000)', 8000, 640, 'HC'],
    ['category 3 at the lower boundary (16 000)', 2000, 160, '3'],
    ['category 4 at the lower boundary (8 000)', 1000, 80, '4'],
    ['category 4 when score ≥ 8 000', 1000, 100, '4'],
    ['Uncategorized at exactly the min score (1 500)', 500, 15, 'uncategorized'],
    ['Uncategorized when score < 8 000', 500, 30, 'uncategorized'],
  ])('assigns %s', (_label, distanceM, elevationM, category) => {
    expect(categoryOf(measured(0, distanceM, elevationM), 'garmin')).toBe(category);
  });

  it('gives no category below the Uncategorized threshold', () => {
    // 500 m, 9 m gain → 500 × 1.8 = 900, under the floor of 1 500.
    expect(categoryOf(measured(0, 500, 9), 'garmin')).toBeNull();
  });
});

// ─── Hiking ──────────────────────────────────────────────────────────────────

describe('HIKING', () => {
  // score = H²/(8L) + H×0.002 + G_max×0.5
  it('reads maxSustainedGradient off the climb rather than scanning segments', () => {
    const flat = score(result(measured(0, 2000, 200, 0)), 'hiking')[0].difficulty;
    const steep = score(result(measured(0, 2000, 200, 0.3)), 'hiking')[0].difficulty;

    // The G_max term is worth exactly gMax × 0.5 and nothing else changed.
    expect(steep - flat).toBeCloseTo(0.15, 10);
  });

  it('scores a long steep climb into the top bands', () => {
    // 1 200 m gain over 6 km → 1 200²/(8 × 6 000) = 30, + 2.4 + 0.05 = 32.45,
    // which is over Cat 1's 25 and under HC's 40.
    expect(categoryOf(measured(0, 6000, 1200, 0.1), 'hiking')).toBe('1');
  });

  it('gives no category below the 0.5 floor', () => {
    // 100 m gain over 5 km → 100²/(8 × 5 000) = 0.25, + 0.2 → 0.45.
    expect(categoryOf(measured(0, 5000, 100, 0), 'hiking')).toBeNull();
  });
});

// ─── score() ─────────────────────────────────────────────────────────────────

describe('score', () => {
  /**
   * Four climbs along one route, chosen so the models partition them
   * differently: A and B clear ASO, S and T do not.
   */
  const A = measured(0, 5000, 150); //  ASO 45   → Cat 4
  const S = measured(4000, 400, 16); //  ASO 6.4  → null
  const B = measured(8000, 3000, 150); // ASO 75   → Cat 3
  const T = measured(11000, 300, 12); //  ASO 4.8  → null
  const ROUTE = result(A, S, B, T);

  it('returns every climb, in route order, whatever the model rejects', () => {
    for (const model of ['aso', 'garmin', 'hiking']) {
      const scored = score(ROUTE, model);

      expect(scored).toHaveLength(4);
      expect(scored.map((c) => c.segments[0].startDistance)).toEqual([0, 4000, 8000, 11000]);
    }
  });

  it('is where a climb stops being kept or dropped and starts being labelled', () => {
    const scored = score(ROUTE, 'aso');

    expect(scored.map((c) => c.category)).toEqual(['4', null, '3', null]);
    expect(scored.filter((c) => c.category !== null)).toHaveLength(2);
  });

  it('preserves the measurement it scored', () => {
    for (const [i, climb] of score(ROUTE, 'aso').entries()) {
      expect(climb).toMatchObject(ROUTE.climbs[i]);
    }
  });

  it('is the identity when called twice with the same model', () => {
    expect(score(ROUTE, 'garmin')).toEqual(score(ROUTE, 'garmin'));
  });

  it('switching model and back returns the original scoring', () => {
    // The reversibility recategorizeResult had to work for by re-partitioning a
    // stored set. Re-scoring a measurement makes it free: nothing is consumed.
    const aso = score(ROUTE, 'aso');
    score(ROUTE, 'garmin');

    expect(score(ROUTE, 'aso')).toEqual(aso);
  });

  it('takes a caller’s own ScoringConfig, not just a built-in name', () => {
    // The point of making the config the parameter: different bands without a
    // fork. This one calls everything over 100 m an HC climb.
    const everythingIsHC = {
      score: (climb) => climb.distance,
      thresholds: [{ category: 'HC', min: 100 }],
    };

    expect(score(ROUTE, everythingIsHC).map((c) => c.category)).toEqual(['HC', 'HC', 'HC', 'HC']);
    // ...which no built-in agrees with, so the config really did drive it.
    expect(score(ROUTE, 'aso').map((c) => c.category)).not.toEqual(['HC', 'HC', 'HC', 'HC']);
  });

  it('resolves a model name to the same config the caller could pass', () => {
    expect(SCORING_CONFIGS).toEqual({ aso: ASO, garmin: GARMIN, hiking: HIKING });
    expect(score(ROUTE, 'aso')).toEqual(score(ROUTE, ASO));
  });
});
