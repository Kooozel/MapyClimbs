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
  StorageKey,
  type Climb,
  type ElevationTuple,
  type ProcessClimbsMessage,
  type ClimbsResponse,
  type CategorizationUpdatedMessage,
  type MapLayerVisibilityMessage,
  type GetTabStateMessage,
  type ClearTabStateMessage,
  type TabStateResponse,
} from "../types";
import { MAPY_MATCHES, ElementId } from "../constants";

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
  private climbs: Climb[] | null = null;
  private panelInjected = false;
  private _popupOpen = false;
  private lastGPXLength = 0;
  private totalRouteDistance = 0;
  private lastURL = "";
  private lastRoutePlannerVisible = false;

  // ── Entry point ─────────────────────────────────────────────────────────────

  init(): void {
    // Discard stale cached climbs that pre-date the marker-coords field.
    chrome.storage.local.get([StorageKey.LastClimbResult], (data) => {
      const cached = data[StorageKey.LastClimbResult] as Climb[] | undefined;
      if (cached && Array.isArray(cached) && cached.length > 0 && !cached[0].markerCoords) {
        chrome.storage.local.remove(StorageKey.LastClimbResult);
      }
    });

    const observer = new MutationObserver(() => this.onMutation());
    observer.observe(document.body, { childList: true, subtree: true });
    this.checkPopupOverlap();

    setInterval(() => this.pollForGPX(), GPX_POLL_MS);

    this.registerMessageListeners();
    this.startSPAWatcher();

    window.addEventListener("resize", () => {
      if (this.climbs && this.isRoutePlannerActive()) renderMapOverlay(this.climbs);
    });

    const mapContainer = document.querySelector("#map");

    if (mapContainer) {
      mapContainer.addEventListener("wheel", () => this.handleMapInteraction(), { passive: true });

      // Listen for dragging
      mapContainer.addEventListener("mousedown", () => {
        const onMouseMove = () => this.handleMapInteraction();

        const onMouseUp = () => {
          mapContainer.removeEventListener("mousemove", onMouseMove);
          window.removeEventListener("mouseup", onMouseUp);
        };

        mapContainer.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);
      });
    }
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
          if (!data || !data.lastClimbResult) return;
          this.climbs = data.lastClimbResult;
          this.totalRouteDistance = data.lastTotalDistance ?? this.totalRouteDistance;
          this.renderPanel();
          renderMapOverlay(this.climbs);
        });
      }
    );
  }

  private fetchTabState(callback: (response: TabStateResponse | undefined) => void): void {
    const message: GetTabStateMessage = { type: "GET_TAB_STATE" };
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
      if (this.climbs && this.isRoutePlannerActive()) {
        renderMapOverlay(this.climbs); // Re-calculate positions
        if (!this._popupOpen) overlay.style.visibility = "visible";
      }
    }, 350); // Adjust delay as needed
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
        if (this.climbs && visible) renderMapOverlay(this.climbs);
      }

      if (this.lastRoutePlannerVisible !== visible) {
        this.lastRoutePlannerVisible = visible;
        if (!visible) {
          const overlay = document.getElementById(ElementId.MarkerOverlay);
          if (overlay) overlay.innerHTML = "";
          chrome.storage.local.remove([
            StorageKey.PendingGPX,
            StorageKey.GpxCaptureTime,
            StorageKey.LastClimbResult,
            StorageKey.LastTotalDistance,
          ]);
        } else if (this.climbs) {
          renderMapOverlay(this.climbs);
        }
      }
    }, SPA_WATCH_MS);
  }

  private onRouteChange(): void {
    this.clearRoutePlannerState();
    if (this.isRoutePlannerActive()) this.pollForGPX();
  }

  // ── Storage polling ───────────────────────────────────────────────────────────

  private pollForGPX(): void {
    this.fetchTabState((data) => {
      if (!this.isRoutePlannerActive() || !data) return;

      const pendingGPX = data.pendingGPX;
      const lastClimbResult = data.lastClimbResult;
      const lastTotalDistance = data.lastTotalDistance;

      if (pendingGPX && pendingGPX.length !== this.lastGPXLength) {
        this.lastGPXLength = pendingGPX.length;
        this.analyzeGPX(pendingGPX);
        return;
      }

      if (pendingGPX && lastClimbResult && !this.climbs) {
        if (
          Array.isArray(lastClimbResult) &&
          lastClimbResult.length > 0 &&
          lastClimbResult[0].markerCoords
        ) {
          this.climbs = lastClimbResult;
          this.totalRouteDistance = lastTotalDistance ?? 0;
          this.renderPanel();
          renderMapOverlay(this.climbs);
        }
      }
    });
  }

  // ── Analysis ──────────────────────────────────────────────────────────────────

  private analyzeGPX(gpxContent: string): void {
    let elevationProfile: ElevationTuple[];
    try {
      elevationProfile = parseGPX(gpxContent);
    } catch {
      return;
    }

    const message: ProcessClimbsMessage = { type: "PROCESS_CLIMBS", elevation: elevationProfile };
    chrome.runtime.sendMessage(message, (response: ClimbsResponse | undefined) => {
      if (chrome.runtime.lastError || !response?.climbs) return;
      this.climbs = response.climbs;
      this.totalRouteDistance = response.totalDistance ?? 0;
      this.renderPanel();
      renderMapOverlay(this.climbs);
    });
  }

  // ── Panel ─────────────────────────────────────────────────────────────────────

  private renderPanel(): void {
    const existing = document.getElementById(ElementId.Panel);
    if (existing) {
      existing.replaceWith(buildPanel(this.climbs, this.totalRouteDistance));
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
    target.appendChild(buildPanel(this.climbs, this.totalRouteDistance));
    this.panelInjected = true;
  }

  // ── State & cleanup ───────────────────────────────────────────────────────────

  private clearRoutePlannerState(): void {
    this.climbs = null;
    this.panelInjected = false;
    this.lastGPXLength = 0;
    this.totalRouteDistance = 0;
    document.getElementById(ElementId.Button)?.remove();
    document.getElementById(ElementId.Panel)?.remove();
    const overlay = document.getElementById(ElementId.MarkerOverlay);
    if (overlay) overlay.innerHTML = "";

    const message: ClearTabStateMessage = { type: "CLEAR_TAB_STATE" };
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
    if (popupOpen !== this._popupOpen) {
      this._popupOpen = popupOpen;
      setOverlayVisible(!popupOpen);
    }
  }

  private onMutation(): void {
    this.checkPopupOverlap();
    if (!this.isRoutePlannerActive()) {
      this.clearRoutePlannerState();
      return;
    }
    if (!document.getElementById(ElementId.Button)) tryInjectButton();
    if (this.climbs && (!this.panelInjected || !document.getElementById(ElementId.Panel))) {
      this.panelInjected = false;
      this.tryInjectPanel();
    }
  }
}
