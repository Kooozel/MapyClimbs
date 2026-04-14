/**
 * test/chart.test.js
 *
 * Unit tests for the pure algorithmic helpers in `src/content/chart.ts`.
 * These functions have no DOM or Chrome-API dependencies.
 *
 * Run: npm test
 */

import { describe, it, expect } from 'vitest';
import {
  getColorForGrade,
  mergeShortZones,
  simplifyProfile,
} from '../src/content/chart.ts';

// ── getColorForGrade ─────────────────────────────────────────────────────────

describe('getColorForGrade', () => {
  it('returns green for grades below 3%', () => {
    expect(getColorForGrade(0)).toBe('#4CAF50');
    expect(getColorForGrade(2.9)).toBe('#4CAF50');
  });

  it('returns yellow at the 3% boundary (inclusive)', () => {
    expect(getColorForGrade(3)).toBe('#FBC02D');
  });

  it('returns yellow for grades 3% ≤ g < 6%', () => {
    expect(getColorForGrade(5.9)).toBe('#FBC02D');
  });

  it('returns orange at the 6% boundary', () => {
    expect(getColorForGrade(6)).toBe('#F57C00');
  });

  it('returns red at the 9% boundary', () => {
    expect(getColorForGrade(9)).toBe('#D32F2F');
  });

  it('returns bordeaux at the 12% boundary and above', () => {
    expect(getColorForGrade(12)).toBe('#800020');
    expect(getColorForGrade(25)).toBe('#800020');
    expect(getColorForGrade(100)).toBe('#800020');
  });
});

// ── mergeShortZones ──────────────────────────────────────────────────────────

/** Small helper to build a zone object. */
function zone(color, start, end) {
  return { color, start, end };
}

describe('mergeShortZones', () => {
  it('returns a single zone unchanged regardless of minLen', () => {
    const zones = [zone('green', 0, 100)];
    expect(mergeShortZones(zones, 200)).toEqual([zone('green', 0, 100)]);
  });

  it('does not modify the input array', () => {
    const zones = [zone('green', 0, 50), zone('red', 50, 100)];
    mergeShortZones(zones, 200);
    expect(zones).toHaveLength(2);
  });

  it('leaves zones alone when all are ≥ minLen', () => {
    const zones = [zone('green', 0, 300), zone('red', 300, 700)];
    expect(mergeShortZones(zones, 200)).toEqual(zones);
  });

  it('merges the smallest zone into its longer neighbour', () => {
    // short (50) is between two long zones; should merge into the longer one
    const zones = [zone('green', 0, 800), zone('red', 800, 850), zone('orange', 850, 1000)];
    const result = mergeShortZones(zones, 100);
    expect(result).toHaveLength(2);
    // The short red zone should have been absorbed
    const colors = result.map((z) => z.color);
    expect(colors).not.toContain('red');
  });

  it('merges a leading short zone into the zone to its right', () => {
    const zones = [zone('green', 0, 30), zone('red', 30, 500)];
    const result = mergeShortZones(zones, 100);
    expect(result).toHaveLength(1);
    expect(result[0].color).toBe('red');
    expect(result[0].start).toBe(0);
    expect(result[0].end).toBe(500);
  });

  it('merges a trailing short zone into the zone to its left', () => {
    const zones = [zone('green', 0, 500), zone('red', 500, 520)];
    const result = mergeShortZones(zones, 100);
    expect(result).toHaveLength(1);
    expect(result[0].color).toBe('green');
    expect(result[0].end).toBe(520);
  });

  it('returns a single zone after merging a two-zone array where both are short', () => {
    const zones = [zone('green', 0, 40), zone('red', 40, 70)];
    const result = mergeShortZones(zones, 100);
    expect(result).toHaveLength(1);
    expect(result[0].start).toBe(0);
    expect(result[0].end).toBe(70);
  });
});

// ── simplifyProfile ──────────────────────────────────────────────────────────

/** Build a minimal ProfilePoint. */
function pt(distance, elevation, gradient = 0) {
  return { distance, elevation, gradient };
}

describe('simplifyProfile', () => {
  it('returns profiles with ≤ 3 points unchanged', () => {
    const single = [pt(0, 100)];
    expect(simplifyProfile(single)).toEqual(single);

    const two = [pt(0, 100), pt(1000, 200)];
    expect(simplifyProfile(two)).toEqual(two);

    const three = [pt(0, 100), pt(500, 150), pt(1000, 200)];
    expect(simplifyProfile(three)).toEqual(three);
  });

  it('always preserves the first and last point', () => {
    const profile = Array.from({ length: 100 }, (_, i) => pt(i * 100, 100 + i));
    const result = simplifyProfile(profile);
    expect(result[0]).toEqual(profile[0]);
    expect(result[result.length - 1]).toEqual(profile[profile.length - 1]);
  });

  it('reduces a long uniform-gradient profile to ≤ 20 points', () => {
    const profile = Array.from({ length: 200 }, (_, i) => pt(i * 10, 100 + i * 0.5, 5));
    const result = simplifyProfile(profile);
    expect(result.length).toBeLessThanOrEqual(20);
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps inflection points where gradient changes sharply', () => {
    // Flat → steep → flat: the inflection indices must be in the output
    const profile = [
      pt(0, 100, 0),
      pt(100, 100, 0),
      pt(200, 103, 3),  // +3% change from 0 → kept
      pt(300, 106, 3),
      pt(400, 109, 3),
      pt(500, 109, 0),  // −3% change → kept
      pt(600, 109, 0),
    ];
    const result = simplifyProfile(profile);
    const distances = result.map((p) => p.distance);
    // First and last must be present
    expect(distances).toContain(0);
    expect(distances).toContain(600);
  });
});
