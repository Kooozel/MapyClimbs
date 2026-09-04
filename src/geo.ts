/**
 * geo.ts — The one great-circle distance used on the distance axis.
 *
 * gpx.ts accumulates cumulative distance with this function, and it is the
 * distance axis every downstream figure is read off — gradients, climb lengths,
 * VAM — so the whole pipeline agrees about how far apart two trackpoints are by
 * construction rather than by convention.
 *
 * Its own module rather than a home in the reader: the climb engine reads that
 * axis too, and neither side should have to import the other to share one
 * formula. A copy in each is what once left the invariant resting on a test.
 *
 * No DOM or Node dependencies — pure arithmetic, safe in either bundle.
 */

/** Mean Earth radius in metres. */
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
