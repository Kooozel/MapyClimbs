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
        distanceKm: { value: 2.08, tolerance: 0.15 },
        elevationM: { value: 116, tolerance: 12 },
        category: '4',
      },
      {
        distanceKm: { value: 0.89, tolerance: 0.1 },
        elevationM: { value: 61, tolerance: 10 },
        category: '4',
      },
      {
        distanceKm: { value: 1.80, tolerance: 0.2 },
        elevationM: { value: 55, tolerance: 10 },
        category: '4',
      },
      {
        distanceKm: { value: 0.72, tolerance: 0.1 },
        elevationM: { value: 28, tolerance: 8 },
        category: '4',
      },
      {
        distanceKm: { value: 7.25, tolerance: 0.4 },
        elevationM: { value: 333, tolerance: 25 },
        category: '2',
      },
    ],
  },
  {
    file: 'ond_mal.gpx',
    climbCount: 2,
    climbs: [
      {
        distanceKm: { value: 5.90, tolerance: 0.3 },
        elevationM: { value: 338, tolerance: 25 },
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
        distanceKm: { value: 12.95, tolerance: 0.3 },
        elevationM: { value: 872, tolerance: 25 },
        category: '1',
      },
    ],
  },
  {
    file: 'hukvaldy.gpx',
    climbCount: 8,
    climbs: [
      {
        distanceKm: { value: 0.37, tolerance: 0.08 },
        elevationM: { value: 14, tolerance: 6 },
        category: 'uncategorized',
      },
      {
        distanceKm: { value: 1.09, tolerance: 0.15 },
        elevationM: { value: 62, tolerance: 10 },
        category: '4',
      },
      {
        distanceKm: { value: 0.61, tolerance: 0.1 },
        elevationM: { value: 49, tolerance: 8 },
        category: '4',
      },
      {
        distanceKm: { value: 0.43, tolerance: 0.08 },
        elevationM: { value: 23, tolerance: 7 },
        category: '4',
      },
      {
        distanceKm: { value: 0.35, tolerance: 0.08 },
        elevationM: { value: 33, tolerance: 8 },
        category: '4',
      },
      {
        distanceKm: { value: 0.64, tolerance: 0.1 },
        elevationM: { value: 45, tolerance: 8 },
        category: '4',
      },
      {
        distanceKm: { value: 4.11, tolerance: 0.25 },
        elevationM: { value: 228, tolerance: 20 },
        category: '3',
      },
      {
        distanceKm: { value: 0.49, tolerance: 0.08 },
        elevationM: { value: 32, tolerance: 8 },
        category: '4',
      },
    ],
  },
  {
    file: 'grun.gpx',
    climbCount: 4,
    climbs: [
      {
        distanceKm: { value: 2.08, tolerance: 0.15 },
        elevationM: { value: 116, tolerance: 12 },
        category: '4',
      },
      {
        distanceKm: { value: 0.89, tolerance: 0.1 },
        elevationM: { value: 61, tolerance: 10 },
        category: '4',
      },
      {
        distanceKm: { value: 1.80, tolerance: 0.2 },
        elevationM: { value: 55, tolerance: 10 },
        category: '4',
      },
      {
        distanceKm: { value: 3.87, tolerance: 0.3 },
        elevationM: { value: 270, tolerance: 25 },
        category: '2',
      },
    ],
  },
  {
    file: 'b7.gpx',
    scoringModel: 'hiking',
    climbCount: 10,
    climbs: [
      {
        distanceKm: { value: 4.69, tolerance: 0.3 },
        elevationM: { value: 650, tolerance: 30 },
        category: '3',
      },
      {
        distanceKm: { value: 1.57, tolerance: 0.15 },
        elevationM: { value: 404, tolerance: 25 },
        category: '3',
      },
      {
        distanceKm: { value: 4.76, tolerance: 0.3 },
        elevationM: { value: 562, tolerance: 30 },
        category: '3',
      },
      {
        distanceKm: { value: 9.03, tolerance: 0.5 },
        elevationM: { value: 835, tolerance: 40 },
        category: '3',
      },
      {
        distanceKm: { value: 7.78, tolerance: 0.4 },
        elevationM: { value: 850, tolerance: 40 },
        category: '3',
      },
      {
        distanceKm: { value: 7.79, tolerance: 0.4 },
        elevationM: { value: 681, tolerance: 35 },
        category: '3',
      },
      {
        distanceKm: { value: 0.52, tolerance: 0.08 },
        elevationM: { value: 66, tolerance: 10 },
        category: 'uncategorized',
      },
      {
        distanceKm: { value: 4.26, tolerance: 0.3 },
        elevationM: { value: 518, tolerance: 30 },
        category: '3',
      },
      {
        distanceKm: { value: 2.72, tolerance: 0.2 },
        elevationM: { value: 271, tolerance: 20 },
        category: '4',
      },
      {
        distanceKm: { value: 2.14, tolerance: 0.2 },
        elevationM: { value: 348, tolerance: 20 },
        category: '4',
      },
    ],
  },
];
