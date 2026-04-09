/**
 * content/climb-card.ts — Individual climb card DOM builder.
 * Depends on: chart.ts (generateElevationChart)
 *
 * Exports: buildClimbCard, calcMaxGradientOver
 */

import { generateElevationChart } from "./chart";
import { getCategoryClass } from "./category";
import { metersToKm, metersToKmNum, toPercent, formatMinutes } from "../format";
import type { Climb, Segment } from "../types";

// ── Climb metrics ─────────────────────────────────────────────────────────────

export function calcMaxGradientOver(segments: Segment[], minDistance: number): number {
  let best = 0;
  for (let i = 0; i < segments.length; i++) {
    let dist = 0,
      weightedGrad = 0;
    for (let j = i; j < segments.length; j++) {
      dist += segments[j].distance;
      weightedGrad += segments[j].gradient * segments[j].distance;
      if (dist >= minDistance) {
        best = Math.max(best, weightedGrad / dist);
        break;
      }
    }
  }
  return best;
}

function estimatedSpeedKmh(avgGrade: number): number {
  return 12 / (1 + avgGrade / 5);
}

function calcVAM(climb: Climb): number {
  return Math.round(estimatedSpeedKmh(climb.avgGrade) * climb.avgGrade * 10);
}

function estimateClimbTime(climb: Climb): number {
  return (metersToKmNum(climb.distance) / estimatedSpeedKmh(climb.avgGrade)) * 60;
}

function calcFiets(climb: Climb): string {
  const distKm = metersToKmNum(climb.distance);
  if (distKm === 0) return "0.0";
  return ((climb.elevation * climb.elevation) / distKm / 1000).toFixed(1);
}

interface SummitInfo {
  elev: number;
  dist: number;
}

function findSummit(climb: Climb): SummitInfo {
  let elev = -Infinity,
    dist = 0;
  for (const seg of climb.segments) {
    if (seg.startElevation > elev) {
      elev = seg.startElevation;
      dist = seg.startDistance;
    }
    if (seg.endElevation > elev) {
      elev = seg.endElevation;
      dist = seg.endDistance;
    }
  }
  return { elev, dist };
}

const PEAK_SVG =
  '<svg class="summit-icon" width="11" height="10" viewBox="0 0 11 10" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
  '<path d="M1 9.5L5.5 0.5L10 9.5H1Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>' +
  '<path d="M3.5 5.5L5.5 0.5L7.5 5.5H3.5Z" fill="currentColor" opacity="0.45"/>' +
  "</svg>";

// ── Climb card ────────────────────────────────────────────────────────────────

export function buildClimbCard(climb: Climb, index: number): string {
  const catClass = getCategoryClass(climb.category);
  const maxGrad = calcMaxGradientOver(climb.segments, 200);
  const summit = findSummit(climb);
  const timeStr = formatMinutes(estimateClimbTime(climb));
  const chart = generateElevationChart(climb.segments, climb.distance);

  return `
    <div class="climb-item ${catClass}">
      <div class="climb-header">
        <div class="climb-title-group">
          <span class="climb-name">${chrome.i18n.getMessage("panelClimb", [String(index + 1)])}</span>
          <span class="climb-badge">${chrome.i18n.getMessage("panelCat", [climb.category])}</span>
        </div>
      </div>
      <div class="climb-stats">
        <div class="stat"><span class="stat-label">${chrome.i18n.getMessage("panelDistance")}</span><span class="stat-value">${metersToKm(climb.distance, 2)} km</span></div>
        <div class="stat"><span class="stat-label">${chrome.i18n.getMessage("panelElevation")}</span><span class="stat-value highlight">+${Math.round(climb.elevation)} m</span></div>
        <div class="stat"><span class="stat-label">${chrome.i18n.getMessage("panelAvgGrade")}</span><span class="stat-value">${toPercent(climb.avgGrade)}</span></div>
      </div>
      <div class="climb-stats secondary-stats">
        <div class="stat"><span class="stat-label">${chrome.i18n.getMessage("panelMaxGradeLabel")}</span><span class="stat-value stat-secondary">${toPercent(maxGrad)}</span></div>
        <div class="stat"><span class="stat-label">${chrome.i18n.getMessage("panelSummit")}</span><span class="stat-value stat-secondary stat-summit">${PEAK_SVG}${Math.round(summit.elev)} m</span></div>
        <div class="stat"><span class="stat-label">${chrome.i18n.getMessage("panelSummitAt")}</span><span class="stat-value stat-secondary">${metersToKm(summit.dist)} km</span></div>
      </div>
      <div class="climb-meta">
        <div class="climb-meta-item"><span class="climb-meta-label">${chrome.i18n.getMessage("panelEstTime")}</span><span class="climb-meta-value">${timeStr}</span></div>
        <div class="climb-meta-item"><span class="climb-meta-label">${chrome.i18n.getMessage("panelVam")}</span><span class="climb-meta-value">${calcVAM(climb)} m/h</span></div>
        <div class="climb-meta-item"><span class="climb-meta-label">${chrome.i18n.getMessage("panelFietsIndex")}</span><span class="climb-meta-value">${calcFiets(climb)}</span></div>
      </div>
      ${chart}
    </div>`;
}
