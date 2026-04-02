/**
 * Shared domain types for Climb Analyzer.
 * Imported by background service worker, content scripts, and popup.
 */

/** ProCyclingStats climb difficulty category. */
export type ClimbCategory = "HC" | "1" | "2" | "3" | "4";

/**
 * Raw elevation tuple as produced by gpx-parser.
 * [distance_m, elevation_m, lat, lon]
 */
export type ElevationTuple = [number, number, number, number];

/** Intermediate GPS point used within the climb-detection pipeline. */
export interface GpsPoint {
  distance: number;
  elevation: number;
  lat: number | null;
  lon: number | null;
}

/** A single gradient segment between two consecutive GPS points. */
export interface Segment {
  startDistance: number;
  endDistance: number;
  distance: number;
  elevation: number;
  gradient: number;
  startElevation: number;
  endElevation: number;
  startLat: number | null;
  startLon: number | null;
  endLat: number | null;
  endLon: number | null;
}

/** WGS-84 coordinate pair. */
export interface Coords {
  lat: number;
  lon: number;
}

/**
 * Fully processed and categorized climb — the public output of detectClimbs.
 * Also used as the shape stored in chrome.storage.
 */
export interface Climb {
  distance: number;
  elevation: number;
  avgGrade: number;
  difficulty: number;
  category: ClimbCategory;
  segments: Segment[];
  markerCoords: Coords | null;
  endCoords: Coords | null;
}

/** Pre-categorization intermediate produced by identifyClimbs / mergeNearbyClimbs. */
export interface RawClimb {
  segments: Segment[];
  totalDistance: number;
  totalElevation: number;
}
