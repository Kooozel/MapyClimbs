/**
 * gpx-parser.ts — GPX XML parser.
 * Produces ElevationTuple[] consumed by climb-engine.ts and background.ts.
 */

import type { ElevationTuple } from "./types";

/**
 * Parse GPX XML content and return an elevation profile.
 * Throws on malformed XML or empty track.
 */
export function parseGPX(gpxContent: string): ElevationTuple[] {
  const parser = new DOMParser();
  const gpxDoc = parser.parseFromString(gpxContent, "text/xml");

  if (gpxDoc.getElementsByTagName("parsererror").length > 0) {
    throw new Error("Invalid XML in GPX file");
  }

  // Attempt multiple namespace variants used by different GPX exporters
  const namespaces = [
    "http://www.topografix.com/GPX/1/1",
    "http://www.topografix.com/GPX/1/0",
    "",
  ];

  let trkpts: HTMLCollectionOf<Element> | null = null;
  for (const ns of namespaces) {
    const found = ns
      ? gpxDoc.getElementsByTagNameNS(ns, "trkpt")
      : gpxDoc.getElementsByTagName("trkpt");
    if (found.length > 0) {
      trkpts = found;
      break;
    }
  }

  if (!trkpts || trkpts.length === 0) {
    throw new Error("No track points found in GPX file");
  }

  interface TrackPoint {
    lat: number;
    lon: number;
    ele: number;
  }

  const trackPoints: TrackPoint[] = [];

  for (let i = 0; i < trkpts.length; i++) {
    const trkpt = trkpts[i];
    const lat = parseFloat(trkpt.getAttribute("lat") ?? "");
    const lon = parseFloat(trkpt.getAttribute("lon") ?? "");

    const eleEl: Element | undefined =
      (trkpt.getElementsByTagName("ele")[0] as Element | undefined) ??
      (trkpt.getElementsByTagNameNS(
        "http://www.topografix.com/GPX/1/1",
        "ele"
      )[0] as Element | undefined);

    const ele = eleEl ? parseFloat(eleEl.textContent ?? "0") : 0;

    if (!isNaN(lat) && !isNaN(lon)) {
      trackPoints.push({ lat, lon, ele: isNaN(ele) ? 0 : ele });
    }
  }

  if (trackPoints.length === 0) {
    throw new Error("No valid track points found in GPX file");
  }

  const elevationProfile: ElevationTuple[] = [];
  let cumulativeDistance = 0;

  for (let i = 0; i < trackPoints.length; i++) {
    const point = trackPoints[i];

    if (i > 0) {
      const prevPoint = trackPoints[i - 1];
      cumulativeDistance += haversineDistance(
        prevPoint.lat,
        prevPoint.lon,
        point.lat,
        point.lon
      );
    }

    elevationProfile.push([cumulativeDistance, point.ele, point.lat, point.lon]);
  }

  return elevationProfile;
}

/** Load and parse a GPX File object. */
export function loadGPXFile(file: File): Promise<ElevationTuple[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const gpxContent = (e.target as FileReader).result as string;
        resolve(parseGPX(gpxContent));
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsText(file);
  });
}

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
