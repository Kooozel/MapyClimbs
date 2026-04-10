/**
 * inject.content entrypoint — Content script (document_idle).
 * SPA lifecycle controller: GPX polling, map overlay, button/panel injection.
 */

import "../map-inject.css";
import { parseGPX } from "../gpx-parser";
import { buildPanel } from "../content/panel";
import { getCategoryColor } from "../content/category";
import { renderMapOverlay } from "../content/map-overlay";
import { tryInjectButton } from "../content/button-injector";
import {
  StorageKey,
  type Climb,
  type ElevationTuple,
  type ProcessClimbsMessage,
  type ClimbsResponse,
  type CategorizationUpdatedMessage,
  type MapLayerVisibilityMessage,
} from "../types";

const MAPY_MATCHES = [
  "https://mapy.cz/*",
  "https://*.mapy.cz/*",
  "https://mapy.com/*",
  "https://*.mapy.com/*",
] as const;

// ── Module state ───────────────────────────────────────────────────────────────

let _climbs: Climb[] | null = null;
let _panelInjected = false;
let _lastGPXLength = 0;
let _totalRouteDistance = 0;

export default defineContentScript({
  matches: [...MAPY_MATCHES],
  runAt: "document_idle",
  cssInjectionMode: "manifest",
  main() {
    init();
  },
});

// ── Route-planner guard ────────────────────────────────────────────────────────

function isRoutePlannerActive(): boolean {
  if (!location.href.includes("planovani-trasy")) return false;
  const el = document.querySelector(".route-actions, .route-modules");
  return !!(el && (el as HTMLElement).offsetParent !== null);
}

// ── Entry point ────────────────────────────────────────────────────────────────

function init(): void {
  chrome.storage.local.get([StorageKey.LastClimbResult], (data) => {
    const cached = data[StorageKey.LastClimbResult] as Climb[] | undefined;
    if (cached && Array.isArray(cached) && cached.length > 0 && !cached[0].markerCoords) {
      chrome.storage.local.remove(StorageKey.LastClimbResult);
    }
  });

  const observer = new MutationObserver(onMutation);
  observer.observe(document.body, { childList: true, subtree: true });

  setInterval(pollForGPX, 2000);

  registerMessageListeners();
  startSPAWatcher();

  window.addEventListener("resize", () => {
    if (_climbs && isRoutePlannerActive()) renderMapOverlay(_climbs);
  });
}

function registerMessageListeners(): void {
  // Re-render when the scoring model changes (background sends this after
  // recategorising stored climbs — no full re-detection needed).
  chrome.runtime.onMessage.addListener(
    (msg: CategorizationUpdatedMessage | MapLayerVisibilityMessage) => {
      if (msg.type === "MAP_LAYER_VISIBILITY_CHANGED") {
        const overlay = document.getElementById("climb-marker-overlay");
        if (overlay)
          overlay.style.display = (msg as MapLayerVisibilityMessage).visible ? "" : "none";
        return;
      }
      if (msg.type !== "CATEGORIZATION_UPDATED") return;
      chrome.storage.local.get(
        [StorageKey.LastClimbResult, StorageKey.LastTotalDistance],
        (data) => {
          const updated = data[StorageKey.LastClimbResult] as Climb[] | undefined;
          const dist = data[StorageKey.LastTotalDistance] as number | undefined;
          if (!updated) return;
          _climbs = updated;
          _totalRouteDistance = dist ?? _totalRouteDistance;
          renderPanel();
          renderMapOverlay(_climbs);
        }
      );
    }
  );
}

function startSPAWatcher(): void {
  window.addEventListener("popstate", onRouteChange);
  const _origPushState = history.pushState.bind(history);
  history.pushState = function (...args: Parameters<typeof history.pushState>): void {
    _origPushState(...args);
    onRouteChange();
  };

  let _lastURL = "";
  let _lastRoutePlannerVisible = false;
  setInterval(() => {
    const urlChanged = location.href !== _lastURL;
    const visible = isRoutePlannerActive();

    if (urlChanged) {
      _lastURL = location.href;
      if (_climbs && visible) renderMapOverlay(_climbs);
    }

    if (_lastRoutePlannerVisible !== visible) {
      _lastRoutePlannerVisible = visible;
      if (!visible) {
        const overlay = document.getElementById("climb-marker-overlay");
        if (overlay) overlay.innerHTML = "";
        chrome.storage.local.remove([
          StorageKey.PendingGPX,
          StorageKey.GpxCaptureTime,
          StorageKey.LastClimbResult,
          StorageKey.LastTotalDistance,
        ]);
      } else if (_climbs) {
        renderMapOverlay(_climbs);
      }
    }
  }, 150);
}

function onRouteChange(): void {
  clearRoutePlannerState();
  if (isRoutePlannerActive()) pollForGPX();
}

// ── Storage polling ────────────────────────────────────────────────────────────

function pollForGPX(): void {
  chrome.storage.local.get(
    [StorageKey.PendingGPX, StorageKey.LastClimbResult, StorageKey.LastTotalDistance],
    (data) => {
      if (!isRoutePlannerActive()) return;

      const pendingGPX = data[StorageKey.PendingGPX] as string | undefined;
      const lastClimbResult = data[StorageKey.LastClimbResult] as Climb[] | undefined;
      const lastTotalDistance = data[StorageKey.LastTotalDistance] as number | undefined;

      if (pendingGPX && pendingGPX.length !== _lastGPXLength) {
        _lastGPXLength = pendingGPX.length;
        analyzeGPX(pendingGPX);
        return;
      }

      if (pendingGPX && lastClimbResult && !_climbs) {
        if (
          Array.isArray(lastClimbResult) &&
          lastClimbResult.length > 0 &&
          lastClimbResult[0].markerCoords
        ) {
          _climbs = lastClimbResult;
          _totalRouteDistance = lastTotalDistance ?? 0;
          renderPanel();
          renderMapOverlay(_climbs);
        }
      }
    }
  );
}

// ── Analysis ──────────────────────────────────────────────────────────────────

function analyzeGPX(gpxContent: string): void {
  let elevationProfile: ElevationTuple[];
  try {
    elevationProfile = parseGPX(gpxContent);
  } catch {
    return;
  }

  const message: ProcessClimbsMessage = { type: "PROCESS_CLIMBS", elevation: elevationProfile };
  chrome.runtime.sendMessage(message, (response: ClimbsResponse | undefined) => {
    if (chrome.runtime.lastError || !response?.climbs) return;
    _climbs = response.climbs;
    _totalRouteDistance = response.totalDistance ?? 0;
    renderPanel();
    renderMapOverlay(_climbs);
  });
}

// ── Panel ─────────────────────────────────────────────────────────────────────

function renderPanel(): void {
  const existing = document.getElementById("climb-inject-panel");
  if (existing) {
    existing.replaceWith(buildPanel(_climbs, _totalRouteDistance));
    _panelInjected = true;
  } else {
    _panelInjected = false;
  }
}

function tryInjectPanel(): void {
  if (document.getElementById("climb-inject-panel")) {
    renderPanel();
    return;
  }
  const target =
    document.querySelector(".route-modules") ?? document.querySelector(".route-container");
  if (!target) return;
  target.appendChild(buildPanel(_climbs, _totalRouteDistance));
  _panelInjected = true;
}

// ── State & cleanup ───────────────────────────────────────────────────────────

function clearRoutePlannerState(): void {
  _climbs = null;
  _panelInjected = false;
  _lastGPXLength = 0;
  _totalRouteDistance = 0;
  document.getElementById("climb-inject-button")?.remove();
  document.getElementById("climb-inject-panel")?.remove();
  const overlay = document.getElementById("climb-marker-overlay");
  if (overlay) overlay.innerHTML = "";
  chrome.storage.local.remove([
    StorageKey.PendingGPX,
    StorageKey.GpxCaptureTime,
    StorageKey.LastClimbResult,
    StorageKey.LastTotalDistance,
  ]);
}

function onMutation(): void {
  if (!isRoutePlannerActive()) {
    clearRoutePlannerState();
    return;
  }
  if (!document.getElementById("climb-inject-button")) tryInjectButton();
  if (_climbs && (!_panelInjected || !document.getElementById("climb-inject-panel"))) {
    _panelInjected = false;
    tryInjectPanel();
  }
}
