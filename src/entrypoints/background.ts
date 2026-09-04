/**
 * background entrypoint — MapyClimbs service worker.
 * Chrome messaging + storage glue only. All detection logic lives in climb-engine.ts.
 */

import { detectClimbs, emptyDetectionResult } from "../climb-engine";
import {
  StorageKey,
  type ExtensionMessage,
  type ClimbsResponse,
  type GpxStoredResponse,
  type TabStateResponse,
  type RouteMode,
  type CategorizationUpdatedMessage,
  type GpxInfo,
  type TabIdResponse,
} from "../types";
import type { ElevationTuple, ScoringModel } from "../climb-types";
import { MAPY_MATCHES } from "../constants";
import { clearTabState, getTabState, getTabStorageKeys, saveTabGpx, stampResult } from "../storage";

export default defineBackground(() => {
  // ── Storage version guard ─────────────────────────────────────────────────

  // Bumped to 2 for #77: a stored result is now a measured DetectionResult, and
  // the droppedCandidates/candidates read path that made the old shape legible
  // is gone.
  const STORAGE_VERSION = 2;

  /**
   * Keys the version clear must not take with it. Analysis results regenerate
   * on the next GPX export — the route planner does one every time it is used —
   * so losing them costs a user nothing. These three have no such source: the
   * clear would silently reset the scoring model and the overlay toggle, and
   * re-open the What's New tab on a version the user has already seen.
   */
  const PRESERVED_KEYS: StorageKey[] = [
    StorageKey.ScoringModel,
    StorageKey.MapLayerVisible,
    StorageKey.LastSeenVersion,
  ];

  chrome.storage.local.get([StorageKey.StorageVersion, ...PRESERVED_KEYS], (result) => {
    if (chrome.runtime.lastError) return;
    if (result[StorageKey.StorageVersion] === STORAGE_VERSION) return;

    const preserved: Record<string, unknown> = {};
    for (const key of PRESERVED_KEYS) {
      if (result[key] !== undefined) preserved[key] = result[key];
    }

    chrome.storage.local.clear(() => {
      if (chrome.runtime.lastError) return;
      chrome.storage.local.set({ ...preserved, [StorageKey.StorageVersion]: STORAGE_VERSION });
    });
  });

  // ── What's New tab on install / update ───────────────────────────────────

  chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason !== "install" && details.reason !== "update") return;

    const currentVersion = chrome.runtime.getManifest().version;

    chrome.storage.local.get(StorageKey.LastSeenVersion, (result) => {
      if (chrome.runtime.lastError) return;
      if (result[StorageKey.LastSeenVersion] === currentVersion) return;

      chrome.tabs.create({ url: chrome.runtime.getURL("/whats-new.html") }, () => {
        chrome.storage.local.set({ [StorageKey.LastSeenVersion]: currentVersion });
      });
    });
  });

  // ── Shared detection helper ───────────────────────────────────────────────

  /**
   * Run climb detection on a pre-parsed elevation array, persist the result to
   * storage, and call `sendResponse`. A throw is forwarded as an error response
   * so the caller never hangs — and never as an empty result, which the panel
   * cannot tell apart from a genuinely flat route (#60).
   */
  function runDetection(
    elevation: ElevationTuple[],
    sendResponse: (r: ClimbsResponse) => void,
    activeRouteClass: string,
    tabId?: number,
    routeMode?: RouteMode
  ): void {
    try {
      const analysisResult = stampResult(detectClimbs(elevation), routeMode);
      if (tabId != null) {
        const keys = getTabStorageKeys(tabId, activeRouteClass);
        chrome.storage.local.set({ [keys.lastAnalysisResult]: analysisResult });
      }
      sendResponse({ result: analysisResult, activeRouteClass });
    } catch (error) {
      // No result: the panel must be able to tell a crash from a flat route (#60).
      sendResponse({
        error: error instanceof Error ? error.message : String(error),
        activeRouteClass,
      });
    }
  }

  /**
   * Tell every open mapy tab which scoring model to render with.
   *
   * That is the entire operation now. It used to read every stored result
   * across every tab and alternative, re-partition each one under the new model
   * and write them all back — a storage sweep to change a display choice.
   * Results are measured, not scored (#77), so nothing in storage depends on
   * the model and the content script re-scores what it already holds.
   */
  function broadcastScoringModel(
    sendResponse: (response: ClimbsResponse) => void,
    model: ScoringModel
  ): void {
    chrome.tabs.query({ url: [...MAPY_MATCHES] }, (tabs) => {
      const msg: CategorizationUpdatedMessage = { type: "CATEGORIZATION_UPDATED", model };
      for (const tab of tabs) {
        if (tab.id != null) chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
      }
      // No result to hand back: the panel repaints from the message, not from
      // this response. The empty shape keeps ClimbsResponse's one-arm contract.
      sendResponse({ result: stampResult(emptyDetectionResult()), activeRouteClass: "" });
    });
  }

  // ── Message handler ───────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener(
    (
      request: ExtensionMessage,
      sender: chrome.runtime.MessageSender,
      sendResponse: (
        response: ClimbsResponse | GpxStoredResponse | TabStateResponse | TabIdResponse
      ) => void
    ) => {
      if (request.type === "GET_TAB_ID") {
        sendResponse({ tabId: sender.tab?.id });
      } else if (request.type === "PROCESS_CLIMBS") {
        // The scoring model is not read here any more: detection has no opinion
        // about it (#77). routeMode still is — it is stamped onto the stored
        // result, and it is what forces a hiking route to the hiking model at
        // render time.
        const tabKeys = getTabStorageKeys(request.tabId);
        chrome.storage.local.get(tabKeys.pendingGPX, (data) => {
          const pendingGpx = data[tabKeys.pendingGPX] as GpxInfo | undefined;
          runDetection(
            request.elevation,
            sendResponse,
            request.activeRouteClass,
            request.tabId,
            pendingGpx?.routeMode
          );
        });
      } else if (request.type === "SAVE_TAB_GPX") {
        saveTabGpx(request.tabId, request.gpxInfo, request.timestamp);
        sendResponse({ success: true });
      } else if (request.type === "GET_TAB_STATE") {
        getTabState(
          request.tabId,
          request.activeRouteClass,
          sendResponse as (response: TabStateResponse) => void
        );
      } else if (request.type === "CLEAR_TAB_STATE") {
        clearTabState(request.tabId);
        sendResponse({ success: true });
      } else if (request.type === "RECATEGORIZE_CLIMBS") {
        chrome.storage.local.get(StorageKey.ScoringModel, (pref) => {
          const model: ScoringModel =
            (pref[StorageKey.ScoringModel] as ScoringModel | undefined) ?? "aso";
          broadcastScoringModel(sendResponse, model);
        });
      }
      return true; // keep message channel open for async sendResponse
    }
  );
});
