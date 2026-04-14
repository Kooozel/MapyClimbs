/**
 * map-geometry.ts — Pure geometric helpers for projecting geo-coordinates
 * onto the visible map canvas.
 *
 * Exported for testability. `getMapBounds` is the only function with a DOM
 * dependency; all others are pure.
 */

export interface MapBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Project a WGS-84 coordinate onto pixel space given the map centre and zoom.
 * Uses Web Mercator — the same projection as mapy.cz.
 */
export function mercatorToPixel(
  lat: number,
  lon: number,
  cLat: number,
  cLon: number,
  zoom: number,
  W: number,
  H: number
): { x: number; y: number } {
  const S = 256 * Math.pow(2, zoom);
  const mx = (d: number): number => ((d + 180) / 360) * S;
  const my = (d: number): number => {
    const s = Math.sin((d * Math.PI) / 180);
    return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * S;
  };
  return { x: W / 2 + mx(lon) - mx(cLon), y: H / 2 + my(lat) - my(cLat) };
}
