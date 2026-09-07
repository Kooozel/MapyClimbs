/**
 * types.ts — the extension's own vocabulary: storage keys, the chrome.runtime
 * message/response union, and the shapes those carry.
 *
 * The climb engine's domain types come from the `climb-engine` package (#83).
 * The dependency runs one way — this file imports the domain, never the reverse
 * — and the package boundary is what enforces it now.
 */

import type {
  ClimbCategory,
  DetectionResult,
  ElevationTuple,
  ScoredClimb,
  ScoringModel,
} from "climb-engine";

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
 * Sent by background → every open mapy tab when the scoring-model preference
 * changes, so each content script can re-score what it already holds.
 *
 * It carries the model rather than announcing that storage moved, because
 * storage does not move any more: a stored result is measured, and the switch
 * is a re-score in memory (#77). A hiking route ignores the value and keeps the
 * hiking model, as it always has.
 */
export interface CategorizationUpdatedMessage {
  type: "CATEGORIZATION_UPDATED";
  model: ScoringModel;
}

/**
 * Response shape for PROCESS_CLIMBS and ANALYZE_GPX messages. Exactly one arm:
 * detection that threw has no result, and an empty result must never stand in
 * for one — that substitution is what made a crash read as "No climbs
 * detected" (#60). The engine's own DetectionResult carries no error field; a
 * failure is an exception there, and this is where the extension names it.
 */
export type ClimbsResponse =
  | { result: StoredAnalysisResult; activeRouteClass: string; error?: undefined }
  | { result?: undefined; activeRouteClass: string; error: string };

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
 * A DetectionResult as the *extension* stores it. The engine returns a
 * clock-free, mode-free result (#68); `timestamp` and `routeMode` are this
 * side's own decoration, applied at the storage boundary by stampResult()
 * (storage.ts). Assignable to DetectionResult, so anything that only reads
 * climbs and totals keeps the engine's type.
 *
 * What is stored is *measured*, with no difficulty and no category: the
 * scoring model is applied at render (scoring-view.ts), so switching it costs
 * no storage write (#77).
 */
export interface StoredAnalysisResult extends DetectionResult {
  timestamp: number;
  routeMode?: RouteMode;
}

/**
 * A ScoredClimb the active model actually categorised.
 *
 * The engine returns every candidate with a possibly-null category, and the
 * panel, the cards and the overlay show only the ones that cleared a threshold
 * — the same set that used to arrive pre-filtered from detection. Narrowing the
 * type once, at the filter, keeps every UI module reading non-null
 * category/difficulty exactly as it did before.
 */
export type CategorizedClimb = ScoredClimb & { difficulty: number; category: ClimbCategory };

/** A stored result as the UI renders it: scored under the active model, then
 *  filtered to the climbs that cleared a threshold. */
export interface ScoredAnalysisResult extends Omit<StoredAnalysisResult, "climbs"> {
  climbs: CategorizedClimb[];
}
