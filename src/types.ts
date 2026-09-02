/**
 * types.ts — the extension's own vocabulary: storage keys, the chrome.runtime
 * message/response union, and the shapes those carry.
 *
 * The climb engine's domain types live in climb-types.ts and travel with it
 * when it is extracted (#68). Nothing here may be imported from that side.
 */

import type { AnalysisResult, ElevationTuple } from "./climb-types";

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
  lastAnalysisResult?: StoredAnalysisResult;
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
  result: StoredAnalysisResult;
  activeRouteClass: string;
  error?: string;
}

/** Response shape for GPX_CAPTURED messages. */
export interface GpxStoredResponse {
  success: true;
}

/**
 * Transport mode detected from the Mapy.cz route-planner UI at GPX-capture time.
 * Determines which scoring model is applied automatically.
 */
export type RouteMode = "cycling" | "hiking" | "other";

export type GpxInfo = { gpxContent: string; activeRouteClass: string; routeMode?: RouteMode };

/**
 * An AnalysisResult as the *extension* stores it. The engine returns a
 * clock-free, mode-free result (#68); `timestamp` and `routeMode` are this
 * side's own decoration, applied at the storage boundary by stampResult()
 * (storage.ts). Assignable to AnalysisResult, so anything that only reads
 * climbs and totals keeps the engine's type.
 */
export interface StoredAnalysisResult extends AnalysisResult {
  timestamp: number;
  routeMode?: RouteMode;
}
