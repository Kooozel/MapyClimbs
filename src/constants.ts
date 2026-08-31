/**
 * constants.ts — Global constants shared across content scripts and entrypoints.
 *
 * Values that appear in only one file live as local constants in that file.
 * This module holds values referenced from two or more files.
 */

// ── URL match patterns ────────────────────────────────────────────────────────

/** Mapy.com/mapy.cz URL match patterns. Shared by both content-script entrypoints. */
export const MAPY_MATCHES = [
  "https://mapy.cz/*",
  "https://*.mapy.cz/*",
  "https://mapy.com/*",
  "https://*.mapy.com/*",
] as const;

// ── Map container ─────────────────────────────────────────────────────────────

/**
 * Candidate selectors for the element that holds the visible map, in priority
 * order.
 *
 * The raster build draws into `#map`. The WASM/vector build leaves `#map` in the
 * DOM but hides it (`display:none`, 0x0) and renders into `#scene` instead, so a
 * plain `#map` lookup silently yields a zero-sized box there. `getMapContainer`
 * walks this list and takes the first candidate that actually has a size, which
 * keeps one build working on both variants.
 */
export const MAP_CONTAINER_SELECTORS = ["#map", "#scene"] as const;

/**
 * The mapy.com sidebar that holds the route planner (and our panel).
 * Used only to work out how much of the map it covers — see `visibleCenterOffset`.
 */
export const SIDEBAR_SELECTOR = "#layout-body";

// ── Page-context messages ─────────────────────────────────────────────────────

/**
 * `postMessage` types exchanged between the content scripts and the script
 * injected into page context (`gpx-interceptor-injected.ts`). Declared here
 * because both sides of each hop live in different bundles.
 */
export const PageMessage = {
  /** Content → page: centre the map on `{ lat, lon }` for `climbIndex`. */
  CenterMap: "CLIMB_CENTER_MAP",
  /** Page → content: the map has been centred and the URL is up to date. */
  CenterMapDone: "CLIMB_CENTER_MAP_DONE",
} as const;

// ── DOM element IDs ───────────────────────────────────────────────────────────

/** Stable DOM element IDs used across multiple content scripts. */
export const ElementId = {
  /** The "Analyze climbs" trigger button injected into route-planner toolbar. */
  Button: "climb-inject-button",
  /** The sidebar analysis panel. */
  Panel: "climb-inject-panel",
  /** The fixed-position SVG overlay that renders climb pins/routes on the map. */
  MarkerOverlay: "climb-marker-overlay",
  /** The inline SVG element inside the overlay that holds polyline elements. */
  RouteSvg: "climb-route-svg",
  /** Fullscreen overlay shown while route GPX is being captured and analyzed. */
  Loader: "cip-loader",
} as const;

// ── CSS class names ───────────────────────────────────────────────────────────

/** CSS class names used across multiple content scripts. */
export const CssClass = {
  /** Circular pin marker positioned over the map for each detected climb. */
  Pin: "climb-pin",
  /** Blurred glow polyline drawn behind the sharp route line. */
  RouteGlow: "climb-route-glow",
  /** Sharp foreground polyline representing the climb route. */
  RouteLine: "climb-route-line",
} as const;
