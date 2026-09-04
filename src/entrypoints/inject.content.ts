/**
 * inject.content entrypoint — Content script (document_idle).
 * SPA lifecycle controller: GPX polling, map overlay, button/panel injection.
 */

import "../map-inject.css";
import { parseGpx } from "../gpx";
import { buildPanel, buildErrorPanel } from "../content/panel";
import { renderMapOverlay, setOverlayVisible, flashPin } from "../content/map-overlay";
import { tryInjectButton, runClimbAnalysis } from "../content/button-injector";
import type { ElevationTuple, ScoringModel } from "../climb-types";
import {
  type ProcessClimbsMessage,
  type ClimbsResponse,
  type CategorizationUpdatedMessage,
  type MapLayerVisibilityMessage,
  type GetTabStateMessage,
  type ClearTabStateMessage,
  type TabStateResponse,
  type ScoredAnalysisResult,
  type StoredAnalysisResult,
  StorageKey,
} from "../types";
import {
  MAPY_MATCHES,
  ElementId,
  MAP_CONTAINER_SELECTORS,
  PageMessage,
  routeClassOf,
  routeClassOrDefault,
} from "../constants";
import { getTabId, getTabStorageKeys } from "../storage";
import { scoreForDisplay } from "../scoring-view";

// ── Timing constants ───────────────────────────────────────────────────────────
/** How often (ms) to check storage for a newly-intercepted GPX file. */
const GPX_POLL_MS = 2000;
/** How often (ms) the SPA-watcher interval checks for URL/planner-state changes. */
const SPA_WATCH_MS = 150;
/**
 * How long (ms) to keep muting pan handling if a centring request goes unanswered.
 *
 * Only a request the page half ignores outright — neither map API reachable — ever
 * reaches this, and then no pan events are in flight either, so erring long is cheap.
 * Erring short is not: it un-mutes mid-nudge and blanks the overlay. The raster nudge
 * takes ~0.5 s in a foreground tab, but a backgrounded tab clamps its timers to ~1 s a
 * step and stretches it to ~10 s, so this sits well clear of the visible case.
 */
const CENTERING_TIMEOUT_MS = 5000;

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
  /**
   * What is on screen: the stored result scored under `scoringModel` and
   * filtered to the categorised climbs. Held rather than derived per render
   * because the overlay re-projects on every pan.
   */
  private analysisResult: ScoredAnalysisResult | null = null;
  /** The same result as stored — measured, with no verdict (#77). Kept so a
   *  scoring-model switch can re-score without touching storage. */
  private measuredResult: StoredAnalysisResult | null = null;
  /** The user's preference. A hiking route overrides it; see scoring-view.ts. */
  private scoringModel: ScoringModel = "aso";
  /**
   * Failed analyses, keyed by route class exactly as
   * `lastAnalysisResult:<tabId>:<routeClass>` is. Per-route because the
   * automation analyses every alternative and only one is on screen, and
   * because clearUI() runs between the failure and the panel that reports it
   * (#60). In-memory only: a reload with no stored result shows no panel
   * either way, so there is nothing to restore.
   */
  private analysisErrors = new Map<string, string>();
  private popupOpen = false;
  /**
   * Capture time of the last GPX handed to analyzeGPX. Deduplicated by *when*
   * the export happened, not by its content length: retry re-exports the route
   * that just failed, so a byte-identical GPX still has to count as a new
   * capture or the analysis never re-runs and the loader never comes down (#60).
   */
  private lastGpxCaptureTime = 0;
  private lastURL = "";
  private lastRoutePlannerVisible = false;
  private lastActiveRoute: string | undefined = undefined;
  private routesWired = false;
  private isAnalyzing = false;
  private isAutomating = false;
  private isCentering = false;
  private centeringTimer: number | null = null;

  // ── Entry point ─────────────────────────────────────────────────────────────

  init(): void {
    const observer = new MutationObserver(() => this.onMutation());
    observer.observe(document.body, { childList: true, subtree: true });
    this.checkPopupOverlap();

    setInterval(() => this.pollForGPX(), GPX_POLL_MS);

    chrome.storage.local.get(StorageKey.ScoringModel, (pref) => {
      const stored = pref[StorageKey.ScoringModel] as ScoringModel | undefined;
      if (stored) this.setScoringModel(stored);
    });

    this.registerMessageListeners();
    this.startSPAWatcher();

    window.addEventListener("resize", () => {
      if (this.analysisResult && this.isRoutePlannerActive()) renderMapOverlay(this.analysisResult);
    });

    this.watchMapInteraction();
    this.watchMapCentering();
  }

  // ── Scoring ──────────────────────────────────────────────────────────────────

  /**
   * Hold a stored result and the scored view of it together, so the ~15 render
   * sites keep reading one field. The engine measures and does not judge (#77),
   * so the verdict every one of them needs is produced here.
   *
   * Returns the scored view as well as storing it, which is what lets the call
   * sites hand it straight to renderMapOverlay without a non-null assertion.
   */
  private setAnalysisResult(stored: StoredAnalysisResult): ScoredAnalysisResult {
    this.measuredResult = stored;
    this.analysisResult = scoreForDisplay(stored, this.scoringModel);
    return this.analysisResult;
  }

  private clearAnalysisResult(): void {
    this.measuredResult = null;
    this.analysisResult = null;
  }

  /** Adopt a new scoring preference and re-score whatever is already held. */
  private setScoringModel(model: ScoringModel): void {
    this.scoringModel = model;
    if (this.measuredResult) this.setAnalysisResult(this.measuredResult);
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

  // ── Programmatic centering ───────────────────────────────────────────────────

  /**
   * Re-projects the overlay after a click-to-center jump.
   *
   * The map cuts straight to the new centre, so there is nothing to settle and
   * nothing to hide. What does need handling is the raster build's nudge (see
   * `injected/map-center.ts`): it is a real pointer gesture on the map, so
   * `watchMapInteraction` would treat it as a user pan, blank the overlay for
   * 350 ms and then re-render over the pin highlight. `isCentering` mutes that
   * for the duration of the jump.
   */
  private watchMapCentering(): void {
    window.addEventListener("message", (event: MessageEvent) => {
      if (event.source !== window || event.origin !== location.origin) return;
      const data = event.data as { type?: string; climbIndex?: number } | null;

      if (data?.type === PageMessage.CenterMap) {
        this.isCentering = true;
        if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
        // Safety net: the page half answers nothing at all when neither map API
        // is reachable, and pans must not stay muted for the rest of the session.
        if (this.centeringTimer) window.clearTimeout(this.centeringTimer);
        this.centeringTimer = window.setTimeout(() => {
          this.isCentering = false;
        }, CENTERING_TIMEOUT_MS);
        return;
      }

      if (data?.type !== PageMessage.CenterMapDone) return;
      if (this.centeringTimer) window.clearTimeout(this.centeringTimer);
      this.isCentering = false;
      if (!this.analysisResult || !this.isRoutePlannerActive()) return;

      renderMapOverlay(this.analysisResult);
      if (!this.popupOpen) setOverlayVisible(true);
      // Claim the URL we just wrote ourselves. Left unclaimed, the SPA watcher
      // reads it as a navigation and re-renders, throwing away the pin below.
      this.lastURL = location.href;
      // Re-rendering replaced the pin element, so the card click's flash is gone.
      if (typeof data.climbIndex === "number") flashPin(data.climbIndex);
    });
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
        // No storage read: the stored result is measured, so a model switch is
        // a re-score of what is already in memory (#77).
        this.setScoringModel(msg.model);
        if (!this.analysisResult) return;
        this.renderPanel();
        renderMapOverlay(this.analysisResult);
      }
    );
  }

  /** The route class currently on screen, as storage and analysisErrors key it. */
  private activeRouteClass(): string {
    return (
      this.lastActiveRoute ??
      routeClassOrDefault(document.querySelector(".route-summary h3.active"))
    );
  }

  private async fetchTabState(
    callback: (response: TabStateResponse | undefined) => void
  ): Promise<void> {
    const tabId = await getTabId();
    const activeRouteClass = this.activeRouteClass();

    const message: GetTabStateMessage = { type: "GET_TAB_STATE", activeRouteClass, tabId };
    chrome.runtime.sendMessage(message, callback);
  }
  private debounceTimer: number | null = null;

  // ── Mouse events watcher ─────────────────────────────────────────────────────
  private handleMapInteraction(): void {
    // The raster nudge is a genuine pointer drag on the map; treating it as a
    // user pan would blank the overlay mid-jump. See watchMapCentering.
    if (this.isCentering) return;
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
      const routeClass = routeClassOf(target.closest("h3"));
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
      const cached = data[keys.lastAnalysisResult] as StoredAnalysisResult | undefined;
      if (cached && this.isResultValid(cached)) {
        const scored = this.setAnalysisResult(cached);
        this.renderPanel();
        renderMapOverlay(scored);
      } else if (this.analysisErrors.has(routeClass)) {
        // clearUI() has just removed the panel and this route cached nothing,
        // so without this the failure leaves an empty sidebar (#60). This is
        // the path the automation itself takes on its way back to the
        // originally-active route.
        this.tryInjectPanel();
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
        const domRoute = routeClassOf(activeH3);
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
      const captureTime = data.captureTime ?? 0;
      const lastAnalysisResult = data.lastAnalysisResult;

      // SCENARIO A: A new GPX file was intercepted but not yet processed
      if (
        this.isAnalyzing &&
        gpxContent &&
        captureTime > this.lastGpxCaptureTime &&
        activeRouteClass
      ) {
        this.lastGpxCaptureTime = captureTime;
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
        // The stored result was fetched for the route on screen, which is not
        // necessarily the one pendingGPX was exported for.
        this.analysisErrors.delete(this.activeRouteClass());
        const scored = this.setAnalysisResult(lastAnalysisResult);
        this.renderPanel();
        if (!this.isAutomating) renderMapOverlay(scored);

        this.isAnalyzing = false; // Stop polling
      }
    });
  }

  /** Helper to validate result structure */
  /**
   * Whether a stored result is worth restoring. `climbs` is the *candidate* set
   * now (#77), so this asks "did detection find anything", not "did the current
   * model keep anything" — which is the better question: a model that
   * categorises none of them should show "no climbs detected", not an empty
   * sidebar, and switching to a permissive one then fills the panel in.
   */
  private isResultValid(result: StoredAnalysisResult): boolean {
    return !!(result && Array.isArray(result.climbs) && result.climbs.length > 0);
  }

  /** Helper to wipe visual elements. Deliberately leaves analysisErrors alone:
   *  the automation restores the original route once it finishes, and the
   *  resulting route change calls this — clearing the map here would wipe the
   *  failure before it was ever shown (#60). */
  private clearUI(): void {
    this.isAutomating = false;
    this.hideFullscreenLoader();
    this.clearAnalysisResult();
    document.getElementById(ElementId.Panel)?.remove();
    const overlay = document.getElementById(ElementId.MarkerOverlay);
    if (overlay) overlay.innerHTML = "";
  }

  // ── Analysis ──────────────────────────────────────────────────────────────────

  private async analyzeGPX(gpxContent: string, activeRouteClass: string): Promise<void> {
    let elevationProfile: ElevationTuple[];
    try {
      elevationProfile = parseGpx(gpxContent).tuples;
    } catch (error) {
      // A malformed export used to leave isAnalyzing stuck true and nothing on
      // screen — the same silent dead end as a detection crash (#60). The
      // reader reports malformed XML and an empty track as one error (#77);
      // the text only reaches the failure line's title, never the markup.
      this.recordAnalysisFailure(
        activeRouteClass,
        error instanceof Error ? error.message : String(error)
      );
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
      // A dead service worker, a detection crash and a missing result are the
      // same dead end from the user's side, so all three land in one place.
      if (chrome.runtime.lastError || response?.error || !response?.result) {
        this.recordAnalysisFailure(
          activeRouteClass,
          chrome.runtime.lastError?.message ??
            response?.error ??
            "The analysis worker returned no result."
        );
        return;
      }
      this.analysisErrors.delete(activeRouteClass);
      const scored = this.setAnalysisResult(response.result);
      this.renderPanel();
      if (!this.isAutomating) renderMapOverlay(scored);
    });
  }

  /**
   * Remember that this route's analysis failed and put the error panel on
   * screen. Keyed by the route the analysis was *for*, not the one showing:
   * during the automation they differ. `analysisResult` is left alone so a
   * later alternative's failure cannot erase an earlier one's good result.
   */
  private recordAnalysisFailure(routeClass: string, message: string): void {
    this.analysisErrors.set(routeClass, message);
    this.isAnalyzing = false;
    if (!this.isAutomating) this.hideFullscreenLoader();
    this.tryInjectPanel();
  }

  /**
   * Re-run the analysis from the panel. This goes through the same export
   * automation as the toolbar button rather than re-analysing the cached GPX:
   * pendingGPX is one key per tab holding the *last* alternative exported, so
   * reusing it after a multi-route run would analyse one route's GPX and store
   * it under another's key.
   */
  private retryAnalysis(): void {
    this.analysisErrors.delete(this.activeRouteClass());
    void runClimbAnalysis(
      (routeClass) => this.handleClimbStart(routeClass),
      () => this.handleAutomationDone()
    );
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

  /**
   * The panel for whatever this route is in: a failure outranks a result, so a
   * crash can never be read as a flat route (#60). Keyed by route class because
   * the automation analyses every alternative and only one is on screen.
   */
  private currentPanel(): HTMLElement {
    const error = this.analysisErrors.get(this.activeRouteClass());
    return error
      ? buildErrorPanel(error, () => this.retryAnalysis())
      : buildPanel(this.analysisResult);
  }

  private renderPanel(): void {
    if (!this.isAutomating) {
      const hadLoader = !!document.getElementById(ElementId.Loader);
      this.hideFullscreenLoader();
      if (hadLoader && this.analysisResult) renderMapOverlay(this.analysisResult);
    }
    const existing = document.getElementById(ElementId.Panel);
    if (existing) existing.replaceWith(this.currentPanel());
  }

  private tryInjectPanel(): void {
    if (document.getElementById(ElementId.Panel)) {
      this.renderPanel();
      return;
    }
    const target =
      document.querySelector(".route-modules") ?? document.querySelector(".route-container");
    if (!target) return;
    target.appendChild(this.currentPanel());
  }

  // ── State & cleanup ───────────────────────────────────────────────────────────

  private async clearRoutePlannerState(): Promise<void> {
    this.clearUI();
    this.analysisErrors.clear();
    this.lastGpxCaptureTime = 0;
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
      this.lastActiveRoute = routeClassOrDefault(activeH3);

      // Trigger an immediate poll now that we have a route ID
      this.pollForGPX();
    }

    if (!document.getElementById(ElementId.Button))
      tryInjectButton(
        (routeClass) => this.handleClimbStart(routeClass),
        () => this.handleAutomationDone()
      );
    if (
      (this.analysisResult || this.analysisErrors.has(this.activeRouteClass())) &&
      !document.getElementById(ElementId.Panel)
    )
      this.tryInjectPanel();
  }
}
