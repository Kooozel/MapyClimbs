/**
 * injected/marker-injection.ts
 * Listens for INJECT_CLIMB_MARKERS postMessages and renders SVG pin markers
 * on the live Mapy.cz SMap instance.
 */

import { metersToKm } from "../format";
import { getCategoryColor } from "../content/category";
import type { ClimbCategory } from "../types";
import type { SMapInstance, SMapConstructorStatic, InjectClimbData } from "../smap.types";
import { getSmapRef, applySMapHooks, discoverMapInstance } from "./smap-capture";

function buildMarkerSvg(color: string, num: number): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="34" viewBox="0 0 28 34">` +
    `<path d="M14 0C6.27 0 0 6.27 0 14c0 9.6 14 20 14 20S28 23.6 28 14C28 6.27 21.73 0 14 0z" fill="${color}" stroke="#fff" stroke-width="1.5"/>` +
    `<circle cx="14" cy="14" r="9" fill="rgba(0,0,0,0.25)"/>` +
    `<text x="14" y="19" font-size="11" font-weight="bold" fill="#fff" text-anchor="middle" font-family="sans-serif">${num}</text>` +
    `</svg>`
  );
}

function doInjectMarkers(
  map: SMapInstance,
  S: SMapConstructorStatic,
  climbs: InjectClimbData[]
): void {
  try {
    if (window.__climbMarkerLayer) {
      try {
        map.removeLayer(window.__climbMarkerLayer);
      } catch {
        // layer may already be removed
      }
    }

    const layer = new S.Layer.Marker();
    map.addLayer(layer);
    layer.enable();
    window.__climbMarkerLayer = layer;

    climbs.forEach((climb, i) => {
      if (!climb.markerCoords) return;
      const { lat, lon } = climb.markerCoords;
      const color = getCategoryColor(climb.category as ClimbCategory);
      const num = i + 1;

      const img = new Image();
      img.src =
        "data:image/svg+xml;charset=utf-8," + encodeURIComponent(buildMarkerSvg(color, num));

      const coords = S.Coords.fromWGS84(lon, lat);
      const marker = new S.Marker(coords, "climb-" + i, {
        url: img,
        size: [28, 34],
        anchor: { left: 14, bottom: 0 },
        title:
          `Climb ${num} · Cat ${climb.category} · ` +
          `${metersToKm(climb.distance)} km +${Math.round(climb.elevation)} m`,
      });
      layer.addMarker(marker);
    });
  } catch {
    // SMap API may not be ready; silently fail
  }
}

export function installMarkerInjectionListener(): void {
  window.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== window) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = event.data as any;
    if (data?.type !== "INJECT_CLIMB_MARKERS") return;

    const climbs = data.climbs as InjectClimbData[] | undefined;
    if (!climbs?.length) return;

    const tryInject = (attemptsLeft: number): void => {
      const map = discoverMapInstance();
      const S = getSmapRef() ?? window.SMap;
      if (!map || !S) {
        if (attemptsLeft > 0) {
          if (S && !S._climbHooked) applySMapHooks(S);
          setTimeout(() => tryInject(attemptsLeft - 1), 1000);
        }
        return;
      }
      doInjectMarkers(map, S, climbs);
    };

    tryInject(10);
  });
}
