/**
 * test/chart-selection.test.js
 *
 * Unit tests for the pure half of `src/content/chart-selection.ts` — the range
 * maths behind drag-to-select — plus the chart's pointer ↔ distance conversion
 * pair in `src/content/chart.ts`.
 *
 * Run: npm test
 */

import { describe, it, expect } from 'vitest';
import { elevationAtDistance, summarizeRange } from '../src/content/chart-selection.ts';
import { CHART_PLOT, chartXToDistance, distanceToChartX } from '../src/content/chart.ts';

/** Build a minimal ProfilePoint. */
function pt(distance, elevation) {
  return { distance, elevation, gradient: 0 };
}

// A 1000 m climb rising 100 m: flat-ish first half, steep second half.
const PROFILE = [pt(0, 200), pt(500, 220), pt(1000, 300)];

// ── chart geometry ───────────────────────────────────────────────────────────

describe('distanceToChartX / chartXToDistance', () => {
  it('maps the climb start and end onto the plot edges', () => {
    expect(distanceToChartX(0, 1000)).toBeCloseTo(CHART_PLOT.left);
    expect(distanceToChartX(1000, 1000)).toBeCloseTo(CHART_PLOT.right);
  });

  it('round-trips a distance through x and back', () => {
    for (const d of [0, 137, 500, 999.5, 1000]) {
      expect(chartXToDistance(distanceToChartX(d, 1000), 1000)).toBeCloseTo(d);
    }
  });

  it('clamps positions outside the plot area to the climb', () => {
    expect(chartXToDistance(CHART_PLOT.left - 50, 1000)).toBe(0);
    expect(chartXToDistance(CHART_PLOT.right + 50, 1000)).toBe(1000);
  });

  it('does not divide by zero for a zero-length climb', () => {
    expect(Number.isFinite(distanceToChartX(0, 0))).toBe(true);
    expect(chartXToDistance(CHART_PLOT.left + 10, 0)).toBe(0);
  });
});

// ── elevationAtDistance ──────────────────────────────────────────────────────

describe('elevationAtDistance', () => {
  it('returns 0 for an empty profile', () => {
    expect(elevationAtDistance([], 100)).toBe(0);
  });

  it('returns the exact elevation at a profile point', () => {
    expect(elevationAtDistance(PROFILE, 500)).toBeCloseTo(220);
  });

  it('interpolates linearly between two points', () => {
    // Halfway through the 500–1000 m span: 220 + (80 / 2) = 260
    expect(elevationAtDistance(PROFILE, 750)).toBeCloseTo(260);
  });

  it('clamps to the profile ends', () => {
    expect(elevationAtDistance(PROFILE, -100)).toBeCloseTo(200);
    expect(elevationAtDistance(PROFILE, 5000)).toBeCloseTo(300);
  });

  it('does not divide by zero on duplicate distances', () => {
    const dup = [pt(0, 100), pt(200, 110), pt(200, 130), pt(400, 150)];
    expect(Number.isFinite(elevationAtDistance(dup, 200))).toBe(true);
  });
});

// ── summarizeRange ───────────────────────────────────────────────────────────

describe('summarizeRange', () => {
  it('reports distance, elevation delta and average gradient', () => {
    const s = summarizeRange(PROFILE, 500, 1000);
    expect(s.distance).toBeCloseTo(500);
    expect(s.elevationDelta).toBeCloseTo(80);
    expect(s.avgGrade).toBeCloseTo(16);
  });

  it('is order-independent — dragging right to left is the same range', () => {
    expect(summarizeRange(PROFILE, 1000, 500)).toEqual(summarizeRange(PROFILE, 500, 1000));
  });

  it('normalises the bounds so start is always the lower one', () => {
    const s = summarizeRange(PROFILE, 900, 300);
    expect(s.start).toBe(300);
    expect(s.end).toBe(900);
  });

  it('averages across a whole climb', () => {
    const s = summarizeRange(PROFILE, 0, 1000);
    expect(s.elevationDelta).toBeCloseTo(100);
    expect(s.avgGrade).toBeCloseTo(10);
  });

  it('returns a signed gradient for a descending selection', () => {
    const down = [pt(0, 300), pt(400, 260)];
    const s = summarizeRange(down, 0, 400);
    expect(s.elevationDelta).toBeCloseTo(-40);
    expect(s.avgGrade).toBeCloseTo(-10);
  });

  it('returns 0% for a zero-length selection rather than Infinity', () => {
    const s = summarizeRange(PROFILE, 400, 400);
    expect(s.distance).toBe(0);
    expect(s.avgGrade).toBe(0);
  });
});
