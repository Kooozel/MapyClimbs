// @vitest-environment happy-dom
/**
 * test/gpx-integration.test.js
 *
 * Integration tests: real GPX files → parseGPX → detectClimbs → assertions.
 *
 * SETUP:
 *   1. npm install -D happy-dom  (already done)
 *   2. Drop .gpx files into test/fixtures/
 *   3. Fill expected values into test/fixtures/expected.js
 *      (Discovery run: DEBUG_OUTPUT=1 npx vitest run test/gpx-integration.test.js)
 *
 * The @vitest-environment happy-dom annotation above provides DOMParser,
 * required by parseGPX, without affecting other test files.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import { parseGPX } from '../src/gpx-parser.ts';
import { detectClimbs } from '../src/climb-engine.ts';
import { fixtures } from './fixtures/expected.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, 'fixtures');

// ─── Discovery helper ────────────────────────────────────────────────────────

/**
 * When DEBUG_OUTPUT=1, dump the raw detectClimbs result so you can
 * capture real values to fill into expected.js.
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
  describe.each(fixtures)('$file', ({ file, climbCount, climbs: expectedClimbs }) => {
    let detectedClimbs;

    // Parse + detect once per fixture file
    try {
      const gpxContent = readFileSync(resolve(FIXTURES_DIR, file), 'utf-8');
      const elevationProfile = parseGPX(gpxContent);
      detectedClimbs = detectClimbs(elevationProfile);
      debugLog(file, detectedClimbs);
    } catch (err) {
      it(`should load and parse ${file}`, () => {
        throw new Error(`Failed to load fixture: ${err.message}`);
      });
    }

    it(`detects ${climbCount} climb(s)`, () => {
      expect(detectedClimbs).toHaveLength(climbCount);
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
