/**
 * background entrypoint — MapyClimbs service worker.
 * Chrome messaging + storage glue only. All detection logic lives in climb-engine.ts.
 */

import { detectClimbs, emptyAnalysisResult, recategorizeResult } from "../climb-engine";
import {
  StorageKey,
  type ExtensionMessage,
  type ClimbsResponse,
  type GpxStoredResponse,
  type TabStateResponse,
  type ScoringModel,
  type RouteMode,
  type ElevationTuple,
  type CategorizationUpdatedMessage,
  type AnalysisResult,
  type GpxInfo,
  type TabIdResponse,
} from "../types";
import { MAPY_MATCHES } from "../constants";
import { clearTabState, getTabState, getTabStorageKeys, saveTabGpx } from "../storage";

export default defineBackground(() => {
  // ── Storage version guard ─────────────────────────────────────────────────

  const STORAGE_VERSION = 1;

  chrome.storage.local.get(StorageKey.StorageVersion, (result) => {
    if (chrome.runtime.lastError) return;
    if (result[StorageKey.StorageVersion] !== STORAGE_VERSION) {
      chrome.storage.local.clear(() => {
        if (chrome.runtime.lastError) return;
        chrome.storage.local.set({ [StorageKey.StorageVersion]: STORAGE_VERSION });
      });
    }
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
   * storage, and call `sendResponse`. Errors are caught and forwarded as an
   * empty-climbs response so the caller never hangs.
   */
  function runDetection(
    elevation: ElevationTuple[],
    model: ScoringModel,
    sendResponse: (r: ClimbsResponse) => void,
    activeRouteClass: string,
    tabId?: number,
    routeMode?: RouteMode
  ): void {
    try {
      const detected = detectClimbs(elevation, model);
      const analysisResult: AnalysisResult = routeMode ? { ...detected, routeMode } : detected;
      if (tabId != null) {
        const keys = getTabStorageKeys(tabId, activeRouteClass);
        chrome.storage.local.set({ [keys.lastAnalysisResult]: analysisResult });
      }
      sendResponse({ result: analysisResult, activeRouteClass });
    } catch (error) {
      sendResponse({
        result: emptyAnalysisResult(),
        error: error instanceof Error ? error.message : String(error),
        activeRouteClass: "",
      });
    }
  }

  function updateClimbCategorization(
    sendResponse: (response: ClimbsResponse) => void,
    model: ScoringModel
  ): void {
    const EMPTY_RESULT = { result: emptyAnalysisResult(), activeRouteClass: "" };
    chrome.tabs.query({ url: [...MAPY_MATCHES] }, (tabs) => {
      const tabIds = tabs.map((tab) => tab.id).filter((id): id is number => id != null);
      if (tabIds.length === 0) {
        sendResponse(EMPTY_RESULT);
        return;
      }

      // Results are stored per-tab per-route-class (e.g. lastAnalysisResult:<tabId>:alt-0).
      // Read all storage to find every matching key for the open tabs.
      chrome.storage.local.get(null, (allItems) => {
        const resultKeys = tabIds.flatMap((tabId) => {
          const prefix = getTabStorageKeys(tabId).lastAnalysisResultPrefix;
          return Object.keys(allItems).filter((k) => k.startsWith(prefix));
        });

        if (resultKeys.length === 0) {
          sendResponse(EMPTY_RESULT);
          return;
        }

        const storageUpdates: Record<string, unknown> = {};

        for (const key of resultKeys) {
          const stored = allItems[key] as AnalysisResult | undefined;
          if (!stored) continue;
          // Not `climbs.length === 0`: a strict model can reject every candidate, and
          // those rejects are exactly what a switch to a permissive model recovers.
          const candidateCount =
            stored.climbs.length + (stored.droppedCandidates ?? stored.candidates ?? []).length;
          if (candidateCount === 0) continue;
          const effectiveModel: ScoringModel = stored.routeMode === "hiking" ? "hiking" : model;
          storageUpdates[key] = recategorizeResult(stored, effectiveModel);
        }

        if (Object.keys(storageUpdates).length > 0) {
          chrome.storage.local.set(storageUpdates, () => {
            const msg: CategorizationUpdatedMessage = { type: "CATEGORIZATION_UPDATED" };
            tabIds.forEach((tabId) => {
              chrome.tabs.sendMessage(tabId, msg).catch(() => {});
            });
            sendResponse(EMPTY_RESULT);
          });
        } else {
          sendResponse(EMPTY_RESULT);
        }
      });
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
        const tabKeys = getTabStorageKeys(request.tabId);
        chrome.storage.local.get([StorageKey.ScoringModel, tabKeys.pendingGPX], (data) => {
          const model: ScoringModel =
            (data[StorageKey.ScoringModel] as ScoringModel | undefined) ?? "aso";
          const pendingGpx = data[tabKeys.pendingGPX] as GpxInfo | undefined;
          const routeMode = pendingGpx?.routeMode;
          const effectiveModel: ScoringModel = routeMode === "hiking" ? "hiking" : model;
          runDetection(
            request.elevation,
            effectiveModel,
            sendResponse,
            request.activeRouteClass,
            request.tabId,
            routeMode
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
          updateClimbCategorization(sendResponse, model);
        });
      }
      return true; // keep message channel open for async sendResponse
    }
  );
});
