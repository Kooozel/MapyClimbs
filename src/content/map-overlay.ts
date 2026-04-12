import { metersToKm } from "../format";
import { StorageKey, type Climb } from "../types";
import { CATEGORY_COLOR } from "./category";

export function renderMapOverlay(climbs: Climb[]): void {
  if (!climbs.length) return;
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
    const color = CATEGORY_COLOR[climb.category] ?? "#6b7280";
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
        overlay!.appendChild(pin);
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
        overlay!.appendChild(peak);
      }
    }
  });
}

// ── Viewport / projection helpers ─────────────────────────────────────────────

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
