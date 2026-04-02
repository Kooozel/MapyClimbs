/**
 * Shared domain types for Climb Analyzer.
 * Imported by background service worker, content scripts, and popup.
 */

// ── Storage keys ──────────────────────────────────────────────────────────────

/**
 * Typed constants for all chrome.storage.local keys used by the extension.
 * Use these instead of magic strings to prevent silent typo bugs.
 */
export const StorageKey = {
  StorageVersion: "storageVersion",
  PendingGPX: "pendingGPX",
  GpxCaptureTime: "gpxCaptureTime",
  LastClimbResult: "lastClimbResult",
  LastTotalDistance: "lastTotalDistance",
} as const;

export type StorageKey = (typeof StorageKey)[keyof typeof StorageKey];

// ── Extension message types ───────────────────────────────────────────────────

/** Send raw elevation tuples to the background worker for climb detection. */
export interface ProcessClimbsMessage {
  type: "PROCESS_CLIMBS";
  elevation: ElevationTuple[];
}

/**
 * Send raw GPX content to the background worker for one-shot parse + detect.
 * Preferred over PROCESS_CLIMBS for callers that have not yet parsed the GPX.
 */
export interface AnalyzeGpxMessage {
  type: "ANALYZE_GPX";
  gpxContent: string;
}

/**
 * Notification sent by the interceptor content script when a GPX export is
 * captured and already written to chrome.storage.local.
 */
export interface GpxCapturedMessage {
  type: "GPX_CAPTURED";
  timestamp: number;
}

export type ExtensionMessage = ProcessClimbsMessage | AnalyzeGpxMessage | GpxCapturedMessage;

/** Response shape for PROCESS_CLIMBS and ANALYZE_GPX messages. */
export interface ClimbsResponse {
  climbs: Climb[];
  totalDistance: number;
  error?: string;
}

/** Response shape for GPX_CAPTURED messages. */
export interface GpxStoredResponse {
  success: true;
}

export type ExtensionResponse = ClimbsResponse | GpxStoredResponse;

/** Message sent over the popup long-lived port by the background worker. */
export interface PortMessage {
  type: "GPX_CAPTURED";
  timestamp: number;
}

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
