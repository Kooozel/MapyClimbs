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
 *     .category   — 'HC' | '1' | '2' | '3' | '4' | 'uncategorized'
 *     .segmentCount — number of segments[] in the climb object
 *
 * NOTE: distanceKm and elevationM use tolerance-based assertions to absorb
 *       GPS float noise. Tighten tolerances for stricter regression coverage.
 */

export const fixtures = [
  {
    file: 'bk.gpx',
    climbCount: 5,
    climbs: [
      {
        distanceKm: { value: 2.44, tolerance: 0.2 },
        elevationM: { value: 128, tolerance: 15 },
        category: '4',
      },
      {
        distanceKm: { value: 1.09, tolerance: 0.15 },
        elevationM: { value: 65, tolerance: 10 },
        category: '4',
      },
      {
        distanceKm: { value: 0.49, tolerance: 0.1 },
        elevationM: { value: 14, tolerance: 5 },
        category: 'uncategorized',
      },
      {
        distanceKm: { value: 1.94, tolerance: 0.2 },
        elevationM: { value: 56, tolerance: 10 },
        category: '4',
      },
      {
        distanceKm: { value: 9.81, tolerance: 0.5 },
        elevationM: { value: 373, tolerance: 30 },
        category: '3',
      },
    ],
  },
  {
    file: 'ond_mal.gpx',
    climbCount: 2,
    climbs: [
      {
        distanceKm: { value: 6.66, tolerance: 0.3 },
        elevationM: { value: 359, tolerance: 25 },
        category: '2',
      },
      {
        distanceKm: { value: 3.22, tolerance: 0.25 },
        elevationM: { value: 124, tolerance: 15 },
        category: '4',
      },
    ],
  },
  {
    file: 'lh.gpx',
    climbCount: 1,
    climbs: [
      {
        distanceKm: { value: 12.99, tolerance: 0.3 },
        elevationM: { value: 873, tolerance: 25 },
        category: '1',
      },
    ],
  },
  {
    file: 'hukvaldy.gpx',
    climbCount: 8,
    climbs: [
      {
        distanceKm: { value: 0.48, tolerance: 0.1 },
        elevationM: { value: 18, tolerance: 7 },
        category: 'uncategorized',
      },
      {
        distanceKm: { value: 1.07, tolerance: 0.15 },
        elevationM: { value: 61, tolerance: 10 },
        category: '4',
      },
      {
        distanceKm: { value: 1.84, tolerance: 0.2 },
        elevationM: { value: 78, tolerance: 12 },
        category: '4',
      },
      {
        distanceKm: { value: 0.49, tolerance: 0.1 },
        elevationM: { value: 23, tolerance: 8 },
        category: '4',
      },
      {
        distanceKm: { value: 0.66, tolerance: 0.1 },
        elevationM: { value: 40, tolerance: 10 },
        category: '4',
      },
      {
        distanceKm: { value: 0.68, tolerance: 0.1 },
        elevationM: { value: 46, tolerance: 10 },
        category: '4',
      },
      {
        distanceKm: { value: 4.21, tolerance: 0.25 },
        elevationM: { value: 231, tolerance: 25 },
        category: '3',
      },
      {
        distanceKm: { value: 0.56, tolerance: 0.1 },
        elevationM: { value: 33, tolerance: 10 },
        category: '4',
      },
    ],
  },
  {
    file: 'grun.gpx',
    climbCount: 5,
    climbs: [
      {
        distanceKm: { value: 2.44, tolerance: 0.2 },
        elevationM: { value: 128, tolerance: 15 },
        category: '4',
      },
      {
        distanceKm: { value: 1.09, tolerance: 0.15 },
        elevationM: { value: 65, tolerance: 10 },
        category: '4',
      },
      {
        distanceKm: { value: 0.49, tolerance: 0.1 },
        elevationM: { value: 14, tolerance: 5 },
        category: 'uncategorized',
      },
      {
        distanceKm: { value: 1.94, tolerance: 0.2 },
        elevationM: { value: 56, tolerance: 10 },
        category: '4',
      },
      {
        distanceKm: { value: 3.87, tolerance: 0.3 },
        elevationM: { value: 270, tolerance: 25 },
        category: '2',
      },
    ],
  },
];
