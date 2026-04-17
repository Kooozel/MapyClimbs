import { metersToKm } from "../format";
import { StorageKey, type Climb } from "../types";
import { CATEGORY_COLOR } from "./category";
import { ElementId, CssClass } from "../constants";
import { mercatorToPixel } from "../map-geometry";
import {
  createRouteSvg,
  initRouteDashLengths,
  showClimbRoute,
  hideClimbRoute,
} from "./route-highlight";

// ── Local rendering constants ─────────────────────────────────────────────────

const PIN_SIZE = 28;
/** Duration (ms) of the card-flash highlight triggered by clicking a map pin. */
const CARD_FLASH_MS = 1500;

export function renderMapOverlay(climbs: Climb[]): void {
  if (!climbs?.length) return;
  const vp = viewportFromURL();
  if (!vp) return;

  const mapContainer = document.querySelector("#map");
  if (!mapContainer) return;

  let overlay = document.getElementById(ElementId.MarkerOverlay);
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = ElementId.MarkerOverlay;
    overlay.style.cssText =
      "position:fixed;pointer-events:none;z-index:2147483647;overflow:visible;";
    document.body.appendChild(overlay);
  }
  const mb = mapContainer.getBoundingClientRect();
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

  climbs.forEach((climb, i) => {
    const color = CATEGORY_COLOR[climb.category];
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
        pin.className = CssClass.Pin;
        pin.dataset.climbIndex = String(i);
        pin.style.cssText =
          `position:absolute;left:${Math.round(s.x - 14)}px;top:${Math.round(s.y - 14)}px;` +
          "pointer-events:auto;cursor:pointer;";
        pin.title = label;
        pin.setAttribute("role", "button");
        pin.tabIndex = 0;
        pin.setAttribute("aria-label", label);
        pin.innerHTML =
          `<svg xmlns="http://www.w3.org/2000/svg" width="${PIN_SIZE}" height="${PIN_SIZE}" viewBox="0 0 ${PIN_SIZE} ${PIN_SIZE}">` +
          `<circle cx="14" cy="14" r="13" fill="${color}" stroke="#fff" stroke-width="2"/>` +
          `<text x="14" y="14" dy="0.35em" font-size="12" font-weight="bold" fill="#fff" text-anchor="middle" font-family="system-ui,sans-serif">${i + 1}</text>` +
          "</svg>";
        const activatePin = () => {
          const toggleBtn = document.querySelector<HTMLButtonElement>(
            `#${ElementId.Panel} .cip-toggle`
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
              setTimeout(() => card.classList.remove("card-flash"), CARD_FLASH_MS);
            });
          }
        };
        pin.addEventListener("click", activatePin);
        pin.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            activatePin();
          }
        });
        pin.addEventListener("mouseenter", () => showClimbRoute(i));
        pin.addEventListener("mouseleave", () => hideClimbRoute(i));
        pin.addEventListener("focus", () => showClimbRoute(i));
        pin.addEventListener("blur", () => hideClimbRoute(i));
        overlay.appendChild(pin);
      }
    }
  });

  // ── Polyline SVG layer ──────────────────────────────────────────────────
  const svg = createRouteSvg(climbs, vp, mb);
  overlay.appendChild(svg);
  initRouteDashLengths(svg);
}

function viewportFromURL(): { lat: number; lon: number; zoom: number } | null {
  const p = new URLSearchParams(location.search);
  const lon = parseFloat(p.get("x") ?? "");
  const lat = parseFloat(p.get("y") ?? "");
  const zoom = parseInt(p.get("z") ?? "", 10);
  if (isNaN(lat) || isNaN(lon) || isNaN(zoom)) return null;
  return { lat, lon, zoom };
}
