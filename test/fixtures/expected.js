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
    climbCount: 5,
    climbs: [
      {
        distanceKm: { value: 2.08, tolerance: 0.2 },
        elevationM: { value: 116, tolerance: 15 },
        category: '4',
      },
      {
        distanceKm: { value: 0.89, tolerance: 0.15 },
        elevationM: { value: 61, tolerance: 10 },
        category: '4',
      },
      {
        distanceKm: { value: 1.75, tolerance: 0.2 },
        elevationM: { value: 52, tolerance: 10 },
        category: '4',
      },
      {
        distanceKm: { value: 0.72, tolerance: 0.15 },
        elevationM: { value: 28, tolerance: 10 },
        category: '4',
      },
      {
        distanceKm: { value: 7.25, tolerance: 0.5 },
        elevationM: { value: 333, tolerance: 30 },
        category: '2',
      },
    ],
  },
  {
    file: 'ond_mal.gpx',
    climbCount: 3,
    climbs: [
      {
        distanceKm: { value: 5.82, tolerance: 0.3 },
        elevationM: { value: 335, tolerance: 25 },
        category: '2',
      },
      {
        distanceKm: { value: 3.11, tolerance: 0.25 },
        elevationM: { value: 122, tolerance: 15 },
        category: '4',
      },
      {
        distanceKm: { value: 0.11, tolerance: 0.05 },
        elevationM: { value: 7, tolerance: 5 },
        category: 'uncategorized',
      },
    ],
  },
  {
    file: 'lh.gpx',
    climbCount: 1,
    climbs: [
      {
        distanceKm: { value: 12.95, tolerance: 0.3 },
        elevationM: { value: 872, tolerance: 25 },
        category: '1',
      },
    ],
  },
  {
    file: 'hukvaldy.gpx',
    climbCount: 12,
    climbs: [
      {
        distanceKm: { value: 0.37, tolerance: 0.1 },
        elevationM: { value: 14, tolerance: 5 },
        category: 'uncategorized',
      },
      {
        distanceKm: { value: 0.29, tolerance: 0.1 },
        elevationM: { value: 12, tolerance: 5 },
        category: 'uncategorized',
      },
      {
        distanceKm: { value: 1.04, tolerance: 0.15 },
        elevationM: { value: 59, tolerance: 15 },
        category: '4',
      },
      {
        distanceKm: { value: 0.15, tolerance: 0.07 },
        elevationM: { value: 11, tolerance: 5 },
        category: '4',
      },
      {
        distanceKm: { value: 0.16, tolerance: 0.07 },
        elevationM: { value: 7, tolerance: 5 },
        category: 'uncategorized',
      },
      {
        distanceKm: { value: 1.73, tolerance: 0.2 },
        elevationM: { value: 74, tolerance: 15 },
        category: '4',
      },
      {
        distanceKm: { value: 0.37, tolerance: 0.1 },
        elevationM: { value: 21, tolerance: 8 },
        category: '4',
      },
      {
        distanceKm: { value: 0.35, tolerance: 0.1 },
        elevationM: { value: 33, tolerance: 10 },
        category: '4',
      },
      {
        distanceKm: { value: 0.64, tolerance: 0.1 },
        elevationM: { value: 45, tolerance: 15 },
        category: '4',
      },
      {
        distanceKm: { value: 4.11, tolerance: 0.25 },
        elevationM: { value: 228, tolerance: 25 },
        category: '3',
      },
      {
        distanceKm: { value: 0.49, tolerance: 0.1 },
        elevationM: { value: 32, tolerance: 10 },
        category: '4',
      },
      {
        distanceKm: { value: 0.21, tolerance: 0.07 },
        elevationM: { value: 16, tolerance: 7 },
        category: '4',
      },
    ],
  },
  {
    file: 'grun.gpx',
    climbCount: 4,
    climbs: [
      {
        distanceKm: { value: 2.08, tolerance: 0.2 },
        elevationM: { value: 116, tolerance: 15 },
        category: '4',
      },
      {
        distanceKm: { value: 0.89, tolerance: 0.15 },
        elevationM: { value: 61, tolerance: 10 },
        category: '4',
      },
      {
        distanceKm: { value: 1.75, tolerance: 0.2 },
        elevationM: { value: 52, tolerance: 10 },
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
