/**
 * test/gpx-integration.test.js
 *
 * Integration tests: real GPX files → parseGpx → detectClimbs → assertions.
 *
 * With the DOMParser-based reader gone (#77) this file also stands in for the
 * parity suite that used to pin the two readers together: every real route
 * fixture goes through src/gpx.ts into detection, so an unnoticed change to the
 * distance axis shows up here as a fixture mismatch.
 *
 * SETUP:
 *   1. Drop .gpx files into test/fixtures/
 *   2. Fill expected values into test/fixtures/expected.js
 *      (Discovery run: see DEBUG_OUTPUT below)
 *
 * Both debug helpers below print through console.log, and vitest's default
 * reporter hides that for *passing* tests — so they need --reporter=verbose
 * or they look silently broken. `npm run test:trace` is DEBUG_PIPELINE with
 * the flag already set:
 *
 *   DEBUG_OUTPUT=1   npx vitest run --reporter=verbose test/gpx-integration.test.js
 *   DEBUG_PIPELINE=1 npx vitest run --reporter=verbose test/gpx-integration.test.js
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import { parseGpx } from '../src/gpx.ts';
import { detectClimbs } from '../src/climb-engine.ts';
import { score } from '../src/scoring.ts';
import { fixtures } from './fixtures/expected.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, 'fixtures');

// ─── Discovery helper ────────────────────────────────────────────────────────

/**
 * When DEBUG_OUTPUT=1, dump the raw detectClimbs result so you can
 * capture real values to fill into expected.js. Needs --reporter=verbose;
 * see the file header.
 */
function debugLog(file, climbs) {
  if (process.env.DEBUG_OUTPUT !== '1') return;

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`FILE: ${file}`);
  console.log(`climbCount: ${climbs.length}`);
  climbs.forEach((climb, i) => {
    console.log(`  climbs[${i}]:`);
    console.log(`    distanceKm:   ${(climb.distance / 1000).toFixed(3)}`);
    console.log(`    elevationM:   ${climb.elevation.toFixed(1)}`);
    console.log(`    avgGrade:     ${climb.avgGrade.toFixed(2)}%`);
    console.log(`    category:     ${climb.category}`);
    console.log(`    segmentCount: ${climb.segments.length}`);
  });
  console.log('═'.repeat(60));
}

/**
 * When DEBUG_PIPELINE=1, attach a sink that prints each ClimbDebugEvent on its
 * own line. Use this when investigating why a climb was detected, merged,
 * trimmed, or rejected. Independent of DEBUG_OUTPUT; needs --reporter=verbose,
 * so prefer `npm run test:trace`.
 *
 * This is the route-fixture renderer of the same event stream `climb-cli
 * --debug` emits as NDJSON — human-readable here, machine-readable there.
 */
function makePipelineSink(file) {
  if (process.env.DEBUG_PIPELINE !== '1') return undefined;
  let printedHeader = false;
  return (evt) => {
    if (!printedHeader) {
      console.log(`\n${'┄'.repeat(60)}`);
      console.log(`PIPELINE ${file}`);
      console.log('┄'.repeat(60));
      printedHeader = true;
    }
    const km = (v) => (v == null ? '—' : v.toFixed(2));
    const m = (v) => (v == null ? '—' : v.toFixed(0));
    switch (evt.stage) {
      case 'pipeline':
        console.log(
          `[pipeline] raw=${evt.rawPoints} resampled=${evt.resampled} interp=${evt.interpolated} smoothed=${evt.smoothed} segs=${evt.segments}`
        );
        break;
      case 'identify-candidate':
        console.log(
          `[ident-cand #${evt.index}] km${km(evt.startKm)}-${km(evt.endKm)}  dist=${m(evt.distanceM)}m  elev=${m(evt.elevationM)}m  rawGain=${m(evt.rawGainM)}m  avg=${evt.avgGradePct.toFixed(2)}%`
        );
        break;
      case 'identify-close':
        console.log(
          `[ident-close] reason=${evt.reason} atKm=${km(evt.atKm)} tailTrim=${evt.tailTrimGradePct}%`
        );
        break;
      case 'identify-reject':
        console.log(
          `[ident-reject] reason=${evt.reason} km${km(evt.startKm)}-${km(evt.endKm)}`
        );
        break;
      case 'merge-pair':
        console.log(
          `[merge ${evt.decision}] km${km(evt.prevStartKm)}-${km(evt.prevEndKm)} → km${km(evt.currStartKm)}-${km(evt.currEndKm)}  gap=${m(evt.gapM)}m (max ${m(evt.effectiveMaxGapM)}m)  valleyDrop=${m(evt.valleyDropM)}m (max ${m(evt.maxAllowedDropM)}m)  rawRise=${m(evt.combinedRawRiseM)}m coherent=${evt.coherentAscent} :: ${evt.reason}`
        );
        break;
      case 'trim':
        console.log(
          `[trim] km${km(evt.startKm)}-${km(evt.endKm)}  head-=${evt.droppedHeadSegs} tail-=${evt.droppedTailSegs}  remain=${m(evt.remainingDistanceM)}m  kept=${evt.kept}`
        );
        break;
      case 'measure':
        console.log(
          `[measure] km${km(evt.startKm)}-${km(evt.endKm)}  dist=${m(evt.distanceM)}m  avg=${evt.avgGradePct.toFixed(2)}%`
        );
        break;
    }
  };
}

// ─── Tolerance assertion ─────────────────────────────────────────────────────

function assertNear(actual, expected, tolerance, label) {
  expect(
    Math.abs(actual - expected),
    `${label}: expected ${expected} ± ${tolerance}, got ${actual}`
  ).toBeLessThanOrEqual(tolerance);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

if (fixtures.length === 0) {
  describe('gpx integration', () => {
    it.todo(
      'No fixtures defined — add .gpx files to test/fixtures/ and fill in test/fixtures/expected.js'
    );
  });
} else {
  describe.each(fixtures)('$file', ({ file, climbCount, scoringModel, climbs: expectedClimbs }) => {
    let detectedClimbs;
    let detectionResult;

    // Parse + detect once per fixture file
    try {
      const gpxContent = readFileSync(resolve(FIXTURES_DIR, file), 'utf-8');
      const elevationProfile = parseGpx(gpxContent).tuples;
      detectionResult = detectClimbs(elevationProfile, { debug: makePipelineSink(file) });
      // The engine measures every candidate now (#77), so the filter that used
      // to happen inside detection happens here — which keeps expected.js
      // meaning what it always meant: the climbs this model keeps.
      detectedClimbs = score(detectionResult, scoringModel ?? 'aso').filter(
        (climb) => climb.category !== null
      );
      debugLog(file, detectedClimbs);
    } catch (err) {
      it(`should load and parse ${file}`, () => {
        throw new Error(`Failed to load fixture: ${err.message}`);
      });
    }

    it(`detects ${climbCount} climb(s)`, () => {
      expect(detectedClimbs).toHaveLength(climbCount);
    });

    it('finds one candidate set, invariant across every scoring model', () => {
      // The evidence that scoring was never part of detection: the models
      // disagree substantially about how many of these are climbs (travny:
      // 3 / 5 / 1), and agree exactly on how many candidates there are.
      for (const model of ['aso', 'garmin', 'hiking']) {
        expect(score(detectionResult, model)).toHaveLength(detectionResult.climbs.length);
      }
    });

    it('measures every candidate whatever a model makes of it', () => {
      // The snap runs before scoring now, so a candidate no model would keep
      // still reaches its summit — it never did before (#77).
      for (const climb of detectionResult.climbs) {
        expect(climb.maxSustainedGradient).toBeGreaterThanOrEqual(0);
        expect(climb.endCoords).not.toBeNull();
      }
    });

    if (expectedClimbs) {
      expectedClimbs.forEach(({ distanceKm, elevationM, category, segmentCount }, idx) => {
        describe(`climbs[${idx}]`, () => {
          it('has correct distance', () => {
            assertNear(
              detectedClimbs[idx].distance / 1000,
              distanceKm.value,
              distanceKm.tolerance,
              'distanceKm'
            );
          });

          it('has correct elevation gain', () => {
            assertNear(
              detectedClimbs[idx].elevation,
              elevationM.value,
              elevationM.tolerance,
              'elevationM'
            );
          });

          it(`has category ${category}`, () => {
            expect(detectedClimbs[idx].category).toBe(category);
          });

          if (segmentCount !== undefined) {
            it(`has ${segmentCount} segments`, () => {
              expect(detectedClimbs[idx].segments).toHaveLength(segmentCount);
            });
          }
        });
      });
    }
  });
}
