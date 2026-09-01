/**
 * test/ride-metrics.test.js
 *
 * Unit tests for moving-time and heart-rate aggregation in
 * `src/cli/ride-metrics.ts`. These are hand-built point streams: the point is
 * to pin down exactly which intervals count as moving and how heart rate is
 * weighted, since VAM and the zone split are only as good as that filter.
 *
 * Run: npm test
 */

import { describe, it, expect } from 'vitest';
import {
  aggregateWindow,
  parseZones,
  zoneIndex,
  indexAtDistance,
  DEFAULT_MOVING,
} from '../src/cli/ride-metrics.ts';

/**
 * Build a point stream from [dt, dd, hr] triples, where dt is seconds and dd is
 * metres travelled since the previous point. The first point anchors t and d.
 */
function stream(steps, startHr = null) {
  const points = [{ lat: 48, lon: 16, ele: 100, t: 0, hr: startHr, d: 0 }];
  let t = 0;
  let d = 0;
  for (const [dt, dd, hr] of steps) {
    t += dt;
    d += dd;
    points.push({ lat: 48, lon: 16, ele: 100, t, hr: hr ?? null, d });
  }
  return points;
}

const all = (points, zones = null, moving = DEFAULT_MOVING) =>
  aggregateWindow(points, 0, points.length - 1, zones, moving);

// Neutral test values — real zone boundaries are personal data and are passed
// in at the command line, never committed.
const ZONES = [130, 145, 155, 165];

describe('aggregateWindow — moving time', () => {
  it('sums moving intervals rather than elapsed time', () => {
    // 10 s riding, 10 s stopped, 10 s riding.
    const points = stream([
      [10, 60],
      [10, 0],
      [10, 60],
    ]);

    const metrics = all(points);

    expect(metrics.elapsedSec).toBe(30);
    expect(metrics.movingSec).toBe(20);
  });

  it('excludes intervals below the speed floor', () => {
    // 0.5 m/s is walking-the-bike slow and below the 0.8 m/s default.
    const metrics = all(stream([[10, 5]]));

    expect(metrics.movingSec).toBe(0);
  });

  it('includes an interval exactly at the speed floor', () => {
    const metrics = all(stream([[10, 8]]));

    expect(metrics.movingSec).toBe(10);
  });

  it('excludes recording gaps at or beyond the max gap', () => {
    // A 60 s gap covering 600 m is fast enough, but it is a gap, not riding.
    const points = stream([
      [10, 60],
      [60, 600],
      [10, 60],
    ]);

    const metrics = all(points);

    expect(metrics.elapsedSec).toBe(80);
    expect(metrics.movingSec).toBe(20);
  });

  it('honours custom thresholds', () => {
    const points = stream([[45, 450]]);

    expect(all(points).movingSec).toBe(0);
    expect(all(points, null, { minSpeedMps: 0.8, maxGapSec: 60 }).movingSec).toBe(45);
  });

  it('reports zero moving time when no point carries a timestamp', () => {
    const points = [
      { lat: 48, lon: 16, ele: 100, t: null, hr: 150, d: 0 },
      { lat: 48, lon: 16, ele: 110, t: null, hr: 150, d: 100 },
    ];

    const metrics = all(points);

    expect(metrics.movingSec).toBe(0);
    expect(metrics.elapsedSec).toBe(0);
  });
});

describe('aggregateWindow — heart rate', () => {
  it('weights the average by interval duration, not sample count', () => {
    // Three dense 5 s samples at 100 bpm, then one 25 s sample at 180 bpm.
    // Unweighted mean would be 120; duration-weighted is 160.
    const points = stream(
      [
        [5, 50, 100],
        [5, 50, 100],
        [5, 50, 100],
        [25, 250, 180],
      ],
      100
    );

    const metrics = all(points);

    expect(metrics.movingSec).toBe(40);
    expect(metrics.avgHr).toBeCloseTo((100 * 15 + 180 * 25) / 40, 6);
    expect(metrics.avgHr).not.toBeCloseTo(120, 1);
  });

  it('excludes a stop from the average so it does not drag the effort down', () => {
    const points = stream(
      [
        [10, 100, 170],
        [10, 0, 90],
        [10, 100, 170],
      ],
      170
    );

    expect(all(points).avgHr).toBe(170);
  });

  it('takes max HR across the whole window, including while stopped', () => {
    // A peak is a peak even if the bike was stationary at that moment.
    const points = stream(
      [
        [10, 100, 150],
        [10, 0, 188],
      ],
      140
    );

    const metrics = all(points);

    expect(metrics.maxHr).toBe(188);
    expect(metrics.avgHr).toBe(150);
  });

  it('returns null HR fields rather than NaN when no sample carries HR', () => {
    const metrics = all(stream([[10, 100]]), ZONES);

    expect(metrics.avgHr).toBeNull();
    expect(metrics.maxHr).toBeNull();
    expect(metrics.z4z5Sec).toBe(0);
  });

  it('leaves zone fields null when no zones are supplied', () => {
    const metrics = all(stream([[10, 100, 170]], 170));

    expect(metrics.zoneSec).toBeNull();
    expect(metrics.z4z5Sec).toBeNull();
  });
});

describe('aggregateWindow — zone split', () => {
  it('accumulates moving seconds per zone', () => {
    const points = stream(
      [
        [10, 100, 120], // Z1
        [10, 100, 150], // Z3
        [10, 100, 170], // Z5
      ],
      120
    );

    const metrics = all(points, ZONES);

    expect(metrics.zoneSec).toEqual([10, 0, 10, 0, 10]);
    expect(metrics.z4z5Sec).toBe(10);
  });

  it('counts only moving time towards the zone split', () => {
    const points = stream(
      [
        [10, 100, 170],
        [10, 0, 170], // stopped, still at 170 bpm
      ],
      170
    );

    expect(all(points, ZONES).z4z5Sec).toBe(10);
  });
});

describe('zoneIndex', () => {
  it('treats each boundary as an inclusive lower bound', () => {
    expect(zoneIndex(129, ZONES)).toBe(0);
    expect(zoneIndex(130, ZONES)).toBe(1);
    expect(zoneIndex(144, ZONES)).toBe(1);
    expect(zoneIndex(145, ZONES)).toBe(2);
    expect(zoneIndex(155, ZONES)).toBe(3);
    expect(zoneIndex(164, ZONES)).toBe(3);
    expect(zoneIndex(165, ZONES)).toBe(4);
    expect(zoneIndex(200, ZONES)).toBe(4);
  });
});

describe('parseZones', () => {
  it('parses four ascending boundaries', () => {
    expect(parseZones('130,145,155,165')).toEqual([130, 145, 155, 165]);
    expect(parseZones(' 130 , 145 , 155 , 165 ')).toEqual([130, 145, 155, 165]);
  });

  it('rejects the wrong number of boundaries', () => {
    expect(() => parseZones('130,145,155')).toThrow(/4 comma-separated/);
    expect(() => parseZones('130,145,155,165,175')).toThrow(/4 comma-separated/);
  });

  it('rejects non-ascending boundaries', () => {
    expect(() => parseZones('130,145,145,165')).toThrow(/strictly ascend/);
    expect(() => parseZones('165,155,145,130')).toThrow(/strictly ascend/);
  });

  it('rejects values that are not positive whole bpm', () => {
    expect(() => parseZones('130,145,x,165')).toThrow(/positive whole-number/);
    expect(() => parseZones('130,145,155.5,165')).toThrow(/positive whole-number/);
    expect(() => parseZones('0,145,155,165')).toThrow(/positive whole-number/);
  });
});

describe('indexAtDistance', () => {
  const points = stream([
    [10, 100],
    [10, 100],
    [10, 100],
  ]);

  it('finds the first point at or past a distance', () => {
    expect(indexAtDistance(points, 0)).toBe(0);
    expect(indexAtDistance(points, 100)).toBe(1);
    expect(indexAtDistance(points, 150)).toBe(2);
    expect(indexAtDistance(points, 300)).toBe(3);
  });

  it('clamps past the end of the track', () => {
    expect(indexAtDistance(points, 99999)).toBe(points.length - 1);
  });
});
