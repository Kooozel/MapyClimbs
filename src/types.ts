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
  LastAnalysisResult: "lastAnalysisResult",
  ScoringModel: "scoringModel",
  MapLayerVisible: "mapLayerVisible",
  LastSeenVersion: "lastSeenVersion",
} as const;

export type StorageKey = (typeof StorageKey)[keyof typeof StorageKey];

// ── Extension message types ───────────────────────────────────────────────────

/** Send raw elevation tuples to the background worker for climb detection. */
export interface ProcessClimbsMessage {
  type: "PROCESS_CLIMBS";
  elevation: ElevationTuple[];
  activeRouteClass: string;
  tabId: number;
}

export interface SaveTabGpxMessage {
  type: "SAVE_TAB_GPX";
  gpxInfo: GpxInfo;
  timestamp: number;
  tabId: number;
}

export interface GetTabStateMessage {
  type: "GET_TAB_STATE";
  tabId: number;
  activeRouteClass: string;
}

export interface ClearTabStateMessage {
  type: "CLEAR_TAB_STATE";
  tabId: number;
}

export interface TabStateResponse {
  type: "TAB_STATE_RESPONSE";
  pendingGPX?: GpxInfo;
  captureTime?: number;
  lastAnalysisResult?: AnalysisResult;
}

export interface GetTabIdMessage {
  type: "GET_TAB_ID";
}

export interface TabIdResponse {
  tabId?: number;
}

/**
 * Request re-categorisation of already-stored climbs using the current
 * ScoringModel preference — no GPX re-parse or re-detection is performed.
 */
export interface RecategorizeMessage {
  type: "RECATEGORIZE_CLIMBS";
}

/** Toggle visibility of the climb marker overlay on the map. */
export interface MapLayerVisibilityMessage {
  type: "MAP_LAYER_VISIBILITY_CHANGED";
  visible: boolean;
}

export type ExtensionMessage =
  | ProcessClimbsMessage
  | SaveTabGpxMessage
  | GetTabStateMessage
  | ClearTabStateMessage
  | RecategorizeMessage
  | GetTabIdMessage;

/**
 * Sent by background → active mapy tab content script after re-categorisation
 * completes, so the overlay/panel can refresh without a full re-analysis.
 */
export interface CategorizationUpdatedMessage {
  type: "CATEGORIZATION_UPDATED";
}

/** Response shape for PROCESS_CLIMBS and ANALYZE_GPX messages. */
export interface ClimbsResponse {
  result: AnalysisResult;
  activeRouteClass: string;
  error?: string;
}

/** Response shape for GPX_CAPTURED messages. */
export interface GpxStoredResponse {
  success: true;
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
  Uncategorized: "uncategorized",
} as const;
export type ClimbCategory = (typeof ClimbCategory)[keyof typeof ClimbCategory];

/**
 * Scoring model used to classify climbs.
 * - "aso": ASO/Tour de France formula — score = dist(km) × avgGrade²
 * - "garmin": Garmin ClimbPro formula — score = dist(m) × avgGrade(%)
 * - "hiking": TRAILS-GPX formula — score = H²/(8L) + altitude bonus + G_max term
 */
export type ScoringModel = "aso" | "garmin" | "hiking";

/**
 * Transport mode detected from the Mapy.cz route-planner UI at GPX-capture time.
 * Determines which scoring model is applied automatically.
 */
export type RouteMode = "cycling" | "hiking" | "other";

/**
 * Raw elevation tuple as produced by gpx-parser.
 * [distance_m, elevation_m, lat, lon]
 */
export type ElevationTuple = [number, number, number, number];

export type GpxInfo = { gpxContent: string; activeRouteClass: string; routeMode?: RouteMode };

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

export interface AnalysisResult {
  climbs: Climb[];
  /** All trimmed candidates before scoring — used by recategorizeClimbs to
   *  recover climbs dropped by a different model. Optional for backward
   *  compatibility with results stored before this field was added. */
  candidates?: RawClimb[];
  totalDistance: number;
  totalElevationGain: number;
  totalElevationLoss: number;
  timestamp: number;
  routeMode?: RouteMode;
  error?: string;
}

/**
 * Structured pipeline-trace event emitted by detectClimbs when a debug sink is
 * passed. Each variant corresponds to one decision point in the 5-step pipeline.
 * The extension never passes a sink, so the engine stays a no-op there; the
 * consumers are `climb-cli --debug` and DEBUG_PIPELINE=1 in the integration test.
 */
export type ClimbDebugEvent =
  | {
      stage: "pipeline";
      rawPoints: number;
      resampled: number;
      interpolated: number;
      smoothed: number;
      segments: number;
    }
  | {
      stage: "identify-candidate";
      index: number;
      startKm: number;
      endKm: number;
      distanceM: number;
      elevationM: number;
      avgGradePct: number;
      rawGainM: number;
    }
  | {
      stage: "identify-close";
      reason: "descent" | "flat";
      atKm: number;
      tailTrimGradePct: number;
    }
  | {
      /** Emitted when tail-trimming leaves a candidate with no segments. No
       *  route fixture currently triggers it; it stays because the path is
       *  reachable and silence there would be the confusing outcome. */
      stage: "identify-reject";
      reason: "empty";
      startKm: number;
      endKm: number;
    }
  | {
      stage: "merge-pair";
      prevStartKm: number;
      prevEndKm: number;
      currStartKm: number;
      currEndKm: number;
      gapM: number;
      valleyDropM: number;
      effectiveMaxGapM: number;
      maxAllowedDropM: number;
      coherentAscent: boolean;
      combinedRawRiseM: number;
      decision: "merge" | "skip";
      /** Which arm of the decision fired. Typed rather than free-form so a
       *  `jq 'select(.reason=="…")'` filter over the CLI's NDJSON is
       *  checkable against this union. */
      reason: "within-gap-and-valley" | "negative-gap" | "gap-too-large" | "valley-too-deep";
    }
  | {
      stage: "trim";
      startKm: number;
      endKm: number;
      droppedHeadSegs: number;
      droppedTailSegs: number;
      remainingDistanceM: number;
      kept: boolean;
    }
  | {
      stage: "categorize";
      startKm: number;
      endKm: number;
      distanceM: number;
      avgGradePct: number;
      difficulty: number | null;
      category: ClimbCategory | null;
    };

export type ClimbDebugSink = (event: ClimbDebugEvent) => void;

export interface DetectClimbsOptions {
  /** Optional structured trace sink. Production callers omit this. */
  debug?: ClimbDebugSink;
}

declare global {
  interface XMLHttpRequest {
    _isGPXRequest?: boolean;
  }
}
