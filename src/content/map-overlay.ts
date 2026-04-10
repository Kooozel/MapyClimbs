import { metersToKm } from "../format";
import { StorageKey, type Climb } from "../types";
import { CATEGORY_COLOR } from "./category";

export function renderMapOverlay(climbs: Climb[]): void {
  if (!climbs?.length) return;
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

  [line, glow].forEach((el) => {
    if (!el) return;
    el.style.visibility = "visible";
    el.style.strokeDasharray = String(len);
    el.style.strokeDashoffset = String(len);
    el.animate([{ strokeDashoffset: String(len) }, { strokeDashoffset: "0" }], {
      duration: 900,
      easing: "ease-out",
      fill: "forwards",
    });
  });
}

function hideClimbRoute(index: number): void {
  const svg = document.getElementById("climb-route-svg");
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
