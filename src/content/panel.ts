/**
 * content/panel.ts — Sidebar climb analysis panel logic and event wiring.
 * Depends on: climb-card.ts, route-overview.ts, panel-template.ts
 *
 * Exports: buildPanel, buildErrorPanel
 */

import { buildClimbCard } from "./climb-card";
import { buildRouteOverview } from "./route-overview";
import { renderEmptyPanel, renderErrorPanel, renderPanelShell } from "./panel-template";
import { StorageKey, type ScoredAnalysisResult } from "../types";
import { ElementId, CssClass } from "../constants";
import { showClimbRoute, hideClimbRoute } from "./route-highlight";
import { flashPin } from "./map-overlay";
import { requestMapCenter } from "./map-center";

function buildPanelContent(analysisResult: ScoredAnalysisResult): DocumentFragment {
  const { climbs } = analysisResult;

  const frag = document.createDocumentFragment();

  // Route overview and section label are pure data — no inline handlers.
  const staticWrapper = document.createElement("div");
  staticWrapper.innerHTML = buildRouteOverview(analysisResult);
  while (staticWrapper.firstChild) frag.appendChild(staticWrapper.firstChild);

  // Each card element carries its own event listeners (no inline handlers).
  climbs.forEach((climb, i) =>
    frag.appendChild(buildClimbCard(climb, i, analysisResult.routeMode))
  );

  return frag;
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

  let isVisible = true;

  const applyVisibility = (visible: boolean) => {
    eyeIcon.style.display = visible ? "" : "none";
    eyeOffIcon.style.display = visible ? "none" : "";
    layerBtn.classList.toggle("cip-layer-off", !visible);
  };

  chrome.storage.local.get(StorageKey.MapLayerVisible, (pref) => {
    isVisible = (pref[StorageKey.MapLayerVisible] as boolean | undefined) !== false;
    applyVisibility(isVisible);
  });

  layerBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    isVisible = !isVisible;
    chrome.storage.local.set({ [StorageKey.MapLayerVisible]: isVisible });
    applyVisibility(isVisible);
    const overlay = document.getElementById(ElementId.MarkerOverlay);
    if (overlay) overlay.style.display = isVisible ? "" : "none";
  });
}

function wireCardClickHandlers(panel: HTMLElement, analysisResult: ScoredAnalysisResult): void {
  panel.querySelectorAll<HTMLElement>(".climb-item[data-climb-index]").forEach((card) => {
    const idx = card.dataset.climbIndex;
    card.addEventListener("click", () => {
      const index = Number(idx);
      // Centre the map on the climb's summit — the point its pin marks. The
      // overlay is re-rendered once that lands, so the pin is flashed again from
      // the CenterMapDone handler in inject.content.ts; this call covers the
      // case where nothing moves (no coords, or neither map API is reachable).
      requestMapCenter(analysisResult.climbs[index]?.endCoords ?? null, index);
      flashPin(index);
    });
    card.addEventListener("mouseenter", () => {
      const pin = document.querySelector<HTMLElement>(
        `.${CssClass.Pin}[data-climb-index="${idx}"]`
      );
      if (pin) pin.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false }));
      else showClimbRoute(Number(idx));
    });
    card.addEventListener("mouseleave", () => {
      const pin = document.querySelector<HTMLElement>(
        `.${CssClass.Pin}[data-climb-index="${idx}"]`
      );
      if (pin) pin.dispatchEvent(new MouseEvent("mouseleave", { bubbles: false }));
      else hideClimbRoute(Number(idx));
    });
  });
}

/** Build the full sidebar panel element. */
export function buildPanel(analysisResult: ScoredAnalysisResult | null): HTMLElement {
  const panel = document.createElement("div");
  panel.id = ElementId.Panel;

  // The !analysisResult half is a defensive default with no live caller: every
  // call site sets the controller's result first and tryInjectPanel is gated on
  // it. Kept so neither site needs a non-null assertion (#60).
  if (!analysisResult || !analysisResult.climbs || analysisResult.climbs.length === 0) {
    panel.innerHTML = renderEmptyPanel(chrome.runtime.getURL("images/icon-48.png"));
    return panel;
  }

  panel.innerHTML = renderPanelShell(chrome.runtime.getURL("images/icon-48.png"), "");
  panel.querySelector<HTMLElement>(".cip-inner")!.appendChild(buildPanelContent(analysisResult));

  wireCollapseToggle(panel);
  wireLayerToggle(panel);
  wireCardClickHandlers(panel, analysisResult);

  return panel;
}

/**
 * The panel for an analysis that threw. `message` is the exception's own text:
 * it goes into the failure line's `title` and to console.error, never into the
 * rendered markup — see renderErrorPanel.
 */
export function buildErrorPanel(message: string, onRetry: () => void): HTMLElement {
  const panel = document.createElement("div");
  panel.id = ElementId.Panel;
  panel.innerHTML = renderErrorPanel(chrome.runtime.getURL("images/icon-48.png"));

  // Property assignment, not interpolation: an exception string is arbitrary
  // text and must never be parsed as markup on its way into the sidebar.
  panel.querySelector<HTMLElement>(".cip-error")!.title = message;
  console.error("[MapyClimbs] Climb analysis failed:", message);

  panel.querySelector<HTMLButtonElement>(".cip-retry")!.addEventListener("click", onRetry);

  return panel;
}
