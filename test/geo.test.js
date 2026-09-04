/**
 * test/geo.test.js
 *
 * Unit tests for the one great-circle distance (`src/geo.ts`), which src/gpx.ts
 * accumulates the distance axis with.
 *
 * These pin the formula itself, so a wrong edit here fails with a readable
 * number rather than as a fixture mismatch in test/gpx-integration.test.js,
 * where every real route runs through the reader into detection.
 *
 * Run: npm test
 */

import { describe, it, expect } from 'vitest';
import { haversineDistance } from '../src/geo.ts';

/** One degree of latitude on the sphere the formula uses. */
const DEG_LAT_M = (6371000 * Math.PI) / 180;

describe('haversineDistance', () => {
  it('measures one degree of latitude as R * pi / 180', () => {
    expect(haversineDistance(50, 14, 51, 14)).toBeCloseTo(DEG_LAT_M, 3);
  });

  it('returns 0 for two identical points', () => {
    expect(haversineDistance(50, 14, 50, 14)).toBe(0);
  });

  it('is symmetric', () => {
    expect(haversineDistance(49.5, 18.2, 50.1, 14.4)).toBe(
      haversineDistance(50.1, 14.4, 49.5, 18.2)
    );
  });

  it('shrinks a degree of longitude by cos(latitude)', () => {
    // The cos(lat) term is the easiest one to drop; without it a degree of
    // longitude would measure the same at 50 N as on the equator (ratio 1).
    // The ratio, not the metres: cos(lat) is the small-angle approximation of
    // the exact haversine, and over a whole degree the two differ by ~0.5 m.
    const atEquator = haversineDistance(0, 14, 0, 15);
    const at50North = haversineDistance(50, 14, 50, 15);

    expect(atEquator).toBeCloseTo(DEG_LAT_M, 3);
    expect(at50North / atEquator).toBeCloseTo(Math.cos((50 * Math.PI) / 180), 4);
  });

  it('handles a short trackpoint-sized gap', () => {
    // ~10 m of latitude, the scale the readers actually work at.
    const tenMetresInDegrees = 10 / DEG_LAT_M;
    expect(haversineDistance(49.5, 18.2, 49.5 + tenMetresInDegrees, 18.2)).toBeCloseTo(10, 6);
  });
});
