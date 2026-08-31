/**
 * map-geometry.ts — Pure geometric helpers for projecting geo-coordinates
 * onto the visible map canvas.
 *
 * Exported for testability. `getMapContainer` is the only function with a DOM
 * dependency; all others are pure.
 */

import { MAP_CONTAINER_SELECTORS } from "./constants";

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

/**
 * Resolves the element that holds the visible map.
 *
 * Returns the first `MAP_CONTAINER_SELECTORS` candidate with a non-zero box:
 * `#map` on the raster build, `#scene` on the vector build where `#map` is
 * hidden. Returns null while the map is still being created and every candidate
 * is still zero-sized.
 */
export function getMapContainer(): HTMLElement | null {
  for (const selector of MAP_CONTAINER_SELECTORS) {
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return el;
  }
  return null;
}
