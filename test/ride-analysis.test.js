/**
 * test/ride-analysis.test.js
 *
 * End-to-end tests for `src/cli/analyze-ride.ts`: GPX text in, the snake_case
 * JSON that ~/sport consumes out. This is the interface contract, so the shape
 * assertions here are deliberate — a rename breaks sync.py.
 *
 * Fixture: test/fixtures/ride-synthetic.gpx. It carries no personal data — a
 * straight line north from 48.0N 16.0E with a scripted profile (see the <desc>
 * element in the fixture for the full leg-by-leg breakdown). Two climbs, a
 * 3-minute stationary stop inside the first one, and a 60 s recording gap on
 * the descent between them.
 *
 * Run: npm test
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import { analyzeRide } from '../src/cli/analyze-ride.ts';
import { DEFAULT_MOVING } from '../src/cli/ride-metrics.ts';
import { detectClimbs } from '../src/climb-engine.ts';
import { parseGpx } from '../src/gpx.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RIDE = readFileSync(resolve(__dirname, 'fixtures', 'ride-synthetic.gpx'), 'utf-8');

// Neutral test values — real zone boundaries are personal data, passed at the
// command line and never committed.
const ZONES = [130, 145, 155, 165];

const analyze = (overrides = {}) =>
  analyzeRide(RIDE, {
    source: 'ride-synthetic.gpx',
    model: 'aso',
    includeUncategorized: false,
    zones: ZONES,
    moving: DEFAULT_MOVING,
    ...overrides,
  });

/** The scripted stop, in seconds. */
const STOP_SEC = 180;

describe('analyzeRide — output contract', () => {
  const result = analyze();

  it('echoes the source and model', () => {
    expect(result.source).toBe('ride-synthetic.gpx');
    expect(result.scoring_model).toBe('aso');
  });

  it('uses snake_case keys throughout, with no camelCase leaking from the engine', () => {
    const camel = /[a-z][A-Z]/;
    const keys = [
      ...Object.keys(result),
      ...Object.keys(result.route),
      ...Object.keys(result.climbs[0]),
    ];

    expect(keys.filter((key) => camel.test(key))).toEqual([]);
  });

  it('emits exactly the climb columns ~/sport inserts', () => {
    expect(Object.keys(result.climbs[0]).sort()).toEqual(
      [
        'avg_grade',
        'avg_hr',
        'category',
        'climb_index',
        'difficulty',
        'distance_m',
        'elapsed_sec',
        'elevation_m',
        'max_grade',
        'max_hr',
        'moving_sec',
        'pct_z4z5',
        'start_km',
        'start_lat',
        'start_lon',
        'top_lat',
        'top_lon',
        'vam',
      ].sort()
    );
  });

  it('does not emit segment geometry', () => {
    expect(result.climbs[0].segments).toBeUndefined();
  });
});

describe('analyzeRide — detection', () => {
  const result = analyze();

  it('finds the two scripted climbs', () => {
    expect(result.climbs).toHaveLength(2);
    expect(result.route.climb_count).toBe(2);
  });

  it('indexes climbs in route order with increasing offsets', () => {
    expect(result.climbs.map((c) => c.climb_index)).toEqual([0, 1]);
    expect(result.climbs[1].start_km).toBeGreaterThan(result.climbs[0].start_km);
  });

  it('recovers the scripted gradients', () => {
    expect(result.climbs[0].avg_grade).toBeCloseTo(6, 0);
    expect(result.climbs[1].avg_grade).toBeCloseTo(5, 0);
    // Max sustained gradient is measured over a 200 m window, so on a constant
    // gradient it lands just above the average rather than far above it.
    expect(result.climbs[0].max_grade).toBeGreaterThanOrEqual(result.climbs[0].avg_grade);
  });

  it('carries start and summit coordinates for every climb', () => {
    for (const climb of result.climbs) {
      expect(climb.start_lat).not.toBeNull();
      expect(climb.start_lon).not.toBeNull();
      expect(climb.top_lat).not.toBeNull();
      expect(climb.top_lon).not.toBeNull();
      // The track runs due north, so the summit is north of the start.
      expect(climb.top_lat).toBeGreaterThan(climb.start_lat);
    }
  });

  it('agrees with detectClimbs run directly on route totals', () => {
    const direct = detectClimbs(parseGpx(RIDE).tuples);

    expect(result.route.total_distance_m).toBeCloseTo(direct.totalDistance, 0);
    expect(result.route.total_elevation_gain_m).toBeCloseTo(direct.totalElevationGain, 0);
    expect(result.route.total_elevation_loss_m).toBeCloseTo(direct.totalElevationLoss, 0);
    expect(result.climbs).toHaveLength(direct.climbs.length);
  });

  it('honours the scoring model', () => {
    const garmin = analyze({ model: 'garmin' });

    // Same terrain, different category scale — the ASO and Garmin formulas
    // disagree on these climbs, which is the point of having both.
    expect(garmin.climbs[0].difficulty).not.toBeCloseTo(analyze().climbs[0].difficulty, 1);
  });
});

describe('analyzeRide — moving time and VAM', () => {
  const result = analyze();

  it('excludes the scripted stop from the first climb', () => {
    const climb = result.climbs[0];

    expect(climb.elapsed_sec - climb.moving_sec).toBeCloseTo(STOP_SEC, -1);
    expect(climb.moving_sec).toBeLessThan(climb.elapsed_sec);
  });

  it('has no gap to remove on the uninterrupted second climb', () => {
    const climb = result.climbs[1];

    expect(climb.moving_sec).toBe(climb.elapsed_sec);
  });

  it('computes VAM on moving time, so the stop does not depress it', () => {
    const climb = result.climbs[0];

    // Both operands are rounded for output, so compare to within 1 m/h.
    expect(climb.vam).toBeCloseTo((climb.elevation_m / climb.moving_sec) * 3600, 0);
    // Using elapsed time instead would understate VAM by roughly a quarter.
    expect(climb.vam).toBeGreaterThan((climb.elevation_m / climb.elapsed_sec) * 3600 * 1.15);
  });

  it('produces plausible climbing rates', () => {
    for (const climb of result.climbs) {
      expect(climb.vam).toBeGreaterThan(300);
      expect(climb.vam).toBeLessThan(1200);
    }
  });

  it('drops the stop and the recording gap from route moving time', () => {
    // A 180 s stop plus a 60 s gap. The boundary sample either side of each is
    // itself an excluded interval, so allow one 5 s sample of slack.
    const removed = result.route.elapsed_sec - result.route.moving_sec;

    expect(removed).toBeGreaterThanOrEqual(STOP_SEC + 60);
    expect(removed).toBeLessThanOrEqual(STOP_SEC + 60 + 10);
  });
});

describe('analyzeRide — heart rate', () => {
  const result = analyze();

  it('reports non-null HR for every climb', () => {
    for (const climb of result.climbs) {
      expect(climb.avg_hr).not.toBeNull();
      expect(climb.max_hr).not.toBeNull();
      expect(climb.max_hr).toBeGreaterThanOrEqual(climb.avg_hr);
    }
  });

  it('scores climbing harder than the ride as a whole', () => {
    expect(result.climbs[0].avg_hr).toBeGreaterThan(result.route.avg_hr);
  });

  it('expresses pct_z4z5 as a fraction of the climb’s moving time', () => {
    for (const climb of result.climbs) {
      expect(climb.pct_z4z5).toBeGreaterThanOrEqual(0);
      expect(climb.pct_z4z5).toBeLessThanOrEqual(1);
    }
  });

  it('attributes most hard time to the climbs', () => {
    const { z4z5_sec: total, z4z5_sec_on_climb: onClimb } = result.route;

    expect(total).toBeGreaterThan(0);
    expect(onClimb).toBeLessThanOrEqual(total);
    expect(onClimb / total).toBeGreaterThan(0.8);
  });

  it('nulls only the zone fields when no zones are supplied', () => {
    const noZones = analyze({ zones: null });

    expect(noZones.route.z4z5_sec).toBeNull();
    expect(noZones.route.z4z5_sec_on_climb).toBeNull();
    expect(noZones.climbs[0].pct_z4z5).toBeNull();
    // Everything else survives.
    expect(noZones.climbs[0].avg_hr).toBe(analyze().climbs[0].avg_hr);
    expect(noZones.climbs[0].max_hr).toBe(analyze().climbs[0].max_hr);
    expect(noZones.climbs[0].vam).toBe(analyze().climbs[0].vam);
  });
});

describe('analyzeRide — route totals', () => {
  const result = analyze();

  it('reports the ride start as an ISO timestamp', () => {
    expect(result.route.start_time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('sums climb moving time', () => {
    const sum = result.climbs.reduce((acc, c) => acc + c.moving_sec, 0);

    expect(result.route.climb_moving_sec).toBe(sum);
    expect(result.route.climb_moving_sec).toBeLessThan(result.route.moving_sec);
  });
});

/** The seven ClimbDebugEvent discriminants declared in src/climb-types.ts. */
const DEBUG_STAGES = [
  'pipeline',
  'identify-candidate',
  'identify-close',
  'identify-reject',
  'merge-pair',
  'trim',
  // Was 'categorize', with a difficulty and a category on it. Scoring left the
  // pipeline in #77, so the last decision point emits the measurement alone.
  'measure',
];

describe('analyzeRide — debug sink', () => {
  /** Collects everything the engine emits for one run of the fixture. */
  const trace = () => {
    const events = [];
    analyze({ debug: (event) => events.push(event) });
    return events;
  };

  it('forwards the sink to detectClimbs', () => {
    const events = trace();

    // `pipeline` is the one event detectClimbs always emits once it has data,
    // so its absence means the sink never reached the engine at all.
    expect(events.filter((e) => e.stage === 'pipeline')).toHaveLength(1);
    expect(events.length).toBeGreaterThan(1);
  });

  it('emits only declared stages', () => {
    for (const event of trace()) {
      expect(DEBUG_STAGES).toContain(event.stage);
    }
  });

  // Three ClimbDebugEvent fields were declared wider than the emitter ever
  // produced. These pin the narrowed unions: a payload outside them means the
  // types drifted back apart from the code.
  it('keeps identify-reject to the one reason it can emit', () => {
    for (const event of trace().filter((e) => e.stage === 'identify-reject')) {
      expect(event.reason).toBe('empty');
      // "noise-floor" is gone, and with it measuredGainM — which was only ever
      // emitted as a literal 0.
      expect(event).not.toHaveProperty('measuredGainM');
    }
  });

  it('keeps merge-pair to the decisions and reasons it can emit', () => {
    const pairs = trace().filter((e) => e.stage === 'merge-pair');

    expect(pairs.length).toBeGreaterThan(0);
    for (const event of pairs) {
      // "force-merge" was declared but is unreachable — the emitter is a
      // two-arm ternary on shouldMerge.
      expect(['merge', 'skip']).toContain(event.decision);
      expect([
        'within-gap-and-valley',
        'negative-gap',
        'gap-too-large',
        'valley-too-deep',
      ]).toContain(event.reason);
      // The reason must agree with the decision it explains.
      expect(event.reason === 'within-gap-and-valley').toBe(event.decision === 'merge');
    }
  });

  it('emits no undefined field on any event', () => {
    for (const event of trace()) {
      for (const [key, value] of Object.entries(event)) {
        expect(value, `${event.stage}.${key}`).toBeDefined();
      }
    }
  });

  it('does not change the analysis it traces', () => {
    const withSink = analyze({ debug: () => {} });

    expect(withSink).toEqual(analyze());
  });
});

describe('analyzeRide — degenerate input', () => {
  it('returns an empty analysis for a track too short to detect anything', () => {
    const minimal = `<gpx xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>
      <trkpt lat="48.0" lon="16.0"><ele>100</ele><time>2026-03-14T09:00:00.000Z</time></trkpt>
    </trkseg></trk></gpx>`;

    const result = analyzeRide(minimal, {
      source: 'minimal.gpx',
      model: 'aso',
      includeUncategorized: false,
      zones: ZONES,
      moving: DEFAULT_MOVING,
    });

    expect(result.climbs).toEqual([]);
    expect(result.route.climb_count).toBe(0);
    expect(result.route.moving_sec).toBe(0);
    expect(result.route.z4z5_sec).toBe(0);
    // No climbs means nothing to attribute, not a missing measurement.
    expect(result.route.z4z5_sec_on_climb).toBeNull();
  });

  it('propagates the parser error for an unusable file', () => {
    expect(() =>
      analyzeRide('<gpx></gpx>', {
        source: 'empty.gpx',
        model: 'aso',
        includeUncategorized: false,
        zones: null,
        moving: DEFAULT_MOVING,
      })
    ).toThrow(/No valid track points/);
  });
});
