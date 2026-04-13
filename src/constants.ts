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
