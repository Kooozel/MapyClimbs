/**
 * test/gpx.test.js
 *
 * Unit tests for the one GPX reader, `src/gpx.ts`.
 *
 * No `@vitest-environment happy-dom` here, deliberately: the reader scans the
 * XML itself, so a suite that needed a DOM to exercise it would be hiding the
 * very property that lets one file serve both the extension and the CLI (#77).
 * The parity suite that used to pin it against a second, DOMParser-based reader
 * is gone with that reader; test/gpx-integration.test.js is the regression net
 * now, running every real route fixture through this reader into detection and
 * asserting the results in test/fixtures/expected.js.
 *
 * Run: npm test
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import { parseGpx } from '../src/gpx.ts';

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

describe('parseGpx', () => {
  it('keeps time and heart rate, which the extension ignores and the CLI needs', () => {
    const { points } = parseGpx(
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
    const { points } = parseGpx(
      gpx(trkpt({ lat: 48.0, lon: 16.0 }) + trkpt({ lat: 48.01, lon: 16.0 }))
    );

    expect(points[0].d).toBe(0);
    expect(points[1].d).toBeCloseTo((6371000 * Math.PI * 0.01) / 180, 3);
  });

  it('emits tuples in the shape detectClimbs consumes', () => {
    const { tuples } = parseGpx(
      gpx(trkpt({ lat: 48.0, lon: 16.0, ele: 200 }) + trkpt({ lat: 48.001, lon: 16.0, ele: 210 }))
    );

    expect(tuples[0]).toEqual([0, 200, 48.0, 16.0]);
    expect(tuples[1][1]).toBe(210);
    expect(tuples[1][2]).toBe(48.001);
  });

  it('defaults missing elevation to 0 and missing time/hr to null', () => {
    const { points } = parseGpx(gpx(trkpt({ lat: 48.0, lon: 16.0, ele: null })));

    expect(points[0].ele).toBe(0);
    expect(points[0].t).toBeNull();
    expect(points[0].hr).toBeNull();
  });

  it('reads self-closing trackpoints', () => {
    const { points } = parseGpx(
      gpx('<trkpt lat="48.0" lon="16.0"/><trkpt lat="48.001" lon="16.0" />')
    );

    expect(points).toHaveLength(2);
    expect(points[1].lat).toBe(48.001);
  });

  it('reads attributes in either order and with single quotes', () => {
    const { points } = parseGpx(gpx(`<trkpt lon='16.5' lat='48.5'><ele>300</ele></trkpt>`));

    expect(points[0].lat).toBe(48.5);
    expect(points[0].lon).toBe(16.5);
  });

  it('accepts heart rate without a namespace prefix', () => {
    const { points } = parseGpx(
      gpx('<trkpt lat="48.0" lon="16.0"><extensions><hr>145</hr></extensions></trkpt>')
    );

    expect(points[0].hr).toBe(145);
  });

  it('skips trackpoints with unusable coordinates', () => {
    const { points } = parseGpx(
      gpx('<trkpt lat="not-a-number" lon="16.0"></trkpt>' + trkpt({ lat: 48.0, lon: 16.0 }))
    );

    expect(points).toHaveLength(1);
    expect(points[0].lat).toBe(48.0);
  });

  it('does not match elements whose name merely starts with trkpt', () => {
    const { points } = parseGpx(
      gpx('<trkptExtension lat="1.0" lon="2.0"></trkptExtension>' + trkpt({ lat: 48.0, lon: 16.0 }))
    );

    expect(points).toHaveLength(1);
    expect(points[0].lat).toBe(48.0);
  });

  it('reports a well-formed empty track and unparseable input as the same error', () => {
    // The DOM reader this replaced said "Invalid XML in GPX file" for the second
    // case. One message for both is the accepted cost of a reader that needs no
    // DOM (#77) — and the text only ever reaches a title attribute and the
    // console, never the rendered panel, so nothing a user sees changed.
    expect(() => parseGpx('<gpx></gpx>')).toThrow(/No valid track points/);
    expect(() => parseGpx('this is not xml at all')).toThrow(/No valid track points/);
  });

  it('reads the synthetic ride fixture end to end', () => {
    const { points } = parseGpx(readFixture('ride-synthetic.gpx'));

    expect(points.length).toBeGreaterThan(300);
    expect(points.every((p) => p.hr !== null && p.t !== null)).toBe(true);
    // Distance is non-decreasing and the ride is about 9 km.
    expect(points.at(-1).d).toBeGreaterThan(8500);
    expect(points.every((p, i) => i === 0 || p.d >= points[i - 1].d)).toBe(true);
  });
});
