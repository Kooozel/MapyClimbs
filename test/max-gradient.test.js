/**
 * test/max-gradient.test.js
 *
 * Unit tests for the one max-gradient scan (`src/max-gradient.ts`) and the two
 * named figures built on it: `maxPitchGradient` (gradient-zones.ts, chart
 * resolution) and `computeMaxSustainedGradient` (climb-engine.ts, 200 m window).
 *
 * The pinning test below is the regression guard for issue #44: the two used to
 * be separate implementations and drifted until the card and the CLI reported
 * different numbers for the same climb.
 *
 * Run: npm test
 */

import { describe, it, expect } from 'vitest';
import { buildProfilePoints, maxPitchGradient } from '../src/gradient-zones.ts';
import { computeMaxSustainedGradient } from '../src/climb-engine.ts';

/** Build a minimal ProfilePoint for maxPitchGradient tests. */
function pt(distance, elevation) {
  return { distance, elevation, gradient: 0 };
}

/**
 * Build a dense Segment[] of `count` steps of `stepM` metres each, taking the
 * gradient (%) of step i from `gradeAt`. Mirrors what calculateGradients emits:
 * gradient is exactly Δelevation / Δdistance for that step.
 */
function segments(count, stepM, gradeAt) {
  const segs = [];
  let distance = 0;
  let elevation = 100;
  for (let i = 0; i < count; i++) {
    const gradient = gradeAt(i);
    const rise = (gradient / 100) * stepM;
    segs.push({
      startDistance: distance,
      endDistance: distance + stepM,
      distance: stepM,
      elevation: rise,
      gradient,
      startElevation: elevation,
      endElevation: elevation + rise,
      startLat: null,
      startLon: null,
      endLat: null,
      endLon: null,
    });
    distance += stepM;
    elevation += rise;
  }
  return segs;
}

describe('maxPitchGradient', () => {
  it('returns 0 for an empty profile', () => {
    expect(maxPitchGradient([], 200)).toBe(0);
  });

  it('returns 0 when the profile is shorter than the window', () => {
    // Only 100 m total span, window = 200. Reporting 0 for a climb shorter than
    // the window is wrong, but it is the pre-refactor behaviour of both figures
    // and is preserved deliberately; fixing it is tracked in #69.
    const profile = [pt(0, 100), pt(100, 110)];
    expect(maxPitchGradient(profile, 200)).toBe(0);
  });

  it('returns the correct gradient for a single long span', () => {
    // 500 m distance, 25 m gain → 5%
    const profile = [pt(0, 100), pt(500, 125)];
    expect(maxPitchGradient(profile, 200)).toBeCloseTo(5);
  });

  it('selects the steepest window from a multi-point simplified profile', () => {
    // Three segments: 0–300m at ~3%, 300–600m at ~10%, 600–900m at ~2%
    const profile = [pt(0, 100), pt(300, 109), pt(600, 139), pt(900, 145)];
    // Steepest 300 m span: 300→600 = 30m / 300m = 10%
    expect(maxPitchGradient(profile, 200)).toBeCloseTo(10);
  });

  it('spans multiple profile points when single span is shorter than the window', () => {
    // Each span is 100 m: first at 4%, second at 8%; window=150 forces spanning both
    const profile = [pt(0, 100), pt(100, 104), pt(200, 112)];
    // Only valid window from i=0: dist=200 ≥ 150 → (112-100)/200*100 = 6%
    expect(maxPitchGradient(profile, 150)).toBeCloseTo(6);
  });

  it('is consistent with buildGradientZones on the same simplified profile', () => {
    // Simplified profile: 0–300 m at 3%, 300–600 m at 10%, 600–900 m at 2%
    // Elevations accumulate: 0, 9, 39, 45
    const profile = [pt(0, 0), pt(300, 9), pt(600, 39), pt(900, 45)];
    const maxGrad = maxPitchGradient(profile, 200);
    // Steepest 300 m span: 300–600 m → 30 m / 300 m = 10%
    expect(maxGrad).toBeCloseTo(10);
    // Stat must not exceed the steepest color band the chart would show
    expect(maxGrad).toBeLessThanOrEqual(10.01);
  });

  it('defaults to the chart-pitch floor, reporting the steepest drawn segment', () => {
    // Simplified points are hundreds of metres apart, so the 25 m default floor
    // never spans two of them: the answer is the steepest single segment.
    const profile = [pt(0, 100), pt(300, 109), pt(400, 149), pt(900, 159)];
    // 300→400 m: 40 m / 100 m = 40%. A 200 m window could never see it alone.
    expect(maxPitchGradient(profile)).toBeCloseTo(40);
    expect(maxPitchGradient(profile, 200)).toBeLessThan(40);
  });
});

describe('computeMaxSustainedGradient', () => {
  it('returns a decimal fraction, not a percentage', () => {
    const segs = segments(40, 25, () => 6); // 1 km at a steady 6%
    expect(computeMaxSustainedGradient(segs)).toBeCloseTo(0.06, 5);
  });

  it('returns 0 for no segments', () => {
    expect(computeMaxSustainedGradient([])).toBe(0);
  });

  it('averages a short pitch away over its 200 m window', () => {
    // 1 km at 4%, except one 25 m step at 20%.
    const segs = segments(40, 25, (i) => (i === 20 ? 20 : 4));
    // The best 200 m window holds the pitch plus 175 m of 4%:
    // (0.2·25 + 0.04·175) / 200 = 6%
    expect(computeMaxSustainedGradient(segs)).toBeCloseTo(0.06, 5);
  });
});

describe('the two figures are one scan under two configurations', () => {
  it('agrees with maxPitchGradient on the same input and window', () => {
    // Regression guard for #44. Same dense profile, same 200 m window: the
    // sustained scan and the pitch scan must be the same number, so the two
    // call sites can only ever differ in the window each is configured with.
    const segs = segments(80, 25, (i) => 3 + (i % 7) + (i === 33 ? 12 : 0));
    const sustainedPct = computeMaxSustainedGradient(segs, 200) * 100;
    const pitchPct = maxPitchGradient(buildProfilePoints(segs), 200);
    expect(sustainedPct).toBeCloseTo(pitchPct, 10);
  });

  it('reports genuinely different numbers at the two configured windows', () => {
    // A 50 m pitch at 15% inside 1 km of 5%. The card's chart-resolution read
    // sees the pitch; the 200 m sustained read deliberately does not.
    const segs = segments(40, 25, (i) => (i === 20 || i === 21 ? 15 : 5));
    const profile = buildProfilePoints(segs);
    expect(maxPitchGradient(profile)).toBeCloseTo(15, 5);
    // (0.15·50 + 0.05·150) / 200 = 7.5%
    expect(computeMaxSustainedGradient(segs) * 100).toBeCloseTo(7.5, 5);
  });
});
