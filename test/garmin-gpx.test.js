// @vitest-environment happy-dom
/**
 * test/garmin-gpx.test.js
 *
 * Unit tests for the CLI's dependency-free GPX reader in `src/cli/garmin-gpx.ts`.
 *
 * The happy-dom annotation is here for the parity suite at the bottom, which
 * needs DOMParser to run the browser-side `parseGPX` alongside it. Two GPX
 * readers now exist in this repo; that suite is what keeps them from drifting.
 *
 * Run: npm test
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import { parseGarminGpx } from '../src/cli/garmin-gpx.ts';
import { parseGPX } from '../src/gpx-parser.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, 'fixtures');
const readFixture = (name) => readFileSync(resolve(FIXTURES_DIR, name), 'utf-8');

/** Wrap trackpoint XML in the minimum GPX envelope. */
function gpx(trackpoints) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx creator="Garmin Connect" version="1.1"
  xmlns:ns3="http://www.garmin.com/xmlschemas/TrackPointExtension/v1"
  xmlns="http://www.topografix.com/GPX/1/1">
  <trk><trkseg>${trackpoints}</trkseg></trk>
</gpx>`;
}

/** A Garmin-shaped trackpoint. */
function trkpt({ lat, lon, ele = 100, time = null, hr = null }) {
  const eleTag = ele === null ? '' : `<ele>${ele}</ele>`;
  const timeTag = time === null ? '' : `<time>${time}</time>`;
  const hrTag =
    hr === null
      ? ''
      : `<extensions><ns3:TrackPointExtension><ns3:hr>${hr}</ns3:hr></ns3:TrackPointExtension></extensions>`;
  return `<trkpt lat="${lat}" lon="${lon}">${eleTag}${timeTag}${hrTag}</trkpt>`;
}

describe('parseGarminGpx', () => {
  it('keeps time and heart rate, which parseGPX discards', () => {
    const { points } = parseGarminGpx(
      gpx(
        trkpt({ lat: 48.0, lon: 16.0, ele: 200, time: '2026-03-14T09:00:00.000Z', hr: 120 }) +
          trkpt({ lat: 48.001, lon: 16.0, ele: 210, time: '2026-03-14T09:00:05.000Z', hr: 134 })
      )
    );

    expect(points).toHaveLength(2);
    expect(points[0].hr).toBe(120);
    expect(points[1].hr).toBe(134);
    expect(points[1].t - points[0].t).toBe(5);
    expect(points[0].ele).toBe(200);
  });

  it('accumulates cumulative distance from lat/lon', () => {
    // One degree of latitude is R * (pi/180) with R = 6371000.
    const { points } = parseGarminGpx(
      gpx(trkpt({ lat: 48.0, lon: 16.0 }) + trkpt({ lat: 48.01, lon: 16.0 }))
    );

    expect(points[0].d).toBe(0);
    expect(points[1].d).toBeCloseTo((6371000 * Math.PI * 0.01) / 180, 3);
  });

  it('emits tuples in the shape detectClimbs consumes', () => {
    const { tuples } = parseGarminGpx(
      gpx(trkpt({ lat: 48.0, lon: 16.0, ele: 200 }) + trkpt({ lat: 48.001, lon: 16.0, ele: 210 }))
    );

    expect(tuples[0]).toEqual([0, 200, 48.0, 16.0]);
    expect(tuples[1][1]).toBe(210);
    expect(tuples[1][2]).toBe(48.001);
  });

  it('defaults missing elevation to 0 and missing time/hr to null', () => {
    const { points } = parseGarminGpx(gpx(trkpt({ lat: 48.0, lon: 16.0, ele: null })));

    expect(points[0].ele).toBe(0);
    expect(points[0].t).toBeNull();
    expect(points[0].hr).toBeNull();
  });

  it('reads self-closing trackpoints', () => {
    const { points } = parseGarminGpx(
      gpx('<trkpt lat="48.0" lon="16.0"/><trkpt lat="48.001" lon="16.0" />')
    );

    expect(points).toHaveLength(2);
    expect(points[1].lat).toBe(48.001);
  });

  it('reads attributes in either order and with single quotes', () => {
    const { points } = parseGarminGpx(gpx(`<trkpt lon='16.5' lat='48.5'><ele>300</ele></trkpt>`));

    expect(points[0].lat).toBe(48.5);
    expect(points[0].lon).toBe(16.5);
  });

  it('accepts heart rate without a namespace prefix', () => {
    const { points } = parseGarminGpx(
      gpx('<trkpt lat="48.0" lon="16.0"><extensions><hr>145</hr></extensions></trkpt>')
    );

    expect(points[0].hr).toBe(145);
  });

  it('skips trackpoints with unusable coordinates', () => {
    const { points } = parseGarminGpx(
      gpx('<trkpt lat="not-a-number" lon="16.0"></trkpt>' + trkpt({ lat: 48.0, lon: 16.0 }))
    );

    expect(points).toHaveLength(1);
    expect(points[0].lat).toBe(48.0);
  });

  it('does not match elements whose name merely starts with trkpt', () => {
    const { points } = parseGarminGpx(
      gpx('<trkptExtension lat="1.0" lon="2.0"></trkptExtension>' + trkpt({ lat: 48.0, lon: 16.0 }))
    );

    expect(points).toHaveLength(1);
    expect(points[0].lat).toBe(48.0);
  });

  it('throws when there is no usable track', () => {
    expect(() => parseGarminGpx('<gpx></gpx>')).toThrow(/No valid track points/);
    expect(() => parseGarminGpx('this is not xml at all')).toThrow(/No valid track points/);
  });

  it('reads the synthetic ride fixture end to end', () => {
    const { points } = parseGarminGpx(readFixture('ride-synthetic.gpx'));

    expect(points.length).toBeGreaterThan(300);
    expect(points.every((p) => p.hr !== null && p.t !== null)).toBe(true);
    // Distance is non-decreasing and the ride is about 9 km.
    expect(points.at(-1).d).toBeGreaterThan(8500);
    expect(points.every((p, i) => i === 0 || p.d >= points[i - 1].d)).toBe(true);
  });
});

// ─── Anti-drift: the two readers must agree on the distance axis ─────────────

describe('parity with the browser-side parseGPX', () => {
  const FIXTURES = [
    'lh.gpx',
    'grun.gpx',
    'b7.gpx',
    'travny.gpx',
    'hukvaldy.gpx',
    'bk.gpx',
    'ond_mal.gpx',
    'ride-synthetic.gpx',
  ];

  it.each(FIXTURES)('produces tuples identical to parseGPX for %s', (file) => {
    const source = readFixture(file);

    // Exact equality, not tolerance: both readers use the same haversine over
    // the same points, so any difference means one of them has changed.
    expect(parseGarminGpx(source).tuples).toEqual(parseGPX(source));
  });
});
