/**
 * gpx.ts — the one GPX trackpoint reader, for every consumer.
 *
 * It scans the XML directly (indexOf + stateless regexes) rather than through a
 * parser: no DOM, no Node API, no dependency, so the same file serves the
 * browser extension and the Node CLI. It replaced a second, DOMParser-based
 * reader that existed only because that portability was assumed to be
 * impossible (#77); a parity test had pinned the two together over the real
 * route fixtures for as long as both existed, which is what made the merge safe.
 *
 * Distance is accumulated with the shared haversine in ./geo.ts, so the distance
 * axis every downstream figure is read off — gradients, climb lengths, VAM — has
 * one definition.
 *
 * Verified against Garmin Connect exports: heart rate lives at
 * <extensions>/<ns3:TrackPointExtension>/<ns3:hr>. That namespace prefix is the
 * only Garmin-specific thing here and it is treated as optional throughout, so
 * other exporters parse too. <time> and heart rate ride along as optional
 * per-point data — the extension ignores them, the CLI's ride metrics need them.
 */

import type { ElevationTuple } from "./climb-types";
import { haversineDistance } from "./geo";

/** One trackpoint, with everything the ride metrics need. */
export interface TrackPoint {
  lat: number;
  lon: number;
  /** Metres. 0 when the trackpoint carries no <ele>. */
  ele: number;
  /** Unix seconds, or null when the trackpoint carries no <time>. */
  t: number | null;
  /** Heart rate in bpm, or null when absent. */
  hr: number | null;
  /** Cumulative haversine distance from the first point, in metres. */
  d: number;
}

export interface GpxTrack {
  points: TrackPoint[];
  /** The same track in the shape detectClimbs() consumes. */
  tuples: ElevationTuple[];
}

const TRKPT = "<trkpt";
const TRKPT_CLOSE = "</trkpt>";

// Stateless (no /g), so module-level reuse is safe and avoids recompiling
// these once per trackpoint on multi-thousand-point rides.
const LAT_RE = /\blat\s*=\s*["']([^"']*)["']/;
const LON_RE = /\blon\s*=\s*["']([^"']*)["']/;
const ELE_RE = /<(?:[\w.-]+:)?ele\b[^>]*>([\s\S]*?)<\//;
const TIME_RE = /<(?:[\w.-]+:)?time\b[^>]*>([\s\S]*?)<\//;
const HR_RE = /<(?:[\w.-]+:)?hr\b[^>]*>([\s\S]*?)<\//;

/**
 * Parse GPX XML into a track. Throws when no usable trackpoint is found —
 * which is also how a malformed file surfaces, since there is no DOM parser
 * here to report a syntax error.
 *
 * That is one error where the DOM reader had two ("Invalid XML in GPX file"
 * against an empty track), and it is a deliberate trade rather than a
 * regression that slipped through: the exception's text never reaches rendered
 * markup — buildErrorPanel puts it in a `title` attribute and console.error,
 * on purpose (panel.ts) — so the panel a user sees is identical either way,
 * and one portable reader is worth more than that distinction (#77).
 */
export function parseGpx(gpxContent: string): GpxTrack {
  const points: TrackPoint[] = [];
  let cursor = 0;

  for (;;) {
    const open = gpxContent.indexOf(TRKPT, cursor);
    if (open === -1) break;

    // Don't match a longer element name that merely starts with "trkpt".
    const next = gpxContent[open + TRKPT.length];
    if (next !== undefined && !/[\s/>]/.test(next)) {
      cursor = open + TRKPT.length;
      continue;
    }

    const tagEnd = gpxContent.indexOf(">", open);
    if (tagEnd === -1) break;

    const tag = gpxContent.slice(open, tagEnd);
    let body = "";

    if (gpxContent[tagEnd - 1] === "/") {
      // <trkpt lat=".." lon=".." /> — no children.
      cursor = tagEnd + 1;
    } else {
      const close = gpxContent.indexOf(TRKPT_CLOSE, tagEnd);
      if (close === -1) break;
      body = gpxContent.slice(tagEnd + 1, close);
      cursor = close + TRKPT_CLOSE.length;
    }

    const lat = numberFrom(LAT_RE.exec(tag)?.[1]);
    const lon = numberFrom(LON_RE.exec(tag)?.[1]);
    if (lat === null || lon === null) continue;

    const ele = numberFrom(ELE_RE.exec(body)?.[1]);
    const hr = numberFrom(HR_RE.exec(body)?.[1]);
    const time = TIME_RE.exec(body)?.[1]?.trim();

    points.push({
      lat,
      lon,
      ele: ele ?? 0,
      t: time ? parseTimestamp(time) : null,
      hr: hr === null ? null : Math.round(hr),
      d: 0,
    });
  }

  if (points.length === 0) throw new Error("No valid track points found in GPX file");

  const tuples: ElevationTuple[] = [];
  let cumulative = 0;

  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    if (i > 0) {
      const prev = points[i - 1];
      cumulative += haversineDistance(prev.lat, prev.lon, point.lat, point.lon);
    }
    point.d = cumulative;
    tuples.push([cumulative, point.ele, point.lat, point.lon]);
  }

  return { points, tuples };
}

/** ISO-8601 timestamp to Unix seconds, or null when unparseable. */
function parseTimestamp(text: string): number | null {
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? null : ms / 1000;
}

function numberFrom(text: string | undefined): number | null {
  if (text === undefined) return null;
  const value = Number.parseFloat(text);
  return Number.isFinite(value) ? value : null;
}
