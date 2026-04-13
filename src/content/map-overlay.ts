import { metersToKm } from "../format";
import { StorageKey, type Climb } from "../types";
import { CATEGORY_COLOR } from "./category";
import { ElementId, CssClass } from "../constants";
import { mercatorToPixel, getMapBounds } from "../map-geometry";

// ── Local rendering constants ─────────────────────────────────────────────────

const GLOW_FILTER_ID = "climb-glow-filter";
const GLOW_STD_DEV = 4;
const GLOW_STROKE_WIDTH = 10;
const GLOW_OPACITY = 0.45;
const LINE_STROKE_WIDTH = 5;
const LINE_OPACITY = 0.92;
const PIN_SIZE = 28;
/** Duration (ms) of the card-flash highlight triggered by clicking a map pin. */
const CARD_FLASH_MS = 1500;
/** Duration (ms) of the route polyline draw animation. */
const ROUTE_ANIM_MS = 900;

export function renderMapOverlay(climbs: Climb[]): void {
  if (!climbs?.length) return;
  const vp = viewportFromURL();
  if (!vp) return;

  const mb = getMapBounds();

  let overlay = document.getElementById(ElementId.MarkerOverlay);
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = ElementId.MarkerOverlay;
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
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.id = ElementId.RouteSvg;
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  svg.style.cssText =
    "position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:visible;";

  // Glow blur filter
  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  const filter = document.createElementNS("http://www.w3.org/2000/svg", "filter");
  filter.id = GLOW_FILTER_ID;
  filter.setAttribute("x", "-50%");
  filter.setAttribute("y", "-50%");
  filter.setAttribute("width", "200%");
  filter.setAttribute("height", "200%");
  const blur = document.createElementNS("http://www.w3.org/2000/svg", "feGaussianBlur");
  blur.setAttribute("in", "SourceGraphic");
  blur.setAttribute("stdDeviation", String(GLOW_STD_DEV));
  filter.appendChild(blur);
  defs.appendChild(filter);
  svg.appendChild(defs);

  climbs.forEach((climb, i) => {
    const color = CATEGORY_COLOR[climb.category];
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
    glow.classList.add(CssClass.RouteGlow);
    glow.dataset.climbIndex = String(i);
    glow.setAttribute("points", pointsStr);
    glow.setAttribute("stroke", color);
    glow.setAttribute("stroke-width", String(GLOW_STROKE_WIDTH));
    glow.setAttribute("stroke-linecap", "round");
    glow.setAttribute("stroke-linejoin", "round");
    glow.setAttribute("fill", "none");
    glow.setAttribute("opacity", String(GLOW_OPACITY));
    glow.setAttribute("filter", `url(#${GLOW_FILTER_ID})`);
    glow.style.visibility = "hidden";
    svg.appendChild(glow);

    // Sharp line on top
    const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    line.classList.add(CssClass.RouteLine);
    line.dataset.climbIndex = String(i);
    line.setAttribute("points", pointsStr);
    line.setAttribute("stroke", color);
    line.setAttribute("stroke-width", String(LINE_STROKE_WIDTH));
    line.setAttribute("stroke-linecap", "round");
    line.setAttribute("stroke-linejoin", "round");
    line.setAttribute("fill", "none");
    line.setAttribute("opacity", String(LINE_OPACITY));
    line.style.visibility = "hidden";
    svg.appendChild(line);
  });

  overlay.appendChild(svg);

  // Pre-compute dash lengths after SVG is in DOM
  svg.querySelectorAll<SVGGeometryElement>(`polyline.${CssClass.RouteLine}`).forEach((line) => {
    const len = line.getTotalLength();
    line.style.strokeDasharray = String(len);
    line.style.strokeDashoffset = String(len);
    const idx = (line as SVGElement & { dataset: DOMStringMap }).dataset.climbIndex!;
    const glow = svg.querySelector<SVGGeometryElement>(
      `polyline.${CssClass.RouteGlow}[data-climb-index="${idx}"]`
    );
    if (glow) {
      glow.style.strokeDasharray = String(len);
      glow.style.strokeDashoffset = String(len);
    }
  });
}

function showClimbRoute(index: number): void {
  const svg = document.getElementById(ElementId.RouteSvg);
  if (!svg) return;
  const line = svg.querySelector<SVGGeometryElement>(
    `polyline.${CssClass.RouteLine}[data-climb-index="${index}"]`
  );
  const glow = svg.querySelector<SVGGeometryElement>(
    `polyline.${CssClass.RouteGlow}[data-climb-index="${index}"]`
  );
  if (!line) return;

  const len = parseFloat(line.style.strokeDasharray || "0") || line.getTotalLength();

  [line, glow].forEach((el) => {
    if (!el) return;
    el.style.visibility = "visible";
    el.style.strokeDasharray = String(len);
    el.style.strokeDashoffset = String(len);
    el.animate([{ strokeDashoffset: String(len) }, { strokeDashoffset: "0" }], {
      duration: ROUTE_ANIM_MS,
      easing: "ease-out",
      fill: "forwards",
    });
  });
}

function hideClimbRoute(index: number): void {
  const svg = document.getElementById(ElementId.RouteSvg);
  if (!svg) return;
  svg.querySelectorAll<SVGElement>(`polyline[data-climb-index="${index}"]`).forEach((el) => {
    el.getAnimations().forEach((a) => a.cancel());
    el.style.visibility = "hidden";
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
