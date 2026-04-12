/**
 * share-card.ts — Generates a shareable PNG card (1200×630px) using OffscreenCanvas.
 *
 * Card layout (top → bottom):
 *   Header  (~80px)  — "MapyClimbs" + route stats
 *   Chart   (~280px) — grade-coloured elevation area
 *   Strip   (~24px)  — proportional climb position strip
 *   Grid    (~170px) — per-climb category pill + metrics
 *   Footer  (~76px)  — Mapy short URL + extension ad
 */

import { CATEGORY_COLOR } from "./content/category";
import { calcMaxGradientOver } from "./content/climb-card";
import type { Climb, ElevationTuple, ClimbCategory } from "./types";

// ── Constants ─────────────────────────────────────────────────────────────────

const CW = 1200;
const CH = 630;

const HEADER_H = 80;
const CHART_H = 280;
const STRIP_H = 24;
const GRID_H = 170;
const FOOTER_H = CH - HEADER_H - CHART_H - STRIP_H - GRID_H; // ~76

const BG = "#1a1a2e";
const FOOTER_BG = "#111111";
const TEXT_PRIMARY = "#ffffff";
const TEXT_MUTED = "#9ca3af";

const CWS_URL = "chromewebstore.google.com/detail/mapyclimbs";

const GRADE_COLORS: [number, string][] = [
  [3, "#4CAF50"],
  [6, "#FBC02D"],
  [9, "#F57C00"],
  [12, "#D32F2F"],
  [Infinity, "#800020"],
];

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generates the share card as a PNG Blob.
 * @param climbs       Detected climbs for the route.
 * @param totalDistance Total route distance in metres.
 * @param rawTuples    Raw GPX elevation tuples [distM, elevM, lat, lon].
 * @param mapyUrl      Mapy short URL to embed in the footer (e.g. https://mapy.com/s/abc).
 */
export function generateShareCard(
  climbs: Climb[],
  totalDistance: number,
  rawTuples: ElevationTuple[],
  mapyUrl: string
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = CW;
  canvas.height = CH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("Canvas 2D context unavailable"));

  const totalElevGain = climbs.reduce((s, c) => s + c.elevation, 0);
  const allSegments = climbs.flatMap((c) => c.segments);
  const maxGrade = calcMaxGradientOver(allSegments, 200);
  const profile = downsampleProfile(rawTuples, 300);

  drawBackground(ctx);
  drawHeader(ctx, totalDistance, totalElevGain, maxGrade);
  drawElevationChart(ctx, profile, climbs, totalDistance);
  drawClimbStrip(ctx, climbs, totalDistance);
  drawClimbGrid(ctx, climbs);
  drawFooter(ctx, mapyUrl);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("toBlob produced null"))),
      "image/png"
    );
  });
}

// ── Background ────────────────────────────────────────────────────────────────

function drawBackground(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, CW, CH);
}

// ── Header ────────────────────────────────────────────────────────────────────

function drawHeader(
  ctx: CanvasRenderingContext2D,
  totalDistM: number,
  totalElevM: number,
  maxGrade: number
): void {
  const PAD = 32;
  const midY = HEADER_H / 2;

  // Left: "MapyClimbs" brand
  ctx.fillStyle = TEXT_PRIMARY;
  ctx.font = "bold 28px system-ui, sans-serif";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText("MapyClimbs", PAD, midY);

  // Right: route stats
  const distKm = (totalDistM / 1000).toFixed(1);
  const elevM = Math.round(totalElevM);
  const grade = maxGrade.toFixed(1);
  const stats = `${distKm} km  ·  +${elevM} m  ·  max ${grade}%`;

  ctx.fillStyle = TEXT_MUTED;
  ctx.font = "18px system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(stats, CW - PAD, midY);

  // Divider
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, HEADER_H);
  ctx.lineTo(CW, HEADER_H);
  ctx.stroke();
}

// ── Elevation chart ───────────────────────────────────────────────────────────

interface ProfilePt {
  distM: number;
  elevM: number;
}

function downsampleProfile(tuples: ElevationTuple[], maxPts: number): ProfilePt[] {
  if (tuples.length === 0) return [];
  const step = Math.max(1, Math.floor(tuples.length / maxPts));
  const pts: ProfilePt[] = [];
  for (let i = 0; i < tuples.length; i += step) {
    pts.push({ distM: tuples[i][0], elevM: tuples[i][1] });
  }
  // Always include last point
  const last = tuples[tuples.length - 1];
  if (pts[pts.length - 1].distM !== last[0]) {
    pts.push({ distM: last[0], elevM: last[1] });
  }
  return pts;
}

function gradeColor(g: number): string {
  for (const [threshold, color] of GRADE_COLORS) {
    if (g < threshold) return color;
  }
  return GRADE_COLORS[GRADE_COLORS.length - 1][1];
}

function drawElevationChart(
  ctx: CanvasRenderingContext2D,
  profile: ProfilePt[],
  climbs: Climb[],
  totalDistM: number
): void {
  if (profile.length < 2) return;

  const TOP = HEADER_H;
  const PAD_L = 0;
  const PAD_R = 0;
  const PAD_TOP = 20;
  const PAD_BOT = 0;
  const W = CW - PAD_L - PAD_R;
  const H = CHART_H - PAD_TOP - PAD_BOT;

  const minElev = Math.min(...profile.map((p) => p.elevM));
  const maxElev = Math.max(...profile.map((p) => p.elevM));
  const elevRange = maxElev - minElev || 1;
  const distRange = totalDistM || profile[profile.length - 1].distM || 1;

  const sx = (d: number): number => PAD_L + (d / distRange) * W;
  const sy = (e: number): number => TOP + PAD_TOP + H - ((e - minElev) / elevRange) * H;
  const baseY = TOP + PAD_TOP + H;

  // Build filled segment-coloured areas between consecutive profile points
  ctx.save();
  ctx.rect(0, TOP, CW, CHART_H);
  ctx.clip();
  for (let i = 0; i < profile.length - 1; i++) {
    const p0 = profile[i];
    const p1 = profile[i + 1];
    const segDistM = p1.distM - p0.distM;
    const segElevM = p1.elevM - p0.elevM;
    const grad = segDistM > 0 ? (segElevM / segDistM) * 100 : 0;
    const color = gradeColor(Math.abs(grad));

    const x0 = sx(p0.distM);
    const x1 = sx(p1.distM);
    const y0 = sy(p0.elevM);
    const y1 = sy(p1.elevM);

    ctx.beginPath();
    ctx.moveTo(x0, baseY);
    ctx.lineTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x1, baseY);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.85;
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Outline stroke
  ctx.beginPath();
  ctx.moveTo(sx(profile[0].distM), sy(profile[0].elevM));
  for (let i = 1; i < profile.length; i++) {
    ctx.lineTo(sx(profile[i].distM), sy(profile[i].elevM));
  }
  ctx.strokeStyle = "rgba(255,255,255,0.4)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Fade overlay: top of chart is more transparent (aura effect)
  const fadeGrad = ctx.createLinearGradient(0, TOP + PAD_TOP, 0, baseY);
  fadeGrad.addColorStop(0, "rgba(26,26,46,0.55)");
  fadeGrad.addColorStop(1, "rgba(26,26,46,0)");
  ctx.fillStyle = fadeGrad;
  ctx.fillRect(PAD_L, TOP + PAD_TOP, W, H);

  ctx.restore();
}

// ── Climb strip ───────────────────────────────────────────────────────────────

function drawClimbStrip(ctx: CanvasRenderingContext2D, climbs: Climb[], totalDistM: number): void {
  const TOP = HEADER_H + CHART_H;
  const dist = totalDistM || 1;

  // Background track
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fillRect(0, TOP, CW, STRIP_H);

  for (const climb of climbs) {
    const startDist = climb.segments[0]?.startDistance ?? 0;
    const endDist = climb.segments[climb.segments.length - 1]?.endDistance ?? startDist;
    const x = (startDist / dist) * CW;
    const w = Math.max(4, ((endDist - startDist) / dist) * CW);
    ctx.fillStyle = CATEGORY_COLOR[climb.category as ClimbCategory];
    ctx.fillRect(x, TOP, w, STRIP_H);
  }
}

// ── Climb grid ────────────────────────────────────────────────────────────────

function drawClimbGrid(ctx: CanvasRenderingContext2D, climbs: Climb[]): void {
  const TOP = HEADER_H + CHART_H + STRIP_H;
  const PAD = 24;
  const COLS = Math.min(climbs.length, 6);
  if (COLS === 0) return;

  const CELL_W = (CW - PAD * 2) / Math.max(COLS, 1);
  const ROW_H = 80;

  for (let i = 0; i < climbs.length; i++) {
    const climb = climbs[i];
    const col = i % 6;
    const row = Math.floor(i / 6);
    const x = PAD + col * CELL_W;
    const y = TOP + PAD / 2 + row * ROW_H;

    const color = CATEGORY_COLOR[climb.category as ClimbCategory];

    // Category pill
    const PILL_W = 42;
    const PILL_H = 22;
    drawRoundedRect(ctx, x, y, PILL_W, PILL_H, 5, color);
    ctx.fillStyle = TEXT_PRIMARY;
    ctx.font = "bold 13px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const catLabel = climb.category === "HC" ? "HC" : `Cat ${climb.category}`;
    ctx.fillText(catLabel, x + PILL_W / 2, y + PILL_H / 2);

    // Climb number
    ctx.fillStyle = TEXT_MUTED;
    ctx.font = "12px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(`#${i + 1}`, x + PILL_W + 8, y + PILL_H / 2);

    // Metrics line
    const distKm = (climb.distance / 1000).toFixed(1);
    const grade = climb.avgGrade.toFixed(1);
    const elevM = Math.round(climb.elevation);
    ctx.fillStyle = TEXT_PRIMARY;
    ctx.font = "15px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(`${distKm} km  +${elevM} m  ${grade}%`, x, y + PILL_H + 8);
  }
}

// ── Footer ────────────────────────────────────────────────────────────────────

function drawFooter(ctx: CanvasRenderingContext2D, mapyUrl: string): void {
  const TOP = HEADER_H + CHART_H + STRIP_H + GRID_H;
  const PAD = 32;
  const midY = TOP + FOOTER_H / 2;

  ctx.fillStyle = FOOTER_BG;
  ctx.fillRect(0, TOP, CW, FOOTER_H);

  // Divider
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, TOP);
  ctx.lineTo(CW, TOP);
  ctx.stroke();

  // Mapy short URL (left)
  if (mapyUrl) {
    ctx.fillStyle = TEXT_PRIMARY;
    ctx.font = "16px 'Courier New', monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(mapyUrl, PAD, midY);
  }

  // Extension ad (right)
  ctx.fillStyle = TEXT_MUTED;
  ctx.font = "13px system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText(`Detected by MapyClimbs · ${CWS_URL}`, CW - PAD, midY);
}

// ── Drawing utilities ─────────────────────────────────────────────────────────

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: string
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}
