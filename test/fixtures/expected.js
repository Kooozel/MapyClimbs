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
        distanceKm: { value: 2.36, tolerance: 0.15 },
        elevationM: { value: 125, tolerance: 15 },
        category: '4',
      },
      {
        distanceKm: { value: 1.08, tolerance: 0.15 },
        elevationM: { value: 65, tolerance: 10 },
        category: '4',
      },
      {
        distanceKm: { value: 1.95, tolerance: 0.15 },
        elevationM: { value: 53, tolerance: 10 },
        category: '4',
      },
      {
        distanceKm: { value: 0.90, tolerance: 0.15 },
        elevationM: { value: 32, tolerance: 10 },
        category: '4',
      },
      {
        distanceKm: { value: 5.00, tolerance: 0.2 },
        elevationM: { value: 274, tolerance: 20 },
        category: '3',
      },
    ],
  },
  {
    file: 'ond_mal.gpx',
    climbCount: 2,
    climbs: [
      {
        distanceKm: { value: 6.90, tolerance: 0.2 },
        elevationM: { value: 363, tolerance: 20 },
        category: '2',
      },
      {
        distanceKm: { value: 3.23, tolerance: 0.15 },
        elevationM: { value: 123, tolerance: 15 },
        category: '4',
      },
    ],
  },
  {
    file: 'lh.gpx',
    climbCount: 1,
    climbs: [
      {
        distanceKm: { value: 13.0, tolerance: 0.3 },
        elevationM: { value: 871, tolerance: 25 },
        category: '1',
      },
    ],
  },
  {
    file: 'hukvaldy.gpx',
    climbCount: 6,
    climbs: [
      {
        distanceKm: { value: 0.88, tolerance: 0.15 },
        elevationM: { value: 54, tolerance: 15 },
        category: '4',
      },
      {
        distanceKm: { value: 0.55, tolerance: 0.1 },
        elevationM: { value: 46, tolerance: 15 },
        category: '4',
      },
      {
        distanceKm: { value: 0.55, tolerance: 0.1 },
        elevationM: { value: 36, tolerance: 10 },
        category: '4',
      },
      {
        distanceKm: { value: 0.68, tolerance: 0.1 },
        elevationM: { value: 47, tolerance: 15 },
        category: '4',
      },
      {
        distanceKm: { value: 4.31, tolerance: 0.2 },
        elevationM: { value: 233, tolerance: 20 },
        category: '3',
      },
      {
        distanceKm: { value: 0.71, tolerance: 0.15 },
        elevationM: { value: 33, tolerance: 10 },
        category: '4',
      },
    ],
  },
];
