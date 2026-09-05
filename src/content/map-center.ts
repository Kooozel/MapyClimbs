/**
 * content/map-center.ts — Content-script half of click-to-center.
 *
 * Works out which coordinate the map should be centred on so that a climb lands
 * in the middle of the *visible* map, then hands it to the page-context listener
 * in `injected/map-center.ts`, which owns the actual map call.
 */

import type { Coords } from "climb-engine";
import { PageMessage, SIDEBAR_SELECTOR } from "../constants";
import { getMapContainer, viewportFromURL, visibleCenterOffset, worldSize } from "../map-geometry";

/**
 * Ask the page to centre the map on `coords`, keeping the current zoom.
 *
 * Returns false when there is nothing to do — no coordinates on the climb, or
 * the map/viewport cannot be resolved — so the caller can fall back to simply
 * highlighting the climb where it already is.
 */
export function requestMapCenter(coords: Coords | null, climbIndex: number): boolean {
  if (!coords) return false;

  const vp = viewportFromURL();
  const container = getMapContainer();
  if (!vp || !container) return false;

  // Shift the map centre east by whatever the sidebar hides, so `coords` ends up
  // in the middle of the visible strip rather than behind the panel.
  const sidebar = document.querySelector<HTMLElement>(SIDEBAR_SELECTOR);
  const dx = visibleCenterOffset(
    container.getBoundingClientRect(),
    sidebar?.getBoundingClientRect() ?? null
  );
  const lon = coords.lon - (dx * 360) / worldSize(vp.zoom);

  window.postMessage(
    { type: PageMessage.CenterMap, lat: coords.lat, lon, climbIndex },
    location.origin
  );
  return true;
}
