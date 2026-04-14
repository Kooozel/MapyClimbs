/**
 * test/climb-card.test.js
 *
 * Unit tests for pure metric helpers exported from `src/content/climb-card.ts`.
 *
 * Run: npm test
 */

import { describe, it, expect } from 'vitest';
import { calcMaxGradientOver } from '../src/content/climb-card.ts';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a minimal Segment object for calcMaxGradientOver.
 * Only `distance` and `gradient` are used by the function.
 */
function seg(distance, gradient) {
  return {
    distance,
    gradient,
    startDistance: 0,
    endDistance: distance,
    elevation: 0,
    startElevation: 0,
    endElevation: 0,
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
  };
}

// ── calcMaxGradientOver ──────────────────────────────────────────────────────

describe('calcMaxGradientOver', () => {
  it('returns 0 for an empty segment array', () => {
    expect(calcMaxGradientOver([], 200)).toBe(0);
  });

  it('returns the gradient of a single segment that meets the minDistance', () => {
    const segments = [seg(500, 0.08)]; // 500 m at 8%
    expect(calcMaxGradientOver(segments, 200)).toBeCloseTo(0.08);
  });

  it('returns 0 when no window of minDistance can be formed', () => {
    // Only 50 m available, minDistance = 200 m
    const segments = [seg(50, 0.12)];
    expect(calcMaxGradientOver(segments, 200)).toBe(0);
  });

  it('picks the steepest window across a multi-segment climb', () => {
    // 200 m at 3%, then 200 m at 10%, then 200 m at 2%
    const segments = [seg(200, 0.03), seg(200, 0.10), seg(200, 0.02)];
    // The steepest 200 m window is the second segment alone (10%)
    const result = calcMaxGradientOver(segments, 200);
    expect(result).toBeCloseTo(0.10);
  });

  it('computes a distance-weighted average across multiple segments to reach minDistance', () => {
    // The algorithm accumulates whole segments until their combined distance
    // reaches minDistance — it does NOT stop mid-segment.
    // [100 m @ 4%, 100 m @ 8%] with minDistance=150:
    //   window i=0: consumes both segments (200 m total, 12 weighted units)
    //   weighted average = (0.04*100 + 0.08*100) / 200 = 0.06
    const segments = [seg(100, 0.04), seg(100, 0.08)];
    expect(calcMaxGradientOver(segments, 150)).toBeCloseTo(0.06, 5);
  });

  it('handles a uniform gradient across many small segments', () => {
    // 10 × 100 m all at 6% — any 200 m window should give 6%
    const segments = Array.from({ length: 10 }, () => seg(100, 0.06));
    expect(calcMaxGradientOver(segments, 200)).toBeCloseTo(0.06);
  });

  it('returns the best of overlapping windows', () => {
    // Gradually increasing steepness: should find the steepest tail
    const segments = [seg(200, 0.02), seg(200, 0.05), seg(200, 0.09)];
    const result = calcMaxGradientOver(segments, 200);
    expect(result).toBeCloseTo(0.09);
  });
});
