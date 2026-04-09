/**
 * content/panel.ts — Sidebar climb analysis panel logic and event wiring.
 * Depends on: climb-card.ts, route-overview.ts, panel-template.ts
 *
 * Exports: buildPanel
 */

import { buildClimbCard, calcMaxGradientOver } from "./climb-card";
import { buildRouteOverview } from "./route-overview";
import { renderEmptyPanel, renderPanelShell } from "./panel-template";
import type { Climb } from "../types";
import { StorageKey } from "../types";

function buildPanelContent(climbs: Climb[], totalRouteDistance: number): string {
  const totalDist =
    totalRouteDistance || Math.max(...climbs.flatMap((c) => c.segments).map((s) => s.endDistance));
  const totalElevGain = climbs.reduce((s, c) => s + c.elevation, 0);
  const maxGradient = calcMaxGradientOver(
    climbs.flatMap((c) => c.segments),
    200
  );

  const climbsLabel =
    climbs.length === 1
      ? chrome.i18n.getMessage("panelClimbsDetectedSingular")
      : chrome.i18n.getMessage("panelClimbsDetectedPlural", [String(climbs.length)]);

  let inner = buildRouteOverview(totalDist, totalElevGain, maxGradient, climbs);
  inner += `<div class="section-label">${climbsLabel}</div>`;
  climbs.forEach((climb, i) => {
    inner += buildClimbCard(climb, i);
  });
  return inner;
}

function wireCollapseToggle(panel: HTMLElement): void {
  const toggleBtn = panel.querySelector<HTMLButtonElement>(".cip-toggle")!;
  const body = panel.querySelector<HTMLElement>(".cip-body")!;
  toggleBtn.addEventListener("click", () => {
    const expanded = toggleBtn.getAttribute("aria-expanded") === "true";
    toggleBtn.setAttribute("aria-expanded", String(!expanded));
    body.style.display = expanded ? "none" : "";
    panel.querySelector<SVGElement>(".cip-chevron")!.style.transform = expanded
      ? "rotate(-90deg)"
      : "";
  });
}

function wireLayerToggle(panel: HTMLElement): void {
  const layerBtn = panel.querySelector<HTMLButtonElement>("#cip-layer-toggle")!;
  const eyeIcon = layerBtn.querySelector<SVGElement>(".cip-eye-icon")!;
  const eyeOffIcon = layerBtn.querySelector<SVGElement>(".cip-eye-off-icon")!;

  chrome.storage.local.get(StorageKey.MapLayerVisible, (pref) => {
    const visible = pref[StorageKey.MapLayerVisible] as boolean | undefined;
    const isVisible = visible !== false;
    eyeIcon.style.display = isVisible ? "" : "none";
    eyeOffIcon.style.display = isVisible ? "none" : "";
    layerBtn.classList.toggle("cip-layer-off", !isVisible);
  });

  layerBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    chrome.storage.local.get(StorageKey.MapLayerVisible, (pref) => {
      const current = (pref[StorageKey.MapLayerVisible] as boolean | undefined) !== false;
      const next = !current;
      chrome.storage.local.set({ [StorageKey.MapLayerVisible]: next });
      eyeIcon.style.display = next ? "" : "none";
      eyeOffIcon.style.display = next ? "none" : "";
      layerBtn.classList.toggle("cip-layer-off", !next);
      const overlay = document.getElementById("climb-marker-overlay");
      if (overlay) overlay.style.display = next ? "" : "none";
    });
  });
}

/** Build the full sidebar panel element. */
export function buildPanel(climbs: Climb[] | null, totalRouteDistance: number): HTMLElement {
  const panel = document.createElement("div");
  panel.id = "climb-inject-panel";

  if (!climbs || climbs.length === 0) {
    panel.innerHTML = renderEmptyPanel(chrome.runtime.getURL("images/icon-48.png"));
    return panel;
  }

  const inner = buildPanelContent(climbs, totalRouteDistance);
  panel.innerHTML = renderPanelShell(chrome.runtime.getURL("images/icon-48.png"), inner);

  wireCollapseToggle(panel);
  wireLayerToggle(panel);

  return panel;
}
