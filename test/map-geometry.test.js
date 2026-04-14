/**
 * test/map-geometry.test.js
 *
 * Unit tests for `src/map-geometry.ts`.
 * `mercatorToPixel` is a pure function with no DOM dependency.
 *
 * Run: npm test
 */

import { describe, it, expect } from 'vitest';
import { mercatorToPixel } from '../src/map-geometry.ts';

describe('mercatorToPixel', () => {
  it('projects the map centre to the exact pixel centre of the viewport', () => {
    const W = 800, H = 600;
    const lat = 50.0, lon = 14.0, zoom = 12;
    const { x, y } = mercatorToPixel(lat, lon, lat, lon, zoom, W, H);
    expect(x).toBeCloseTo(W / 2, 5);
    expect(y).toBeCloseTo(H / 2, 5);
  });

  it('a point east of centre maps to x > W/2', () => {
    const W = 800, H = 600;
    const cLat = 50.0, cLon = 14.0, zoom = 10;
    const { x } = mercatorToPixel(cLat, 14.5, cLat, cLon, zoom, W, H);
    expect(x).toBeGreaterThan(W / 2);
  });

  it('a point west of centre maps to x < W/2', () => {
    const W = 800, H = 600;
    const cLat = 50.0, cLon = 14.0, zoom = 10;
    const { x } = mercatorToPixel(cLat, 13.5, cLat, cLon, zoom, W, H);
    expect(x).toBeLessThan(W / 2);
  });

  it('a point north of centre maps to y < H/2 (screen Y increases downward)', () => {
    const W = 800, H = 600;
    const cLat = 50.0, cLon = 14.0, zoom = 10;
    const { y } = mercatorToPixel(50.5, cLon, cLat, cLon, zoom, W, H);
    expect(y).toBeLessThan(H / 2);
  });

  it('a point south of centre maps to y > H/2', () => {
    const W = 800, H = 600;
    const cLat = 50.0, cLon = 14.0, zoom = 10;
    const { y } = mercatorToPixel(49.5, cLon, cLat, cLon, zoom, W, H);
    expect(y).toBeGreaterThan(H / 2);
  });

  it('higher zoom produces larger pixel offsets for the same coordinate delta', () => {
    const W = 800, H = 600;
    const cLat = 50, cLon = 14;
    const { x: x8 } = mercatorToPixel(cLat, 14.1, cLat, cLon, 8, W, H);
    const { x: x12 } = mercatorToPixel(cLat, 14.1, cLat, cLon, 12, W, H);
    expect(Math.abs(x12 - W / 2)).toBeGreaterThan(Math.abs(x8 - W / 2));
  });

  it('symmetric: mirrored points around centre are equidistant', () => {
    const W = 800, H = 600;
    const cLat = 50, cLon = 14, zoom = 10;
    const { x: xE } = mercatorToPixel(cLat, 14.2, cLat, cLon, zoom, W, H);
    const { x: xW } = mercatorToPixel(cLat, 13.8, cLat, cLon, zoom, W, H);
    expect(xE + xW).toBeCloseTo(W, 4);
  });
});
