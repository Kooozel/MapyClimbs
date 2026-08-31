/**
 * inject.content entrypoint — Content script (document_idle).
 * SPA lifecycle controller: GPX polling, map overlay, button/panel injection.
 */

import "../map-inject.css";
import { parseGPX } from "../gpx-parser";
import { buildPanel } from "../content/panel";
import { renderMapOverlay, setOverlayVisible } from "../content/map-overlay";
import { tryInjectButton } from "../content/button-injector";
import {
  type ElevationTuple,
  type ProcessClimbsMessage,
  type ClimbsResponse,
  type CategorizationUpdatedMessage,
  type MapLayerVisibilityMessage,
  type GetTabStateMessage,
  type ClearTabStateMessage,
  type TabStateResponse,
  type AnalysisResult,
} from "../types";
import { MAPY_MATCHES, ElementId, MAP_CONTAINER_SELECTORS } from "../constants";
import { getTabId, getTabStorageKeys } from "../storage";

// ── Timing constants ───────────────────────────────────────────────────────────
/** How often (ms) to check storage for a newly-intercepted GPX file. */
const GPX_POLL_MS = 2000;
/** How often (ms) the SPA-watcher interval checks for URL/planner-state changes. */
const SPA_WATCH_MS = 150;

export default defineContentScript({
  matches: [...MAPY_MATCHES],
  runAt: "document_idle",
  cssInjectionMode: "manifest",
  main() {
    new RoutePlannerController().init();
  },
});

// ── State machine ──────────────────────────────────────────────────────────────

/**
 * Encapsulates the mutable lifecycle state for a single content-script
 * execution context. Using a class keeps the state co-located with the
 * methods that read/write it and makes the controller unit-testable
 * (instantiate without the Chrome Extension environment).
 */
class RoutePlannerController {
  private analysisResult: AnalysisResult | null = null;
  private panelInjected = false;
  private popupOpen = false;
  private lastGPXLength = 0;
  private lastURL = "";
  private lastRoutePlannerVisible = false;
  private lastActiveRoute: string | undefined = undefined;
  private routesWired = false;
  private isAnalyzing = false;
  private isAutomating = false;

  // ── Entry point ─────────────────────────────────────────────────────────────

  init(): void {
    // Discard stale cached climbs that pre-date the marker-coords field.

    const observer = new MutationObserver(() => this.onMutation());
    observer.observe(document.body, { childList: true, subtree: true });
    this.checkPopupOverlap();

    setInterval(() => this.pollForGPX(), GPX_POLL_MS);

    this.registerMessageListeners();
    this.startSPAWatcher();

    window.addEventListener("resize", () => {
      if (this.analysisResult && this.isRoutePlannerActive()) renderMapOverlay(this.analysisResult);
    });

    this.watchMapInteraction();
  }

  // ── Map pan/zoom watcher ─────────────────────────────────────────────────────

  /**
   * Wires pan/zoom detection so the overlay can be re-projected once the map
   * settles.
   *
   * Bound on `document` rather than on the map container: the vector build
   * creates its canvas after `document_idle`, so resolving the container once
   * here would miss it. Each listener re-checks that the event actually came
   * from inside the map.
   */
  private watchMapInteraction(): void {
    const selector = MAP_CONTAINER_SELECTORS.join(", ");
    const overMap = (event: Event): boolean =>
      event.target instanceof Element && !!event.target.closest(selector);

    document.addEventListener(
      "wheel",
      (event) => {
        if (overMap(event)) this.handleMapInteraction();
      },
      { passive: true, capture: true }
    );

    // Pointer events, not mouse events: the vector build's canvas calls
    // preventDefault() on pointerdown, which suppresses the compatibility
    // mousedown/mouseup pair entirely, so drags would go undetected.
    document.addEventListener(
      "pointerdown",
      (event) => {
        if (!overMap(event)) return;

        const onPointerMove = () => this.handleMapInteraction();
        const onPointerEnd = () => {
          document.removeEventListener("pointermove", onPointerMove);
          document.removeEventListener("pointerup", onPointerEnd);
          document.removeEventListener("pointercancel", onPointerEnd);
        };

        document.addEventListener("pointermove", onPointerMove, { passive: true });
        document.addEventListener("pointerup", onPointerEnd);
        document.addEventListener("pointercancel", onPointerEnd);
      },
      { passive: true, capture: true }
    );
  }

  // ── Route-planner guard ──────────────────────────────────────────────────────

  private isRoutePlannerActive(): boolean {
    if (!location.href.includes("planovani-trasy")) return false;
    const el = document.querySelector(".route-actions, .route-modules");
    return !!(el && (el as HTMLElement).offsetParent !== null);
  }

  // ── Message listeners ────────────────────────────────────────────────────────

  private registerMessageListeners(): void {
    chrome.runtime.onMessage.addListener(
      (msg: CategorizationUpdatedMessage | MapLayerVisibilityMessage) => {
        if (msg.type === "MAP_LAYER_VISIBILITY_CHANGED") {
          const overlay = document.getElementById(ElementId.MarkerOverlay);
          if (overlay)
            overlay.style.display = (msg as MapLayerVisibilityMessage).visible ? "" : "none";
          return;
        }
        if (msg.type !== "CATEGORIZATION_UPDATED") return;
        this.fetchTabState((data) => {
          if (!data || !data.lastAnalysisResult) return;
          this.analysisResult = data.lastAnalysisResult;
          this.renderPanel();
          renderMapOverlay(this.analysisResult);
        });
      }
    );
  }

  private async fetchTabState(
    callback: (response: TabStateResponse | undefined) => void
  ): Promise<void> {
    const tabId = await getTabId();
    const activeRouteClass =
      this.lastActiveRoute ??
      document
        .querySelector(".route-summary h3.active")
        ?.className.split(" ")
        .find((c) => c.startsWith("alt-")) ??
      "alt-0";

    const message: GetTabStateMessage = { type: "GET_TAB_STATE", activeRouteClass, tabId };
    chrome.runtime.sendMessage(message, callback);
  }
  private debounceTimer: number | null = null;

  // ── Mouse events watcher ─────────────────────────────────────────────────────
  private handleMapInteraction(): void {
    const overlay = document.getElementById(ElementId.MarkerOverlay);
    if (!overlay) return;

    // 1. Hide immediately
    overlay.style.visibility = "hidden";

    // 2. Clear existing timer
    if (this.debounceTimer) window.clearTimeout(this.debounceTimer);

    // 3. Set timer to show it again after movement stops
    this.debounceTimer = window.setTimeout(() => {
      if (this.analysisResult && this.isRoutePlannerActive()) {
        renderMapOverlay(this.analysisResult); // Re-calculate positions
        if (!this.popupOpen) overlay.style.visibility = "visible";
      }
    }, 350); // Adjust delay as needed
  }

  private alternativeRouteListeners(): boolean {
    const container = document.querySelector("#layout-body > div > div.route-summary");
    if (!container) return false;

    container.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      const routeClass =
        target
          .closest("h3")
          ?.className.split(" ")
          .find((c) => c.startsWith("alt-")) ?? null;
      if (routeClass && routeClass !== this.lastActiveRoute) {
        this.lastActiveRoute = routeClass;
        // Delay to allow the active class to update in the DOM
        setTimeout(() => this.handleAlternativeRouteChange(), 100);
      }
    });
    return true;
  }

  private async handleAlternativeRouteChange(): Promise<void> {
    if (this.isAutomating) return;
    const routeClass = this.lastActiveRoute; // Capture before async gap
    if (!routeClass) return;
    this.isAnalyzing = false;
    this.clearUI();

    const tabId = await getTabId();
    const keys = getTabStorageKeys(tabId, routeClass);

    chrome.storage.local.get([keys.lastAnalysisResult], (data) => {
      const cached = data[keys.lastAnalysisResult] as AnalysisResult | undefined;
      if (cached && this.isResultValid(cached)) {
        this.analysisResult = cached;
        this.renderPanel();
        renderMapOverlay(cached);
      }
    });
  }

  // ── SPA watcher ──────────────────────────────────────────────────────────────

  private startSPAWatcher(): void {
    window.addEventListener("popstate", () => this.onRouteChange());
    const origPushState = history.pushState.bind(history);
    history.pushState = (...args: Parameters<typeof history.pushState>): void => {
      origPushState(...args);
      this.onRouteChange();
    };

    setInterval(() => {
      const urlChanged = location.href !== this.lastURL;
      const visible = this.isRoutePlannerActive();

      if (urlChanged) {
        this.lastURL = location.href;
        if (this.analysisResult && visible) renderMapOverlay(this.analysisResult);
      }

      if (this.lastRoutePlannerVisible !== visible) {
        this.lastRoutePlannerVisible = visible;
        if (!visible) {
          const overlay = document.getElementById(ElementId.MarkerOverlay);
          if (overlay) overlay.innerHTML = "";
        } else if (this.analysisResult) {
          renderMapOverlay(this.analysisResult);
        }
      }

      // Fallback: detect active-route changes that the click listener may have missed
      // (e.g. clicking the route path on the map, keyboard navigation).
      if (visible && this.lastActiveRoute !== undefined) {
        const activeH3 = document.querySelector(".route-summary h3.active");
        const domRoute = activeH3?.className.split(" ").find((c) => c.startsWith("alt-"));
        if (domRoute && domRoute !== this.lastActiveRoute) {
          this.lastActiveRoute = domRoute;
          void this.handleAlternativeRouteChange();
        }
      }
    }, SPA_WATCH_MS);
  }

  private onRouteChange(): void {
    void this.clearRoutePlannerState();
    if (this.isRoutePlannerActive()) this.pollForGPX();
  }

  // ── Storage polling ───────────────────────────────────────────────────────────

  private pollForGPX(): void {
    if (!this.isRoutePlannerActive()) return;
    void this.fetchTabState((data) => {
      if (!data) return;

      const { gpxContent, activeRouteClass } = data.pendingGPX || {};
      const lastAnalysisResult = data.lastAnalysisResult;

      // SCENARIO A: A new GPX file was intercepted but not yet processed
      if (
        this.isAnalyzing &&
        gpxContent &&
        gpxContent.length !== this.lastGPXLength &&
        activeRouteClass
      ) {
        this.lastGPXLength = gpxContent.length;
        this.analyzeGPX(gpxContent, activeRouteClass);
        return;
      }

      // SCENARIO B: The background script finished and saved a result.
      // Only render when there is genuinely new data: either nothing is shown
      // yet (null) or an analysis was actively requested (isAnalyzing). This
      // prevents the 2-second poll from rebuilding the panel and resetting the
      // scroll position while the user is browsing the results.
      if (
        lastAnalysisResult &&
        this.isResultValid(lastAnalysisResult) &&
        (!this.analysisResult || this.isAnalyzing)
      ) {
        this.analysisResult = lastAnalysisResult;
        this.renderPanel();
        if (!this.isAutomating) renderMapOverlay(this.analysisResult);

        this.isAnalyzing = false; // Stop polling
      }
    });
  }

  /** Helper to validate result structure */
  private isResultValid(result: AnalysisResult): boolean {
    return !!(result && Array.isArray(result.climbs) && result.climbs.length > 0);
  }

  /** Helper to wipe visual elements */
  private clearUI(): void {
    this.isAutomating = false;
    this.hideFullscreenLoader();
    this.analysisResult = null;
    this.panelInjected = false;
    document.getElementById(ElementId.Panel)?.remove();
    const overlay = document.getElementById(ElementId.MarkerOverlay);
    if (overlay) overlay.innerHTML = "";
  }

  // ── Analysis ──────────────────────────────────────────────────────────────────

  private async analyzeGPX(gpxContent: string, activeRouteClass: string): Promise<void> {
    let elevationProfile: ElevationTuple[];
    try {
      elevationProfile = parseGPX(gpxContent);
    } catch {
      return;
    }
    const tabId = await getTabId();

    const message: ProcessClimbsMessage = {
      type: "PROCESS_CLIMBS",
      elevation: elevationProfile,
      activeRouteClass,
      tabId,
    };

    chrome.runtime.sendMessage(message, (response: ClimbsResponse | undefined) => {
      this.isAnalyzing = false;
      if (chrome.runtime.lastError || !response?.result) {
        if (!this.isAutomating) this.hideFullscreenLoader();
        return;
      }
      this.analysisResult = response.result;
      this.renderPanel();
      if (!this.isAutomating) renderMapOverlay(this.analysisResult);
    });
  }

  private handleClimbStart(routeClass: string): void {
    if (!this.isAutomating) {
      this.isAutomating = true;
      this.showFullscreenLoader();
    }
    this.lastActiveRoute = routeClass;
    this.isAnalyzing = true;
  }

  private handleAutomationDone(): void {
    this.isAutomating = false;
    if (!this.isAnalyzing) {
      this.hideFullscreenLoader();
      if (this.analysisResult) renderMapOverlay(this.analysisResult);
    }
  }

  // ── Fullscreen loader ─────────────────────────────────────────────────────────

  private showFullscreenLoader(): void {
    if (document.getElementById(ElementId.Loader)) return;
    const el = document.createElement("div");
    el.id = ElementId.Loader;
    el.innerHTML = `
      <div class="cip-loader-card">
        <img src="${chrome.runtime.getURL("images/icon-48.png")}" width="32" height="32" alt="" aria-hidden="true">
        <div class="cip-spinner" aria-hidden="true"></div>
        <span>${chrome.i18n.getMessage("panelAnalyzing")}</span>
      </div>`;
    document.body.appendChild(el);
  }

  private hideFullscreenLoader(): void {
    document.getElementById(ElementId.Loader)?.remove();
  }

  // ── Panel ─────────────────────────────────────────────────────────────────────

  private renderPanel(): void {
    if (!this.isAutomating) {
      const hadLoader = !!document.getElementById(ElementId.Loader);
      this.hideFullscreenLoader();
      if (hadLoader && this.analysisResult) renderMapOverlay(this.analysisResult);
    }
    const existing = document.getElementById(ElementId.Panel);
    if (existing) {
      existing.replaceWith(buildPanel(this.analysisResult));
      this.panelInjected = true;
    } else {
      this.panelInjected = false;
    }
  }

  private tryInjectPanel(): void {
    if (document.getElementById(ElementId.Panel)) {
      this.renderPanel();
      return;
    }
    const target =
      document.querySelector(".route-modules") ?? document.querySelector(".route-container");
    if (!target) return;
    target.appendChild(buildPanel(this.analysisResult));
    this.panelInjected = true;
  }

  // ── State & cleanup ───────────────────────────────────────────────────────────

  private async clearRoutePlannerState(): Promise<void> {
    this.clearUI();
    this.lastGPXLength = 0;
    document.getElementById(ElementId.Button)?.remove();
    const tabId = await getTabId();
    const message: ClearTabStateMessage = { type: "CLEAR_TAB_STATE", tabId };
    chrome.runtime.sendMessage(message, () => {
      void chrome.runtime.lastError;
    });
  }

  private checkPopupOverlap(): void {
    const holder = document.querySelector("body > div.mymap-popup-holder") as HTMLElement | null;
    const dialog = document.querySelector("body > div.mymaps-dialog__cover") as HTMLElement | null;
    const dialog2 = document.querySelector("body > div.mymaps-dialog") as HTMLElement | null;
    const holderOpen = holder !== null && holder.children.length > 0;
    const dialogOpen =
      (dialog !== null && dialog.children.length > 0) ||
      (dialog2 !== null && dialog2.children.length > 0);
    // The container element may always be present in the DOM; only treat as
    // open when it actually contains content (i.e. a popup is being shown).
    const popupOpen = holderOpen || dialogOpen;
    if (popupOpen !== this.popupOpen) {
      this.popupOpen = popupOpen;
      setOverlayVisible(!popupOpen);
    }
  }

  private onMutation(): void {
    this.checkPopupOverlap();
    if (!this.isRoutePlannerActive()) {
      void this.clearRoutePlannerState();
      this.routesWired = false;
      this.lastActiveRoute = undefined; // Reset state
      return;
    }

    if (!this.routesWired) {
      this.routesWired = this.alternativeRouteListeners();
    }

    if (this.lastActiveRoute === undefined) {
      const activeH3 = document.querySelector(".route-summary h3.active");
      this.lastActiveRoute =
        activeH3?.className.split(" ").find((c) => c.startsWith("alt-")) ?? "alt-0";

      // Trigger an immediate poll now that we have a route ID
      this.pollForGPX();
    }

    if (!document.getElementById(ElementId.Button))
      tryInjectButton(
        (routeClass) => this.handleClimbStart(routeClass),
        () => this.handleAutomationDone()
      );
    if (this.analysisResult && (!this.panelInjected || !document.getElementById(ElementId.Panel))) {
      this.panelInjected = false;
      this.tryInjectPanel();
    }
  }
}
