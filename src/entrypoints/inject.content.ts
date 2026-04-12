/**
 * inject.content entrypoint — Content script (document_idle).
 * SPA lifecycle controller: GPX polling, map overlay, button/panel injection.
 */

import "../map-inject.css";
import { parseGPX } from "../gpx-parser";
import { buildPanel } from "../content/panel";
<<<<<<< HEAD
import { renderMapOverlay } from "../content/map-overlay";
import { tryInjectButton } from "../content/button-injector";
=======
import { getCategoryColor } from "../content/category";
import { metersToKm } from "../format";
import { initShareDialogWatcher } from "../content/share-inject";
>>>>>>> f1f06c0 (feat: add share button)
import {
  StorageKey,
  type Climb,
  type ElevationTuple,
  type ProcessClimbsMessage,
  type ClimbsResponse,
  type CategorizationUpdatedMessage,
  type MapLayerVisibilityMessage,
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
  private lastGPXLength = 0;
  private totalRouteDistance = 0;
  private lastURL = "";
  private lastRoutePlannerVisible = false;

  // ── Entry point ─────────────────────────────────────────────────────────────

<<<<<<< HEAD
  init(): void {
    // Discard stale cached climbs that pre-date the marker-coords field.
    chrome.storage.local.get([StorageKey.LastClimbResult], (data) => {
      const cached = data[StorageKey.LastClimbResult] as Climb[] | undefined;
      if (cached && Array.isArray(cached) && cached.length > 0 && !cached[0].markerCoords) {
        chrome.storage.local.remove(StorageKey.LastClimbResult);
      }
    });
=======
function init(): void {
  chrome.storage.local.get([StorageKey.LastClimbResult], (data) => {
    const cached = data[StorageKey.LastClimbResult] as Climb[] | undefined;
    if (cached && Array.isArray(cached) && cached.length > 0 && !cached[0].markerCoords) {
      chrome.storage.local.remove(StorageKey.LastClimbResult);
    }
  });

  const observer = new MutationObserver(onMutation);
  observer.observe(document.body, { childList: true, subtree: true });

  initShareDialogWatcher(() => _climbs);

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

  _climbs.forEach((climb, i) => {
    const color = getCategoryColor(climb.category);
    const label =
      `Climb ${i + 1} \u00b7 Cat ${climb.category} \u00b7 ` +
      `${metersToKm(climb.distance)} km +${Math.round(climb.elevation)} m`;

    if (climb.endCoords) {
      const s = mercatorToPixel(
        climb.endCoords.lat,
        climb.endCoords.lon,
        vp.lat,
        vp.lon,
        vp.zoom,
        mb.width,
        mb.height
      );
      if (s.x >= -14 && s.x <= mb.width + 14 && s.y >= -14 && s.y <= mb.height + 14) {
        const pin = document.createElement("div");
        pin.className = "climb-pin";
        pin.dataset.climbIndex = String(i);
        pin.style.cssText =
          `position:absolute;left:${Math.round(s.x - 14)}px;top:${Math.round(s.y - 14)}px;` +
          "pointer-events:auto;cursor:pointer;";
        pin.title = label;
        pin.innerHTML =
          '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">' +
          `<circle cx="14" cy="14" r="13" fill="${color}" stroke="#fff" stroke-width="2"/>` +
          `<text x="14" y="14" dy="0.35em" font-size="12" font-weight="bold" fill="#fff" text-anchor="middle" font-family="system-ui,sans-serif">${i + 1}</text>` +
          "</svg>";
        pin.addEventListener("click", () => {
          const toggleBtn = document.querySelector<HTMLButtonElement>(
            "#climb-inject-panel .cip-toggle"
          );
          if (toggleBtn && toggleBtn.getAttribute("aria-expanded") === "false") {
            toggleBtn.click();
          }
          const card = document.getElementById(`climb-card-${i}`);
          if (card) {
            requestAnimationFrame(() => {
              card.scrollIntoView({ behavior: "smooth", block: "nearest" });
              card.classList.remove("card-flash");
              void (card as HTMLElement).offsetWidth;
              card.classList.add("card-flash");
              setTimeout(() => card.classList.remove("card-flash"), 1500);
            });
          }
        });
        pin.addEventListener("mouseenter", () => showClimbRoute(i));
        pin.addEventListener("mouseleave", () => hideClimbRoute(i));
        overlay.appendChild(pin);
      }
    }
  });

  // ── Polyline SVG layer ──────────────────────────────────────────────────
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.id = "climb-route-svg";
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  svg.style.cssText =
    "position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:visible;";

  // Glow blur filter
  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  const filter = document.createElementNS("http://www.w3.org/2000/svg", "filter");
  filter.id = "climb-glow-filter";
  filter.setAttribute("x", "-50%");
  filter.setAttribute("y", "-50%");
  filter.setAttribute("width", "200%");
  filter.setAttribute("height", "200%");
  const blur = document.createElementNS("http://www.w3.org/2000/svg", "feGaussianBlur");
  blur.setAttribute("in", "SourceGraphic");
  blur.setAttribute("stdDeviation", "4");
  filter.appendChild(blur);
  defs.appendChild(filter);
  svg.appendChild(defs);

  _climbs.forEach((climb, i) => {
    const color = getCategoryColor(climb.category);
    const pts: string[] = [];
    for (const seg of climb.segments) {
      if (seg.startLat != null && seg.startLon != null) {
        const p = mercatorToPixel(
          seg.startLat,
          seg.startLon,
          vp.lat,
          vp.lon,
          vp.zoom,
          mb.width,
          mb.height
        );
        pts.push(`${Math.round(p.x)},${Math.round(p.y)}`);
      }
    }
    const last = climb.segments[climb.segments.length - 1];
    if (last && last.endLat != null && last.endLon != null) {
      const p = mercatorToPixel(
        last.endLat,
        last.endLon,
        vp.lat,
        vp.lon,
        vp.zoom,
        mb.width,
        mb.height
      );
      pts.push(`${Math.round(p.x)},${Math.round(p.y)}`);
    }
    if (pts.length < 2) return;

    const pointsStr = pts.join(" ");

    // Glow layer (blurred, wider, behind)
    const glow = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    glow.classList.add("climb-route-glow");
    glow.dataset.climbIndex = String(i);
    glow.setAttribute("points", pointsStr);
    glow.setAttribute("stroke", color);
    glow.setAttribute("stroke-width", "10");
    glow.setAttribute("stroke-linecap", "round");
    glow.setAttribute("stroke-linejoin", "round");
    glow.setAttribute("fill", "none");
    glow.setAttribute("opacity", "0.45");
    glow.setAttribute("filter", "url(#climb-glow-filter)");
    glow.style.visibility = "hidden";
    svg.appendChild(glow);

    // Sharp line on top
    const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    line.classList.add("climb-route-line");
    line.dataset.climbIndex = String(i);
    line.setAttribute("points", pointsStr);
    line.setAttribute("stroke", color);
    line.setAttribute("stroke-width", "5");
    line.setAttribute("stroke-linecap", "round");
    line.setAttribute("stroke-linejoin", "round");
    line.setAttribute("fill", "none");
    line.setAttribute("opacity", "0.92");
    line.style.visibility = "hidden";
    svg.appendChild(line);
  });

  overlay.appendChild(svg);

  // Pre-compute dash lengths after SVG is in DOM
  svg.querySelectorAll<SVGGeometryElement>("polyline.climb-route-line").forEach((line) => {
    const len = line.getTotalLength();
    line.style.strokeDasharray = String(len);
    line.style.strokeDashoffset = String(len);
    const idx = (line as SVGElement & { dataset: DOMStringMap }).dataset.climbIndex!;
    const glow = svg.querySelector<SVGGeometryElement>(
      `polyline.climb-route-glow[data-climb-index="${idx}"]`
    );
    if (glow) {
      glow.style.strokeDasharray = String(len);
      glow.style.strokeDashoffset = String(len);
    }
  });
}

function showClimbRoute(index: number): void {
  const svg = document.getElementById("climb-route-svg");
  if (!svg) return;
  const line = svg.querySelector<SVGGeometryElement>(
    `polyline.climb-route-line[data-climb-index="${index}"]`
  );
  const glow = svg.querySelector<SVGGeometryElement>(
    `polyline.climb-route-glow[data-climb-index="${index}"]`
  );
  if (!line) return;

  const len = parseFloat(line.style.strokeDasharray || "0") || line.getTotalLength();

  let lineAnim: Animation | undefined;
  [line, glow].forEach((el) => {
    if (!el) return;
    el.style.visibility = "visible";
    el.style.strokeDasharray = String(len);
    el.style.strokeDashoffset = String(len);
    const anim = el.animate([{ strokeDashoffset: String(len) }, { strokeDashoffset: "0" }], {
      duration: 900,
      easing: "ease-out",
      fill: "forwards",
    });
    if (el === line) lineAnim = anim;
  });

  lineAnim?.finished
    .then(() => {
      const pin = document.querySelector<HTMLElement>(`.climb-pin[data-climb-index="${index}"]`);
      if (pin) {
        pin.classList.remove("pin-active");
        void pin.offsetWidth;
        pin.classList.add("pin-active");
        setTimeout(() => pin.classList.remove("pin-active"), 600);
      }
    })
    .catch(() => {
      /* animation cancelled on mouseleave — no-op */
    });
}
>>>>>>> f1f06c0 (feat: add share button)

    const observer = new MutationObserver(() => this.onMutation());
    observer.observe(document.body, { childList: true, subtree: true });

    setInterval(() => this.pollForGPX(), GPX_POLL_MS);

    this.registerMessageListeners();
    this.startSPAWatcher();

    window.addEventListener("resize", () => {
      if (this.climbs && this.isRoutePlannerActive()) renderMapOverlay(this.climbs);
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
        chrome.storage.local.get(
          [StorageKey.LastClimbResult, StorageKey.LastTotalDistance],
          (data) => {
            const updated = data[StorageKey.LastClimbResult] as Climb[] | undefined;
            const dist = data[StorageKey.LastTotalDistance] as number | undefined;
            if (!updated) return;
            this.climbs = updated;
            this.totalRouteDistance = dist ?? this.totalRouteDistance;
            this.renderPanel();
            renderMapOverlay(this.climbs);
          }
        );
      }
    );
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
    chrome.storage.local.get(
      [StorageKey.PendingGPX, StorageKey.LastClimbResult, StorageKey.LastTotalDistance],
      (data) => {
        if (!this.isRoutePlannerActive()) return;

        const pendingGPX = data[StorageKey.PendingGPX] as string | undefined;
        const lastClimbResult = data[StorageKey.LastClimbResult] as Climb[] | undefined;
        const lastTotalDistance = data[StorageKey.LastTotalDistance] as number | undefined;

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
      }
    );
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
    chrome.storage.local.remove([
      StorageKey.PendingGPX,
      StorageKey.GpxCaptureTime,
      StorageKey.LastClimbResult,
      StorageKey.LastTotalDistance,
    ]);
  }

  private onMutation(): void {
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
