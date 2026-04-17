/**
 * content/route-highlight.ts — SVG route overlay with per-zone gradient colors.
 *
 * Each climb's route is drawn as:
 *   1. One blurred glow polyline (single category color, behind everything).
 *   2. N sharp polylines — one per contiguous gradient color zone — that animate
 *      in sequence from climb start (bottom) to summit, changing color as the
 *      road steepens. Colors match the chart elevation profile exactly.
 *
 * Animation: every zone draws its portion in `(zoneLength / totalLength) * ROUTE_ANIM_MS`
 * starting at `(zoneStartOffset / totalLength) * ROUTE_ANIM_MS` delay, so all zones
 * finish simultaneously at exactly ROUTE_ANIM_MS.
 *
 * Future zoom-dependent zone filtering: pass a `ZoneFilterFn` to `createRouteSvg`.
 * The filter receives (zones, totalDistance, zoom) and returns a filtered/merged zone
 * array.  See `ZoneFilterFn` and `mergeShortZones` in ../gradient-zones.
 */

import type { Climb, Segment } from "../types";
import { CATEGORY_COLOR } from "./category";
import { ElementId, CssClass } from "../constants";
import { mercatorToPixel } from "../map-geometry";
import { type GradientZone, type ZoneFilterFn, buildClimbZones } from "../gradient-zones";

export type { ZoneFilterFn };

// ── Constants ─────────────────────────────────────────────────────────────────

const GLOW_FILTER_ID = "climb-glow-filter";
const GLOW_STD_DEV = 4;
const GLOW_STROKE_WIDTH = 10;
const GLOW_OPACITY = 0.45;
const LINE_STROKE_WIDTH = 5;
const LINE_OPACITY = 0.92;
/** Duration (ms) of the full route polyline draw animation. */
const ROUTE_ANIM_MS = 900;

/** Pending zone-start timeouts keyed by climb index. Cleared on hide. */
const _pendingTimers = new Map<number, ReturnType<typeof setTimeout>[]>();

// ── Types ─────────────────────────────────────────────────────────────────────

interface Viewport {
  lat: number;
  lon: number;
  zoom: number;
}

interface ZonePolyline {
  color: string;
  points: { x: number; y: number }[];
  /** Fraction [0, 1] of total climb distance where this zone starts. */
  startRatio: number;
  /** Fraction [0, 1] of total climb distance where this zone ends. */
  endRatio: number;
}

// ── Zone building ─────────────────────────────────────────────────────────────

interface GeoPoint {
  x: number;
  y: number;
  /** Cumulative distance from climb start (0-based, matching buildProfilePoints). */
  distance: number;
}

/**
 * Collects pixel coords for every segment start/end point in the climb.
 * Distance is cumulative from 0 — matching the coordinate system in gradient-zones.ts.
 * Result is shared by both glow and zone-polyline construction to avoid double iteration.
 */
function buildGeoPoints(segments: Segment[], vp: Viewport, mb: DOMRect): GeoPoint[] {
  const pts: GeoPoint[] = [];
  let cumulDist = 0;
  for (const seg of segments) {
    if (seg.startLat != null && seg.startLon != null) {
      const p = mercatorToPixel(
        seg.startLat,
        seg.startLon,
        vp.lat,
        vp.lon,
        vp.zoom,
        mb.width,
        mb.height
      );
      pts.push({ x: Math.round(p.x), y: Math.round(p.y), distance: cumulDist });
    }
    cumulDist += seg.distance;
  }
  const lastSeg = segments[segments.length - 1];
  if (lastSeg && lastSeg.endLat != null && lastSeg.endLon != null) {
    const p = mercatorToPixel(
      lastSeg.endLat,
      lastSeg.endLon,
      vp.lat,
      vp.lon,
      vp.zoom,
      mb.width,
      mb.height
    );
    pts.push({ x: Math.round(p.x), y: Math.round(p.y), distance: cumulDist });
  }
  return pts;
}

/**
 * Maps distance-space gradient zones onto pixel-coordinate polylines.
 *
 * Each geo-segment's midpoint distance determines its color zone.
 * Consecutive same-color segments are merged; adjacent zone polylines share
 * a bridge point so lines connect seamlessly.
 */
function buildZonePolylines(
  geoPts: GeoPoint[],
  distZones: GradientZone[],
  totalDistance: number
): ZonePolyline[] {
  if (geoPts.length < 2 || distZones.length === 0) return [];

  // Assign each geo segment a color via midpoint lookup — avoids fp boundary issues.
  const segColors: string[] = [];
  for (let i = 0; i < geoPts.length - 1; i++) {
    const mid = (geoPts[i].distance + geoPts[i + 1].distance) / 2;
    const zone =
      distZones.find((dz) => mid >= dz.start && mid < dz.end) ?? distZones[distZones.length - 1];
    segColors.push(zone.color);
  }

  // Merge consecutive same-color segments into zone polylines.
  const zones: ZonePolyline[] = [];
  let si = 0;
  while (si < segColors.length) {
    const color = segColors[si];
    let end = si + 1;
    while (end < segColors.length && segColors[end] === color) end++;

    const pts = geoPts.slice(si, end + 1).map(({ x, y }) => ({ x, y }));

    // Bridge: prepend last point of previous zone so lines connect seamlessly.
    if (zones.length > 0) {
      const prev = zones[zones.length - 1];
      pts.unshift(prev.points[prev.points.length - 1]);
    }

    zones.push({
      color,
      points: pts,
      startRatio: geoPts[si].distance / totalDistance,
      endRatio: geoPts[end].distance / totalDistance,
    });
    si = end;
  }

  return zones;
}

// ── SVG helpers ───────────────────────────────────────────────────────────────

function buildGlowFilter(svg: SVGSVGElement): void {
  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  const filter = document.createElementNS("http://www.w3.org/2000/svg", "filter");
  filter.id = GLOW_FILTER_ID;
  filter.setAttribute("x", "-50%");
  filter.setAttribute("y", "-50%");
  filter.setAttribute("width", "200%");
  filter.setAttribute("height", "200%");
  const blur = document.createElementNS("http://www.w3.org/2000/svg", "feGaussianBlur");
  blur.setAttribute("in", "SourceGraphic");
  blur.setAttribute("stdDeviation", String(GLOW_STD_DEV));
  filter.appendChild(blur);
  defs.appendChild(filter);
  svg.appendChild(defs);
}

function makePolyline(pointsStr: string): SVGPolylineElement {
  const el = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  el.setAttribute("points", pointsStr);
  el.setAttribute("fill", "none");
  el.setAttribute("stroke-linecap", "round");
  el.setAttribute("stroke-linejoin", "round");
  return el;
}

function pointsToStr(points: { x: number; y: number }[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(" ");
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Builds the SVG overlay with glow + gradient-zone route polylines for all climbs.
 * Polylines start hidden; call `showClimbRoute` / `hideClimbRoute` to animate them.
 *
 * @param zoneFilter — optional zoom-aware filter applied to gradient zones before
 *   mapping them to polylines.  `undefined` uses zones as-is (current behaviour).
 *   Signature: `(zones, totalDistance, zoom) => GradientZone[]`.
 */
export function createRouteSvg(
  climbs: Climb[],
  vp: Viewport,
  mb: DOMRect,
  zoneFilter?: ZoneFilterFn
): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.id = ElementId.RouteSvg;
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  svg.style.cssText =
    "position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:hidden;";

  buildGlowFilter(svg);

  climbs.forEach((climb, i) => {
    const categoryColor = CATEGORY_COLOR[climb.category];
    const totalDistance = climb.distance || 1;

    // Build geo points once — shared by glow (all pts) and zone polylines (midpoint lookup).
    const geoPts = buildGeoPoints(climb.segments, vp, mb);
    if (geoPts.length < 2) return;

    // ── Glow (single category color, blurred) ──────────────────────────────
    const glow = makePolyline(pointsToStr(geoPts));
    glow.classList.add(CssClass.RouteGlow);
    glow.dataset.climbIndex = String(i);
    glow.setAttribute("stroke", categoryColor);
    glow.setAttribute("stroke-width", String(GLOW_STROKE_WIDTH));
    glow.setAttribute("opacity", String(GLOW_OPACITY));
    glow.setAttribute("filter", `url(#${GLOW_FILTER_ID})`);
    glow.style.visibility = "hidden";
    svg.appendChild(glow);

    // ── Gradient zone polylines ────────────────────────────────────────────
    const distZones = buildClimbZones(climb.segments, totalDistance, zoneFilter, vp.zoom);
    const zones = buildZonePolylines(geoPts, distZones, totalDistance);
    zones.forEach((zone) => {
      const line = makePolyline(pointsToStr(zone.points));
      line.classList.add(CssClass.RouteLine);
      line.dataset.climbIndex = String(i);
      line.dataset.startRatio = String(zone.startRatio);
      line.dataset.endRatio = String(zone.endRatio);
      line.setAttribute("stroke", zone.color);
      line.setAttribute("stroke-width", String(LINE_STROKE_WIDTH));
      line.setAttribute("opacity", String(LINE_OPACITY));
      line.style.visibility = "hidden";
      svg.appendChild(line);
    });
  });

  // Pre-compute dash lengths after elements are created (before DOM insertion callers handle this)
  return svg;
}

/**
 * Pre-computes `strokeDasharray` / `strokeDashoffset` for all route polylines.
 * Must be called after the SVG is appended to the DOM (needs layout for `getTotalLength`).
 */
export function initRouteDashLengths(svg: SVGSVGElement): void {
  // Only line zones need dash animation; glow is shown as a static halo.
  svg.querySelectorAll<SVGGeometryElement>(`polyline.${CssClass.RouteLine}`).forEach((line) => {
    const len = line.getTotalLength();
    line.style.strokeDasharray = String(len);
    line.style.strokeDashoffset = String(len);
  });
}

/**
 * Shows and animates the route for climb at `index`.
 * Zone lines draw bottom→summit, each in proportion to its share of total distance,
 * staggered so all finish at exactly ROUTE_ANIM_MS.
 */
export function showClimbRoute(index: number): void {
  const svg = document.getElementById(ElementId.RouteSvg) as SVGSVGElement | null;
  if (!svg) return;

  // Glow fades in over the full animation duration — never reveals full path shape prematurely
  const glow = svg.querySelector<SVGElement>(
    `polyline.${CssClass.RouteGlow}[data-climb-index="${index}"]`
  );
  if (glow) {
    glow.style.visibility = "visible";
    glow.animate([{ opacity: "0" }, { opacity: String(GLOW_OPACITY) }], {
      duration: ROUTE_ANIM_MS,
      easing: "ease-in",
      fill: "forwards",
    });
  }

  // Animate each zone line with staggered timing.
  // Visibility is flipped exactly when drawing begins — never during the delay —
  // so no dot/point artefacts appear at zone start positions.
  svg
    .querySelectorAll<SVGGeometryElement>(
      `polyline.${CssClass.RouteLine}[data-climb-index="${index}"]`
    )
    .forEach((line) => {
      const startRatio = parseFloat(line.dataset.startRatio ?? "0");
      const endRatio = parseFloat(line.dataset.endRatio ?? "1");
      const len = parseFloat(line.style.strokeDasharray || "0") || line.getTotalLength();

      const delay = startRatio * ROUTE_ANIM_MS;
      const duration = Math.max(1, (endRatio - startRatio) * ROUTE_ANIM_MS);

      const start = () => {
        line.style.strokeDasharray = String(len);
        line.style.strokeDashoffset = String(len);
        line.style.visibility = "visible";
        line.animate([{ strokeDashoffset: String(len) }, { strokeDashoffset: "0" }], {
          duration,
          easing: "ease-out",
          fill: "forwards",
        });
      };

      const timers = _pendingTimers.get(index) ?? [];
      if (delay <= 0) {
        start();
      } else {
        timers.push(setTimeout(start, delay));
        _pendingTimers.set(index, timers);
      }
    });
}

/**
 * Hides the route for climb at `index`, cancelling any active animations.
 */
export function hideClimbRoute(index: number): void {
  // Cancel any pending zone-start timeouts
  (_pendingTimers.get(index) ?? []).forEach(clearTimeout);
  _pendingTimers.delete(index);

  const svg = document.getElementById(ElementId.RouteSvg);
  if (!svg) return;
  svg.querySelectorAll<SVGElement>(`polyline[data-climb-index="${index}"]`).forEach((el) => {
    el.getAnimations().forEach((a) => a.cancel());
    el.style.visibility = "hidden";
  });
}
