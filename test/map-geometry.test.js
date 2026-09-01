// @vitest-environment happy-dom
/**
 * test/map-geometry.test.js
 *
 * Unit tests for `src/map-geometry.ts`.
 * `mercatorToPixel` is a pure function with no DOM dependency;
 * `getMapContainer` reads the DOM, hence the @vitest-environment annotation above.
 *
 * Run: npm test
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  mercatorToPixel,
  getMapContainer,
  worldSize,
  visibleCenterOffset,
  viewportFromURL,
} from '../src/map-geometry.ts';

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

describe('mercatorToPixel with fractional zoom', () => {
  it('accepts a fractional zoom level and scales between the integer levels', () => {
    const W = 800, H = 600;
    const cLat = 49.5828352, cLon = 18.3129080;
    const at = (zoom) => mercatorToPixel(49.6, 18.35, cLat, cLon, zoom, W, H).x - W / 2;

    const x13 = at(13), x13_248 = at(13.248), x14 = at(14);
    expect(x13_248).toBeGreaterThan(x13);
    expect(x13_248).toBeLessThan(x14);
    // Offsets scale as 2^zoom, so the fractional level is an exact power-of-two step.
    expect(x13_248).toBeCloseTo(x13 * Math.pow(2, 0.248), 6);
  });

  it('truncating a fractional zoom would misplace points by tens of pixels', () => {
    const W = 1520, H = 865;
    const cLat = 49.5828352, cLon = 18.3129080;
    const exact = mercatorToPixel(49.6, 18.35, cLat, cLon, 13.248, W, H);
    const truncated = mercatorToPixel(49.6, 18.35, cLat, cLon, 13, W, H);
    expect(Math.hypot(exact.x - truncated.x, exact.y - truncated.y)).toBeGreaterThan(40);
  });
});

describe('getMapContainer', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  /** happy-dom reports 0x0 for every element, so stub the box explicitly. */
  function addContainer(id, { width, height }) {
    const el = document.createElement('div');
    el.id = id;
    el.getBoundingClientRect = () => ({
      width, height, left: 0, top: 0, right: width, bottom: height, x: 0, y: 0,
    });
    document.body.appendChild(el);
    return el;
  }

  it('returns null when no candidate is present', () => {
    expect(getMapContainer()).toBeNull();
  });

  it('picks #map on the raster build', () => {
    const map = addContainer('map', { width: 1240, height: 865 });
    addContainer('scene', { width: 1520, height: 865 });
    expect(getMapContainer()).toBe(map);
  });

  it('falls through to #scene when #map is hidden, as on the vector build', () => {
    addContainer('map', { width: 0, height: 0 });
    const scene = addContainer('scene', { width: 1520, height: 865 });
    expect(getMapContainer()).toBe(scene);
  });

  it('returns null while every candidate is still zero-sized', () => {
    addContainer('map', { width: 0, height: 0 });
    addContainer('scene', { width: 0, height: 0 });
    expect(getMapContainer()).toBeNull();
  });
});

describe('worldSize', () => {
  it('is 256 px at zoom 0 and doubles per level', () => {
    expect(worldSize(0)).toBe(256);
    expect(worldSize(1)).toBe(512);
    expect(worldSize(13)).toBe(256 * 8192);
  });

  it('agrees with the scale mercatorToPixel uses, including fractional zoom', () => {
    // One full turn around the globe must be exactly one world width.
    const W = 800, H = 600, zoom = 11.5;
    const a = mercatorToPixel(0, -180, 0, 0, zoom, W, H).x;
    const b = mercatorToPixel(0, 180, 0, 0, zoom, W, H).x;
    expect(b - a).toBeCloseTo(worldSize(zoom), 6);
  });
});

describe('visibleCenterOffset', () => {
  const map = { left: 0, top: 0, width: 1520, height: 865 };

  it('is 0 when the sidebar sits beside the map, as mapy.com lays it out today', () => {
    const sidebar = { left: 1520, top: 0, width: 390, height: 865 };
    expect(visibleCenterOffset(map, sidebar)).toBe(0);
  });

  it('is 0 when there is no sidebar at all', () => {
    expect(visibleCenterOffset(map, null)).toBe(0);
  });

  it('shifts left by half the overlap when the sidebar floats over the right of the map', () => {
    const sidebar = { left: 1240, top: 0, width: 390, height: 865 };
    // Overlap runs 1240 → 1520, i.e. 280 px.
    expect(visibleCenterOffset(map, sidebar)).toBe(-140);
  });

  it('shifts right when the panel covers the left of the map instead', () => {
    const sidebar = { left: -100, top: 0, width: 400, height: 865 };
    // Overlap runs 0 → 300, i.e. 300 px.
    expect(visibleCenterOffset(map, sidebar)).toBe(150);
  });

  it('ignores a collapsed, zero-width sidebar', () => {
    expect(visibleCenterOffset(map, { left: 700, top: 0, width: 0, height: 865 })).toBe(0);
  });

  it('offsets the target by exactly half the hidden strip', () => {
    const sidebar = { left: 1240, top: 0, width: 390, height: 865 };
    const dx = visibleCenterOffset(map, sidebar);
    const visibleCentre = (map.left + sidebar.left) / 2;
    expect(map.width / 2 + dx).toBe(visibleCentre);
  });
});

describe('viewportFromURL', () => {
  const setSearch = (search) => history.replaceState({}, '', `/planovani-trasy${search}`);

  it('reads centre and zoom out of the query string', () => {
    setSearch('?x=14.4212&y=50.0874&z=13');
    expect(viewportFromURL()).toEqual({ lon: 14.4212, lat: 50.0874, zoom: 13 });
  });

  it('keeps the vector build\'s fractional zoom instead of truncating it', () => {
    setSearch('?x=18.312908&y=49.5828352&z=13.248');
    expect(viewportFromURL().zoom).toBe(13.248);
  });

  it('ignores unrelated mapy.com params', () => {
    setSearch('?planovani-trasy&rc=9jUfIx1dqx&x=15.6&y=50.72&z=12&rbf=alf');
    expect(viewportFromURL()).toEqual({ lon: 15.6, lat: 50.72, zoom: 12 });
  });

  it('returns null when any of the three params is missing or unparseable', () => {
    setSearch('?x=14.4212&y=50.0874');
    expect(viewportFromURL()).toBeNull();
    setSearch('?x=&y=50.0874&z=13');
    expect(viewportFromURL()).toBeNull();
    setSearch('');
    expect(viewportFromURL()).toBeNull();
  });
});
