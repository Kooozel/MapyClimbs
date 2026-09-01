/**
 * map-geometry.ts — Pure geometric helpers for projecting geo-coordinates
 * onto the visible map canvas.
 *
 * Exported for testability. `getMapContainer` and `viewportFromURL` are the only
 * functions that read the environment (DOM / `location`); all others are pure.
 */

import { MAP_CONTAINER_SELECTORS } from "./constants";

export interface MapBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Map centre and zoom as mapy.com publishes them in the query string. */
export interface Viewport {
  lat: number;
  lon: number;
  zoom: number;
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

/** Width in pixels of the whole world at `zoom`, on mapy.com's 256 px tile grid. */
export function worldSize(zoom: number): number {
  return 256 * Math.pow(2, zoom);
}

/**
 * Horizontal pixel offset from the map container's centre to the centre of the
 * part of it the user can actually see.
 *
 * Mapy.com currently lays the sidebar out *beside* the map (`#scene` ends where
 * `#layout-body` starts), so this is 0. It stops being 0 the moment a narrower
 * window — or a future layout — floats the sidebar over the map, and without it
 * anything we centre would sit behind the panel. Positive means "right of centre".
 */
export function visibleCenterOffset(map: MapBounds, sidebar: MapBounds | null): number {
  if (!sidebar || sidebar.width <= 0) return 0;

  const overlap =
    Math.min(map.left + map.width, sidebar.left + sidebar.width) - Math.max(map.left, sidebar.left);
  if (overlap <= 0) return 0;

  const coversRightHalf = sidebar.left + sidebar.width / 2 >= map.left + map.width / 2;
  return (coversRightHalf ? -overlap : overlap) / 2;
}

/**
 * Reads the live map viewport from the page URL.
 *
 * mapy.com keeps `x` (lon), `y` (lat) and `z` (zoom) in the query string in sync
 * with the map on both builds, which makes the URL the one viewport source both
 * the overlay and the centring code can agree on.
 */
export function viewportFromURL(): Viewport | null {
  const p = new URLSearchParams(location.search);
  const lon = parseFloat(p.get("x") ?? "");
  const lat = parseFloat(p.get("y") ?? "");
  // parseFloat, not parseInt: the vector build zooms continuously and writes
  // fractional levels (e.g. `z=13.248`). Truncating one misplaces the overlay by
  // up to ~110 px at the edges of the viewport.
  const zoom = parseFloat(p.get("z") ?? "");
  if (isNaN(lat) || isNaN(lon) || isNaN(zoom)) return null;
  return { lat, lon, zoom };
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
