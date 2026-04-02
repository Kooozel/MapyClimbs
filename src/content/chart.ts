/**
 * content/chart.ts — Elevation profile SVG chart renderer.
 * Pure DOM/SVG creation — no Chrome APIs, no module state except the
 * per-page UID counter used to keep gradient/clipPath IDs unique.
 */

import type { ClimbCategory, Segment } from "../types";

let _chartUid = 0;

interface ProfilePoint {
  distance: number;
  elevation: number;
  gradient: number;
}

/** Build an SVG elevation profile chart for a climb. Returns an HTML string or '' when empty. */
export function generateElevationChart(
  segments: Segment[],
  totalDistanceMeters: number,
  _climbCategory: ClimbCategory
): string {
  if (!segments || segments.length === 0) return "";

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
  if (profile.length < 2) return "";

  return renderElevationSVG(simplifyElevationProfile(profile), cumulDist, _climbCategory);
}

function simplifyElevationProfile(profile: ProfilePoint[]): ProfilePoint[] {
  if (profile.length <= 3) return profile;
  const maxSegs = Math.min(20, Math.max(8, Math.ceil(profile.length / 3)));

  const grads: number[] = [];
  for (let i = 0; i < profile.length - 1; i++) {
    const dE = profile[i + 1].elevation - profile[i].elevation;
    const dD = profile[i + 1].distance - profile[i].distance;
    grads.push(dD > 0 ? (dE / dD) * 100 : 0);
  }

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

function renderElevationSVG(
  profile: ProfilePoint[],
  totalDistance: number,
  _climbCategory: ClimbCategory = "4"
): string {
  if (profile.length < 2) return "";
  const uid = _chartUid++;

  const elevs = profile.map((p) => p.elevation);
  const minElev = Math.min(...elevs) - 5;
  const maxElev = Math.max(...elevs) + 5;
  const elevRange = maxElev - minElev;
  if (elevRange === 0) return "";

  const W = 440,
    H = 120;
  const M = { left: 42, right: 12, top: 10, bottom: 28 };
  const cW = W - M.left - M.right;
  const cH = H - M.top - M.bottom;

  const sx = (d: number) => M.left + (d / (totalDistance || 1)) * cW;
  const sy = (el: number) => H - M.bottom - ((el - minElev) / elevRange) * cH;
  const base = H - M.bottom;

  const getColorForGrade = (g: number): string => {
    if (g < 3) return "#4CAF50";
    if (g < 6) return "#FBC02D";
    if (g < 9) return "#F57C00";
    if (g < 12) return "#D32F2F";
    return "#800020";
  };

  // Catmull-Rom → Cubic Bezier
  const pts = profile.map((p) => ({ x: sx(p.distance), y: sy(p.elevation) }));

  const buildCurve = (): string => {
    let d = "";
    for (let i = 1; i < pts.length; i++) {
      const p0 = pts[Math.max(0, i - 2)];
      const p1 = pts[i - 1];
      const p2 = pts[i];
      const p3 = pts[Math.min(pts.length - 1, i + 1)];
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
    }
    return d;
  };

  const first = pts[0];
  const last = pts[pts.length - 1];
  const curve = buildCurve();
  const fillPath = `M ${first.x.toFixed(1)} ${base} L ${first.x.toFixed(1)} ${first.y.toFixed(1)}${curve} L ${last.x.toFixed(1)} ${base} Z`;
  const strokePath = `M ${first.x.toFixed(1)} ${first.y.toFixed(1)}${curve}`;

  // Hard-edge gradient stops
  const stops: string[] = [];
  for (let i = 0; i < profile.length - 1; i++) {
    const a = profile[i];
    const b = profile[i + 1];
    const dD = b.distance - a.distance;
    const g = dD > 0 ? ((b.elevation - a.elevation) / dD) * 100 : 0;
    const col = getColorForGrade(g);
    const sPct = ((a.distance / (totalDistance || 1)) * 100).toFixed(2) + "%";
    const ePct = ((b.distance / (totalDistance || 1)) * 100).toFixed(2) + "%";
    stops.push(`<stop offset="${sPct}" stop-color="${col}"/>`);
    stops.push(`<stop offset="${ePct}" stop-color="${col}"/>`);
  }

  // Y-axis grid
  let yAxis = "";
  for (let i = 0; i < 4; i++) {
    const r = i / 3;
    const el = minElev + r * elevRange;
    const y = sy(el).toFixed(1);
    yAxis += `<line x1="${M.left - 4}" y1="${y}" x2="${M.left}" y2="${y}" stroke="rgba(0,0,0,0.25)" stroke-width="0.5"/>`;
    yAxis += `<text x="${M.left - 6}" y="${y}" dy="0.35em" font-size="10" fill="#666" text-anchor="end">${Math.round(el)}</text>`;
    if (i > 0 && i < 3)
      yAxis += `<line x1="${M.left}" y1="${y}" x2="${W - M.right}" y2="${y}" stroke="rgba(0,0,0,0.07)" stroke-width="0.5"/>`;
  }

  // X-axis at grade-color-change boundaries
  const segColors = profile.slice(0, -1).map((a, i) => {
    const b = profile[i + 1];
    const dD = b.distance - a.distance;
    const g = dD > 0 ? ((b.elevation - a.elevation) / dD) * 100 : 0;
    return getColorForGrade(g);
  });
  const boundaries = [profile[0].distance];
  for (let i = 1; i < profile.length - 1; i++) {
    if (segColors[i] !== segColors[i - 1]) boundaries.push(profile[i].distance);
  }
  boundaries.push(profile[profile.length - 1].distance);

  const MIN_PX = 44;
  const kept = [boundaries[0]];
  for (let i = 1; i < boundaries.length - 1; i++) {
    if (sx(boundaries[i]) - sx(kept[kept.length - 1]) >= MIN_PX) kept.push(boundaries[i]);
  }
  const endD = boundaries[boundaries.length - 1];
  if (sx(endD) - sx(kept[kept.length - 1]) < MIN_PX) {
    kept[kept.length - 1] = endD;
  } else {
    kept.push(endD);
  }

  let xAxis = "";
  for (const d of kept) {
    const x = sx(d).toFixed(1);
    const lbl = totalDistance >= 1000 ? `${(d / 1000).toFixed(1)}km` : `${Math.round(d)}m`;
    xAxis += `<line x1="${x}" y1="${base}" x2="${x}" y2="${base + 3}" stroke="rgba(0,0,0,0.25)" stroke-width="0.5"/>`;
    xAxis += `<text x="${x}" y="${H - 6}" font-size="9" fill="#666" text-anchor="middle">${lbl}</text>`;
  }

  return `
    <div class="climb-profile-container">
      <svg viewBox="0 0 ${W} ${H}" class="profile-svg" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <clipPath id="profileClip-${uid}">
            <path d="${fillPath}"/>
          </clipPath>
          <linearGradient id="slopeGrad-${uid}" x1="${M.left}" y1="0" x2="${W - M.right}" y2="0" gradientUnits="userSpaceOnUse">
            ${stops.join("\n            ")}
          </linearGradient>
          <linearGradient id="auraFade-${uid}" x1="0" y1="${M.top}" x2="0" y2="${base}" gradientUnits="userSpaceOnUse">
            <stop offset="0%"   stop-color="#fff" stop-opacity="0.55"/>
            <stop offset="100%" stop-color="#fff" stop-opacity="0"/>
          </linearGradient>
        </defs>

        <rect width="${W}" height="${H}" fill="#f7f8f9"/>

        <g clip-path="url(#profileClip-${uid})">
          <rect x="${M.left}" y="${M.top}" width="${cW}" height="${cH}" fill="url(#slopeGrad-${uid})"/>
          <rect x="${M.left}" y="${M.top}" width="${cW}" height="${cH}" fill="url(#auraFade-${uid})"/>
        </g>

        <line x1="${M.left}" y1="${M.top}" x2="${M.left}"       y2="${base}" stroke="rgba(0,0,0,0.2)" stroke-width="1"/>
        <line x1="${M.left}" y1="${base}"  x2="${W - M.right}"  y2="${base}" stroke="rgba(0,0,0,0.2)" stroke-width="1"/>
        ${yAxis}

        <path d="${strokePath}" fill="none" stroke="url(#slopeGrad-${uid})" stroke-width="2.5"
              stroke-linecap="round" stroke-linejoin="round" opacity="0.95"/>

        ${xAxis}
      </svg>
    </div>`;
}
