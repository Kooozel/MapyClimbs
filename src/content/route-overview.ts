/**
 * content/route-overview.ts — Route overview card DOM builder.
 *
 * Exports: buildRouteOverview
 */

import { getCategoryColor } from "./category";
import { metersToKm, toPercent, ratioToPercent } from "../format";
import { ClimbCategory } from "climb-engine";
import type { ScoredAnalysisResult } from "../types";

// ── Route overview ────────────────────────────────────────────────────────────

export function buildRouteOverview(analysisResult: ScoredAnalysisResult): string {
  const { climbs, totalDistance, totalElevationGain } = analysisResult;
  const distKm = metersToKm(totalDistance);
  const climbingKm = metersToKm(climbs.reduce((s, c) => s + c.distance, 0));
  const climbsLabel =
    climbs.length === 1
      ? chrome.i18n.getMessage("panelClimbsDetectedSingular")
      : chrome.i18n.getMessage("panelClimbsDetectedPlural");

  const strips = climbs.map((climb, i) => {
    const startPct = ratioToPercent(climb.segments[0].startDistance, totalDistance);
    const endPct = ratioToPercent(
      climb.segments[climb.segments.length - 1].endDistance,
      totalDistance
    );
    const widthPct = parseFloat(endPct) - parseFloat(startPct);
    const color = getCategoryColor(climb.category);
    const midPct = toPercent(parseFloat(startPct) + widthPct / 2);
    const catLabel =
      climb.category === ClimbCategory.HC
        ? "HC"
        : climb.category === ClimbCategory.Uncategorized
          ? chrome.i18n.getMessage("panelCatUncategorized")
          : chrome.i18n.getMessage("panelCat", [climb.category]);
    return {
      seg: `<div class="strip-segment" style="left:${startPct};width:${toPercent(widthPct)};background:${color};opacity:0.85;" title="${chrome.i18n.getMessage("panelClimb", [String(i + 1)])}: ${catLabel}"></div>`,
      label: widthPct > 4 ? `<span class="strip-label" style="left:${midPct}">${i + 1}</span>` : "",
    };
  });
  const stripSegments = strips.map((s) => s.seg).join("");
  const stripLabels = strips.map((s) => s.label).join("");

  return `
    <div class="route-overview">
      <div class="route-overview-title">${chrome.i18n.getMessage("panelRouteOverview")}</div>
      <div class="route-stats-row">
        <div class="rstat"><span class="rstat-value">${distKm}</span><span class="rstat-label">${chrome.i18n.getMessage("panelKmTotal")}</span></div>
        <div class="rstat"><span class="rstat-value">+${Math.round(totalElevationGain)}</span><span class="rstat-label rstat-label--info">${chrome.i18n.getMessage("panelMClimbing")}<span class="rstat-info" data-tooltip="${chrome.i18n.getMessage("panelElevationGainTooltip")}">ⓘ</span></span></div>
        <div class="rstat"><span class="rstat-value">${climbs.length}</span><span class="rstat-label">${climbsLabel}</span></div>
        <div class="rstat"><span class="rstat-value">${climbingKm}</span><span class="rstat-label">${chrome.i18n.getMessage("panelKmClimbs")}</span></div>
      </div>
      <div class="route-strip-wrap">
        <div class="route-strip">${stripSegments}</div>
        ${stripLabels}
      </div>
    </div>`;
}
