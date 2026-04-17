/**
 * test/fixtures/expected.js
 *
 * Expected climb-detection results for each GPX fixture file.
 *
 * HOW TO FILL THIS IN:
 *   1. Drop your .gpx files into test/fixtures/
 *   2. Run: DEBUG_OUTPUT=1 npx vitest run test/gpx-integration.test.js
 *   3. Inspect the console output for each file's actual detectClimbs() result.
 *   4. Fill in the entries below with the real values.
 *   5. Re-run: npm test — all assertions should be green.
 *
 * FIELDS per entry:
 *   file        — filename only (must exist in test/fixtures/)
 *   climbCount  — total climbs detectClimbs() returns
 *   climbs      — asserted climbs in order (index matches climbs[] array)
 *     .distanceKm — { value, tolerance } in kilometres (e.g. 0.5 km)
 *     .elevationM — { value, tolerance } in metres (e.g. 50 m)
 *     .category   — 'HC' | '1' | '2' | '3' | '4'
 *     .segmentCount — number of segments[] in the climb object
 *
 * NOTE: distanceKm and elevationM use tolerance-based assertions to absorb
 *       GPS float noise. Tighten tolerances for stricter regression coverage.
 */

export const fixtures = [
  // ── Example entry (replace/extend with real data) ─────────────────────────
  // {
  //   file: 'alpe-dhuez.gpx',
  //   climbCount: 1,
  //   climbs: [
  //     {
  //       distanceKm: { value: 13.8, tolerance: 0.5 },
  //       elevationM: { value: 1071, tolerance: 50 },
  //       category: '1',
  //       segmentCount: 8,
  //     },
  //   ],
  // },
];
