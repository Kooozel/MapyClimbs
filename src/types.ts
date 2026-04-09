/**
 * Shared domain types for MapyClimbs.
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
  ScoringModel: "scoringModel",
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

/**
 * Request re-categorisation of already-stored climbs using the current
 * ScoringModel preference — no GPX re-parse or re-detection is performed.
 */
export interface RecategorizeMessage {
  type: "RECATEGORIZE_CLIMBS";
}

export type ExtensionMessage =
  | ProcessClimbsMessage
  | AnalyzeGpxMessage
  | GpxCapturedMessage
  | RecategorizeMessage;

/**
 * Sent by background → active mapy tab content script after re-categorisation
 * completes, so the overlay/panel can refresh without a full re-analysis.
 */
export interface CategorizationUpdatedMessage {
  type: "CATEGORIZATION_UPDATED";
}

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

/**
 * Climb difficulty category — enum-like const so callers can reference values
 * as `ClimbCategory.HC` etc. while the type still resolves to the string union
 * used throughout storage and the UI.
 */
export const ClimbCategory = {
  HC: "HC",
  Cat1: "1",
  Cat2: "2",
  Cat3: "3",
  Cat4: "4",
} as const;
export type ClimbCategory = (typeof ClimbCategory)[keyof typeof ClimbCategory];

/**
 * Scoring model used to classify climbs.
 * - "aso": ASO/Tour de France formula — score = dist(km) × avgGrade²
 *   Thresholds: HC ≥ 600 | Cat 1 ≥ 300 | Cat 2 ≥ 150 | Cat 3 ≥ 75 | Cat 4 < 75
 * - "garmin": Garmin ClimbPro formula — score = dist(m) × avgGrade(%)
 *   Thresholds: HC ≥ 64 000 | Cat 1 ≥ 48 000 | Cat 2 ≥ 32 000 | Cat 3 ≥ 16 000 | Cat 4 ≥ 8 000
 */
export type ScoringModel = "aso" | "garmin";

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
