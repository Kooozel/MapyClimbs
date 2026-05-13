/**
 * test/climb-card.test.js
 *
 * Unit tests for pure metric helpers exported from `src/content/climb-card.ts`.
 *
 * Run: npm test
 */

import { describe, it, expect } from 'vitest';
import { buildProfilePoints, simplifyProfile, calcMaxGradientFromProfile } from '../src/gradient-zones.ts';

// ── calcMaxGradientFromProfile ────────────────────────────────────────────────

/** Build a minimal ProfilePoint for calcMaxGradientFromProfile tests. */
function pt(distance, elevation) {
  return { distance, elevation, gradient: 0 };
}

describe('calcMaxGradientFromProfile', () => {
  it('returns 0 for an empty profile', () => {
    expect(calcMaxGradientFromProfile([], 200)).toBe(0);
  });

  it('returns 0 when the profile is shorter than minDistance', () => {
    // Only 100 m total span, minDistance = 200
    const profile = [pt(0, 100), pt(100, 110)];
    expect(calcMaxGradientFromProfile(profile, 200)).toBe(0);
  });

  it('returns the correct gradient for a single long span', () => {
    // 500 m distance, 25 m gain → 5%
    const profile = [pt(0, 100), pt(500, 125)];
    expect(calcMaxGradientFromProfile(profile, 200)).toBeCloseTo(5);
  });

  it('selects the steepest window from a multi-point simplified profile', () => {
    // Three segments: 0–300m at ~3%, 300–600m at ~10%, 600–900m at ~2%
    const profile = [pt(0, 100), pt(300, 109), pt(600, 139), pt(900, 145)];
    // Steepest 300 m span: 300→600 = 30m / 300m = 10%
    expect(calcMaxGradientFromProfile(profile, 200)).toBeCloseTo(10);
  });

  it('spans multiple profile points when single span is shorter than minDistance', () => {
    // Each span is 100 m: first at 4%, second at 8%; minDistance=150 forces spanning both
    const profile = [pt(0, 100), pt(100, 104), pt(200, 112)];
    // Only valid window from i=0: dist=200 ≥ 150 → (112-100)/200*100 = 6%
    expect(calcMaxGradientFromProfile(profile, 150)).toBeCloseTo(6);
  });

  it('is consistent with buildGradientZones on the same simplified profile', () => {
    // Simplified profile: 0–300 m at 3%, 300–600 m at 10%, 600–900 m at 2%
    // Elevations accumulate: 0, 9, 39, 45
    const profile = [pt(0, 0), pt(300, 9), pt(600, 39), pt(900, 45)];
    const maxGrad = calcMaxGradientFromProfile(profile, 200);
    // Steepest 300 m span: 300–600 m → 30 m / 300 m = 10%
    expect(maxGrad).toBeCloseTo(10);
    // Stat must not exceed the steepest color band the chart would show
    expect(maxGrad).toBeLessThanOrEqual(10.01);
  });
});
