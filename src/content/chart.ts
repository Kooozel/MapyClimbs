/**
 * content/chart.ts — Elevation profile SVG chart renderer.
 */

import type { Segment } from "../types";
import { ratioToPercent } from "../format";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ProfilePoint {
  distance: number;
  elevation: number;
  gradient: number;
}

export interface GradientZone {
  color: string;
  start: number;
  end: number;
}

interface ChartLayout {
  W: number;
  H: number;
  M: { left: number; right: number; top: number; bottom: number };
  cW: number;
  cH: number;
  base: number;
  sx: (d: number) => number;
  sy: (el: number) => number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

let _chartUid = 0;

/** Grade threshold → fill color. Each entry's color covers grades up to (but not including)
 *  the threshold value. The last entry uses Infinity to capture all higher grades. */
const GRADE_COLORS: [number, string][] = [
  [3, "#4CAF50"],
  [6, "#FBC02D"],
  [9, "#F57C00"],
  [12, "#D32F2F"],
  [Infinity, "#800020"],
];

/** SVG canvas total dimensions. */
const CHART_W = 440;
const CHART_H = 120;
/** Chart margins (px): space reserved for axes. */
const CHART_M = { left: 42, right: 12, top: 10, bottom: 28 };
/** Minimum pixel gap between adjacent x-axis ticks. */
const MIN_TICK_PX = 38;

// ── Public entry point ────────────────────────────────────────────────────────

/** Returns an HTML string with the SVG elevation chart, or '' when data is insufficient. */
export function generateElevationChart(segments: Segment[], totalDistanceMeters: number): string {
  if (!segments || segments.length === 0) return "";

  const profile = buildProfilePoints(segments);
  if (profile.length < 2) return "";

  return renderElevationSVG(simplifyProfile(profile), totalDistanceMeters);
}

// ── Profile building ──────────────────────────────────────────────────────────

function buildProfilePoints(segments: Segment[]): ProfilePoint[] {
  const profile: ProfilePoint[] = [];
  let cumulDist = 0;
  for (const seg of segments) {
    profile.push({ distance: cumulDist, elevation: seg.startElevation, gradient: seg.gradient });
    cumulDist += seg.distance;
  }
  profile.push({
    distance: cumulDist,
    elevation: segments[segments.length - 1].endElevation,
    gradient: 0,
  });
  return profile;
}

export function simplifyProfile(profile: ProfilePoint[]): ProfilePoint[] {
  if (profile.length <= 3) return profile;
  const maxSegs = Math.min(20, Math.max(8, Math.ceil(profile.length / 3)));
  const grads = profile.slice(0, -1).map((p) => p.gradient);

  let keys = [0];
  for (let i = 1; i < grads.length - 1; i++) {
    if (Math.abs(grads[i] - grads[i - 1]) >= 1.5) keys.push(i);
  }
  keys.push(profile.length - 1);

  if (keys.length > maxSegs) {
    keys = [0];
    const step = Math.floor(profile.length / maxSegs);
    for (let i = step; i < profile.length - 1; i += step) keys.push(i);
    keys.push(profile.length - 1);
  }

  return [...new Set(keys)].sort((a, b) => a - b).map((i) => profile[i]);
}

// ── Gradient zone helpers ─────────────────────────────────────────────────────

export function getColorForGrade(g: number): string {
  return GRADE_COLORS.find(([threshold]) => g < threshold)![1];
}

function segmentGradient(a: ProfilePoint, b: ProfilePoint): number {
  const dD = b.distance - a.distance;
  return dD > 0 ? ((b.elevation - a.elevation) / dD) * 100 : 0;
}

function buildGradientZones(profile: ProfilePoint[]): GradientZone[] {
  const zones: GradientZone[] = [];
  for (let i = 0; i < profile.length - 1; i++) {
    const a = profile[i],
      b = profile[i + 1];
    const col = getColorForGrade(segmentGradient(a, b));
    if (zones.length === 0 || zones[zones.length - 1].color !== col) {
      zones.push({ color: col, start: a.distance, end: b.distance });
    } else {
      zones[zones.length - 1].end = b.distance;
    }
  }
  return zones;
}

export function mergeShortZones(zones: GradientZone[], minLen: number): GradientZone[] {
  zones = zones.slice();
  let changed = true;
  while (changed && zones.length > 1) {
    changed = false;
    const si = zones.reduce(
      (mi, z, i) => (z.end - z.start < zones[mi].end - zones[mi].start ? i : mi),
      0
    );
    if (zones[si].end - zones[si].start >= minLen) break;

    const hasLeft = si > 0;
    const hasRight = si < zones.length - 1;
    if (hasLeft && hasRight) {
      const leftLen = zones[si - 1].end - zones[si - 1].start;
      const rightLen = zones[si + 1].end - zones[si + 1].start;
      if (leftLen >= rightLen) zones[si - 1].end = zones[si].end;
      else zones[si + 1].start = zones[si].start;
    } else if (hasLeft) {
      zones[si - 1].end = zones[si].end;
    } else {
      zones[si + 1].start = zones[si].start;
    }
    zones.splice(si, 1);
    changed = true;
  }
  return zones;
}

// ── SVG building blocks ───────────────────────────────────────────────────────

function buildCoords(profile: ProfilePoint[], totalDistance: number) {
  const W = CHART_W,
    H = CHART_H;
  const M = CHART_M;
  const cW = W - M.left - M.right;
  const cH = H - M.top - M.bottom;

  const elevs = profile.map((p) => p.elevation);
  const minElev = Math.min(...elevs) - 5;
  const maxElev = Math.max(...elevs) + 5;
  const elevRange = maxElev - minElev;

  const sx = (d: number) => M.left + (d / (totalDistance || 1)) * cW;
  const sy = (el: number) => H - M.bottom - ((el - minElev) / elevRange) * cH;

  return { W, H, M, cW, cH, base: H - M.bottom, sx, sy, minElev, maxElev, elevRange };
}

function buildCurvePaths(
  profile: ProfilePoint[],
  sx: (d: number) => number,
  sy: (el: number) => number,
  base: number
): { fillPath: string; strokePath: string } {
  const pts = profile.map((p) => ({ x: sx(p.distance), y: sy(p.elevation) }));
  let curve = "";
  for (let i = 1; i < pts.length; i++) {
    const p0 = pts[Math.max(0, i - 2)];
    const p1 = pts[i - 1];
    const p2 = pts[i];
    const p3 = pts[Math.min(pts.length - 1, i + 1)];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    curve += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  const first = pts[0],
    last = pts[pts.length - 1];
  return {
    fillPath: `M ${first.x.toFixed(1)} ${base} L ${first.x.toFixed(1)} ${first.y.toFixed(1)}${curve} L ${last.x.toFixed(1)} ${base} Z`,
    strokePath: `M ${first.x.toFixed(1)} ${first.y.toFixed(1)}${curve}`,
  };
}

function buildGradientStops(profile: ProfilePoint[], totalDistance: number): string {
  const stops: string[] = [];
  for (let i = 0; i < profile.length - 1; i++) {
    const a = profile[i],
      b = profile[i + 1];
    const col = getColorForGrade(segmentGradient(a, b));
    const sPct = ratioToPercent(a.distance, totalDistance || 1, 2);
    const ePct = ratioToPercent(b.distance, totalDistance || 1, 2);
    stops.push(
      `<stop offset="${sPct}" stop-color="${col}"/>`,
      `<stop offset="${ePct}" stop-color="${col}"/>`
    );
  }
  return stops.join("\n            ");
}

function buildYAxis(
  minElev: number,
  elevRange: number,
  M: ChartLayout["M"],
  W: number,
  sy: (el: number) => number
): string {
  let out = "";
  for (let i = 0; i < 4; i++) {
    const el = minElev + (i / 3) * elevRange;
    const y = sy(el).toFixed(1);
    out += `<line x1="${M.left - 4}" y1="${y}" x2="${M.left}" y2="${y}" stroke="rgba(0,0,0,0.25)" stroke-width="0.5"/>`;
    out += `<text x="${M.left - 6}" y="${y}" dy="0.35em" font-size="10" fill="#666" text-anchor="end">${Math.round(el)}</text>`;
    if (i > 0 && i < 3)
      out += `<line x1="${M.left}" y1="${y}" x2="${W - M.right}" y2="${y}" stroke="rgba(0,0,0,0.07)" stroke-width="0.5"/>`;
  }
  return out;
}

function buildXAxis(
  profile: ProfilePoint[],
  totalDistance: number,
  sx: (d: number) => number,
  base: number,
  H: number
): string {
  const zones = mergeShortZones(buildGradientZones(profile), Math.max(300, totalDistance * 0.07));
  const boundaries = [...zones.map((z) => z.start), zones[zones.length - 1].end];

  const ticks: number[] = [boundaries[0]];
  for (let i = 1; i < boundaries.length - 1; i++) {
    if (sx(boundaries[i]) - sx(ticks[ticks.length - 1]) >= MIN_TICK_PX) ticks.push(boundaries[i]);
  }
  const endD = boundaries[boundaries.length - 1];
  if (sx(endD) - sx(ticks[ticks.length - 1]) < MIN_TICK_PX) ticks[ticks.length - 1] = endD;
  else ticks.push(endD);

  const fmt = (d: number) => {
    if (totalDistance >= 1000) {
      const km = d / 1000;
      return Number.isInteger(km) ? `${km}km` : `${km.toFixed(1)}km`;
    }
    return `${Math.round(d)}m`;
  };

  return ticks
    .map((d) => {
      const x = sx(d).toFixed(1);
      return (
        `<line x1="${x}" y1="${base}" x2="${x}" y2="${base + 3}" stroke="rgba(0,0,0,0.25)" stroke-width="0.5"/>` +
        `<text x="${x}" y="${H - 6}" font-size="9" fill="#666" text-anchor="middle">${fmt(d)}</text>`
      );
    })
    .join("");
}

// ── SVG assembly ──────────────────────────────────────────────────────────────

/** Build the gradient-colour legend HTML from GRADE_COLORS so that it always
 *  stays in sync with the actual chart colours without duplicating hex values. */
function buildLegend(): string {
  return GRADE_COLORS.map(([threshold, color], i) => {
    const prev = i > 0 ? (GRADE_COLORS[i - 1][0] as number) : null;
    const label =
      threshold === Infinity
        ? `≥${prev}%`
        : prev === null
          ? `<${threshold}%`
          : `${prev}–${threshold}%`;
    return `<span><span class="csw" style="background:${color}"></span>${label}</span>`;
  }).join("\n        ");
}

function renderElevationSVG(profile: ProfilePoint[], totalDistance: number): string {
  if (profile.length < 2) return "";

  const c = buildCoords(profile, totalDistance);
  if (c.elevRange === 0) return "";

  const uid = _chartUid++;
  const { fillPath, strokePath } = buildCurvePaths(profile, c.sx, c.sy, c.base);
  const stops = buildGradientStops(profile, totalDistance);
  const yAxis = buildYAxis(c.minElev, c.elevRange, c.M, c.W, c.sy);
  const xAxis = buildXAxis(profile, totalDistance, c.sx, c.base, c.H);

  return `
    <div class="climb-profile-container">
      <svg viewBox="0 0 ${c.W} ${c.H}" class="profile-svg" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <clipPath id="profileClip-${uid}">
            <path d="${fillPath}"/>
          </clipPath>
          <linearGradient id="slopeGrad-${uid}" x1="${c.M.left}" y1="0" x2="${c.W - c.M.right}" y2="0" gradientUnits="userSpaceOnUse">
            ${stops}
          </linearGradient>
          <linearGradient id="auraFade-${uid}" x1="0" y1="${c.M.top}" x2="0" y2="${c.base}" gradientUnits="userSpaceOnUse">
            <stop offset="0%"   stop-color="#fff" stop-opacity="0.55"/>
            <stop offset="100%" stop-color="#fff" stop-opacity="0"/>
          </linearGradient>
        </defs>

        <rect width="${c.W}" height="${c.H}" fill="#f7f8f9"/>

        <g clip-path="url(#profileClip-${uid})">
          <rect x="${c.M.left}" y="${c.M.top}" width="${c.cW}" height="${c.cH}" fill="url(#slopeGrad-${uid})"/>
          <rect x="${c.M.left}" y="${c.M.top}" width="${c.cW}" height="${c.cH}" fill="url(#auraFade-${uid})"/>
        </g>

        <line x1="${c.M.left}" y1="${c.M.top}" x2="${c.M.left}"      y2="${c.base}" stroke="rgba(0,0,0,0.2)" stroke-width="1"/>
        <line x1="${c.M.left}" y1="${c.base}"  x2="${c.W - c.M.right}" y2="${c.base}" stroke="rgba(0,0,0,0.2)" stroke-width="1"/>
        ${yAxis}

        <path d="${strokePath}" fill="none" stroke="url(#slopeGrad-${uid})" stroke-width="2.5"
              stroke-linecap="round" stroke-linejoin="round" opacity="0.95"/>

        ${xAxis}
      </svg>
      <div class="climb-legend">
        ${buildLegend()}
      </div>
    </div>`;
}
