/**
 * inject.content entrypoint — Content script (document_idle).
 * SPA lifecycle controller: GPX polling, map overlay, button/panel injection.
 */

import "../map-inject.css";
import { parseGPX } from "../gpx-parser";
import { buildPanel } from "../content/panel";
import { metersToKm } from "../format";
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
          renderMapOverlay();
        }
      );
    }
  );

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
      if (_climbs && visible) renderMapOverlay();
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
        renderMapOverlay();
      }
    }
  }, 150);

  window.addEventListener("resize", () => {
    if (_climbs && isRoutePlannerActive()) renderMapOverlay();
  });
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
          renderMapOverlay();
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
    renderMapOverlay();
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

// ── Map overlay ───────────────────────────────────────────────────────────────

function renderMapOverlay(): void {
  if (!_climbs?.length) return;
  const vp = viewportFromURL();
  if (!vp) return;

  const mb = getMapBounds();

  let overlay = document.getElementById("climb-marker-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "climb-marker-overlay";
    overlay.style.cssText =
      "position:fixed;pointer-events:none;z-index:2147483647;overflow:visible;";
    document.body.appendChild(overlay);
  }
  overlay.style.left = mb.left + "px";
  overlay.style.top = mb.top + "px";
  overlay.style.width = mb.width + "px";
  overlay.style.height = mb.height + "px";
  overlay.innerHTML = "";

  // Respect map layer visibility setting
  chrome.storage.local.get(StorageKey.MapLayerVisible, (pref) => {
    const visible = pref[StorageKey.MapLayerVisible] as boolean | undefined;
    overlay!.style.display = visible === false ? "none" : "";
  });

  const CAT_COLORS: Record<string, string> = {
    HC: "#660000",
    "1": "#B30000",
    "2": "#E65100",
    "3": "#FF9100",
    "4": "#FFD600",
  };

  _climbs.forEach((climb, i) => {
    const color = CAT_COLORS[climb.category] ?? "#6b7280";
    const label =
      `Climb ${i + 1} \u00b7 Cat ${climb.category} \u00b7 ` +
      `${metersToKm(climb.distance)} km +${Math.round(climb.elevation)} m`;

    if (climb.markerCoords) {
      const s = mercatorToPixel(
        climb.markerCoords.lat,
        climb.markerCoords.lon,
        vp.lat,
        vp.lon,
        vp.zoom,
        mb.width,
        mb.height
      );
      if (s.x >= -25 && s.x <= mb.width + 25 && s.y >= -25 && s.y <= mb.height + 25) {
        const pin = document.createElement("div");
        pin.style.cssText =
          `position:absolute;left:${Math.round(s.x - 12)}px;top:${Math.round(s.y - 20)}px;` +
          "pointer-events:auto;cursor:default;filter:drop-shadow(0 3px 6px rgba(0,0,0,0.6));";
        pin.title = label + " (start)";
        pin.innerHTML =
          '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="39" viewBox="0 0 24 39">' +
          `<circle cx="12" cy="24" r="8" fill="${color}" stroke="#000" stroke-width="1.5" stroke-linejoin="round"/>` +
          '<text x="12" y="8" font-size="12" font-weight="bold" fill="#fff" text-anchor="middle" font-family="system-ui,sans-serif"' +
          ` paint-order="stroke" stroke="#000" stroke-width="1.5" opacity="0.8">${i + 1}</text>` +
          "</svg>";
        overlay.appendChild(pin);
      }
    }

    if (climb.endCoords) {
      const e = mercatorToPixel(
        climb.endCoords.lat,
        climb.endCoords.lon,
        vp.lat,
        vp.lon,
        vp.zoom,
        mb.width,
        mb.height
      );
      if (e.x >= -35 && e.x <= mb.width + 35 && e.y >= -40 && e.y <= mb.height + 10) {
        const peak = document.createElement("div");
        peak.style.cssText =
          `position:absolute;left:${Math.round(e.x - 45)}px;top:${Math.round(e.y - 52)}px;` +
          "pointer-events:auto;cursor:default;width:90px;height:105px;";
        peak.title = label + " (end)";
        const catLabel = climb.category === "HC" ? "HC" : "C" + climb.category;
        peak.innerHTML =
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 400">' +
          "<defs>" +
          `<filter id="shadow-${i}" x="-20%" y="-20%" width="150%" height="150%">` +
          '<feOffset dx="4" dy="4" result="offsetblur"/>' +
          '<feComponentTransfer><feFuncA type="linear" slope="0.5"/></feComponentTransfer>' +
          '<feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>' +
          "</filter>" +
          "</defs>" +
          `<g filter="url(#shadow-${i})">` +
          `<path d="M460 320 H177 c-3 0-5-3-4-6 l90-184 112 2 89 182 c1 3-1 6-4 6z" fill="${color}" stroke="#000" stroke-width="8"/>` +
          '<path d="m375 132-15 32-36-29-37 14-23-19 52-106 c2-3 6-3 8 0z" fill="#FFFFFF" stroke="#000" stroke-width="8"/>' +
          `<text x="500" y="280" font-family="Arial, sans-serif" font-weight="900" font-size="160" fill="${color}" stroke="#000" stroke-width="8" style="paint-order: stroke fill;"><tspan>${catLabel}</tspan></text>` +
          "</g>" +
          "</svg>";
        overlay.appendChild(peak);
      }
    }
  });
}

function viewportFromURL(): { lat: number; lon: number; zoom: number } | null {
  const p = new URLSearchParams(location.search);
  const lon = parseFloat(p.get("x") ?? "");
  const lat = parseFloat(p.get("y") ?? "");
  const zoom = parseInt(p.get("z") ?? "", 10);
  if (isNaN(lat) || isNaN(lon) || isNaN(zoom)) return null;
  return { lat, lon, zoom };
}

function mercatorToPixel(
  lat: number,
  lon: number,
  cLat: number,
  cLon: number,
  zoom: number,
  W: number,
  H: number
): { x: number; y: number } {
  const S = 256 * Math.pow(2, zoom);
  const mx = (d: number): number => ((d + 180) / 360) * S;
  const my = (d: number): number => {
    const s = Math.sin((d * Math.PI) / 180);
    return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * S;
  };
  return { x: W / 2 + mx(lon) - mx(cLon), y: H / 2 + my(lat) - my(cLat) };
}

function getMapBounds(): { left: number; top: number; width: number; height: number } {
  const canvases = Array.from(document.querySelectorAll("canvas"));
  if (canvases.length) {
    const best = canvases
      .map((c) => ({ c, r: c.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 200 && r.height > 200)
      .sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height)[0];
    if (best) {
      const { r } = best;
      return {
        left: Math.round(r.left),
        top: Math.round(r.top),
        width: Math.round(r.width),
        height: Math.round(r.height),
      };
    }
  }
  return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
}

// ── MutationObserver ──────────────────────────────────────────────────────────

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

// ── Button injection ──────────────────────────────────────────────────────────

function tryInjectButton(): void {
  if (document.getElementById("climb-inject-button")) return;
  const target = document.querySelector(".route-actions");
  if (!target) return;
  target.appendChild(buildButton());
}

function buildButton(): HTMLDivElement {
  const btn = document.createElement("div");
  btn.id = "climb-inject-button";
  btn.className = "icon-action";
  btn.innerHTML = `
    <button type="button">
      <img src="${chrome.runtime.getURL("images/icon-48.png")}" width="24" height="24" alt="" aria-hidden="true">
      <span>${chrome.i18n.getMessage("panelTitle")}</span>
    </button>`;
  btn.querySelector("button")!.addEventListener("click", onClimbButtonClick);
  return btn;
}

function onClimbButtonClick(): void {
  const exportBtn = findGPXExportButton();
  if (!exportBtn) return;

  const observer = new MutationObserver(() => {
    const saveBtn = document.querySelector<HTMLElement>(".mymaps-dialog__saveBtn");
    if (!saveBtn) return;
    observer.disconnect();

    const dialogRoot = saveBtn.closest<HTMLElement>(".mymaps-dialog__content");
    if (dialogRoot) {
      dialogRoot.style.setProperty("opacity", "0", "important");
      dialogRoot.style.setProperty("pointer-events", "none", "important");
      if (dialogRoot.parentElement) {
        dialogRoot.parentElement.style.setProperty("opacity", "0", "important");
        dialogRoot.parentElement.style.setProperty("pointer-events", "none", "important");
      }
    }

    window.postMessage({ type: "CLIMB_SUPPRESS_DOWNLOAD" }, location.origin);
    saveBtn.click();
  });

  observer.observe(document.body, { childList: true, subtree: true });
  setTimeout(() => observer.disconnect(), 5000);
  (exportBtn as HTMLElement).click();
}

function findGPXExportButton(): Element | null {
  const confirmed = document.querySelector('.icon-action[title="Export"] button');
  if (confirmed) return confirmed;
  const bySvg = document.querySelector("button .icon-export2");
  if (bySvg) return bySvg.closest("button");
  for (const el of Array.from(document.querySelectorAll('button, a, [role="button"]'))) {
    const t = el.textContent?.trim() ?? "";
    if (t === "Export" || t === "GPX" || t === "Export GPX") return el;
  }
  return null;
}
