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
  {
    file: 'bk.gpx',
    climbCount: 4,
    climbs: [
      {
        distanceKm: { value: 2.6, tolerance: 0.1 },
        elevationM: { value: 130, tolerance: 5 },
        category: '4',
        segmentCount: 73,
      },
      {
        distanceKm: { value: 1.1, tolerance: 0.1 },
        elevationM: { value: 65, tolerance: 5 },
        category: '4',
        segmentCount: 27,
      },
      {
        distanceKm: { value: 1.8, tolerance: 0.1 },
        elevationM: { value: 45, tolerance: 5 },
        category: '4',
        segmentCount: 72,
      },
      {
        distanceKm: { value: 6.2, tolerance: 0.1 },
        elevationM: { value: 310, tolerance: 10 },
        category: '2',
        segmentCount: 198,
      },
    ],
  },
  {
    file : 'ond_mal.gpx',
    climbCount: 2,
    climbs: [
      {
        distanceKm: { value: 8.8, tolerance: 0.1 },
        elevationM: { value: 400, tolerance: 10 },
        category: '2',
        segmentCount: 337,
      },
      {
        distanceKm: { value: 3.2, tolerance: 0.1 },
        elevationM: { value: 125, tolerance: 10 },
        category: '4',
        segmentCount: 96,
      },
    ],
  },
  {
    file: 'lh.gpx',
    climbCount: 1,
    climbs: [],
  }
];
