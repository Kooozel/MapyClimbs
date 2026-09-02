/**
 * geo.ts — The one great-circle distance used on the distance axis.
 *
 * Both GPX readers accumulate distance with this function: src/gpx-parser.ts
 * (browser, DOMParser) and src/cli/garmin-gpx.ts (Node, keeps <time> and heart
 * rate). The two readers are deliberately separate — each needs an API the other
 * environment lacks — but they must agree point-for-point on distance, because
 * test/garmin-gpx.test.js asserts their tuples are *exactly* equal and every
 * downstream figure (gradients, climb lengths, VAM) is read off that axis.
 *
 * Its own module rather than a home in either reader: neither can import the
 * other, and a copy in each is what left the invariant resting on a test.
 *
 * No DOM or Node dependencies — pure arithmetic, safe in either bundle.
 */

/** Mean Earth radius in metres, as used by both GPX readers. */
const EARTH_RADIUS_M = 6371000;

/**
 * Great-circle distance between two WGS84 coordinates, in metres.
 *
 * Haversine rather than Vincenty: the error over a trackpoint gap of tens of
 * metres is far below GPS noise, and it stays dependency-free.
 */
export function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
