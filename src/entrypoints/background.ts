/**
 * background entrypoint — MapyClimbs service worker.
 * Chrome messaging + storage glue only. All detection logic lives in climb-engine.ts.
 */

import { detectClimbs, recategorizeClimbs } from "../climb-engine";
import {
  StorageKey,
  type ExtensionMessage,
  type ClimbsResponse,
  type GpxStoredResponse,
  type TabStateResponse,
  type ScoringModel,
  type ElevationTuple,
  type CategorizationUpdatedMessage,
  type AnalysisResult,
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
    tabId?: number
  ): void {
    try {
      const analysisResult = detectClimbs(elevation, model);
      if (tabId != null) {
        const keys = getTabStorageKeys(tabId, activeRouteClass);
        chrome.storage.local.set({
          [keys.lastAnalysisResult]: analysisResult,
        });
      } else {
        chrome.storage.local.set({
          [StorageKey.LastAnalysisResult]: analysisResult,
        });
      }
      sendResponse({ result: analysisResult, activeRouteClass });
    } catch (error) {
      sendResponse({
        result: {
          climbs: [],
          totalDistance: 0,
          totalElevationGain: 0,
          totalElevationLoss: 0,
          timestamp: Date.now(),
        },
        error: error instanceof Error ? error.message : String(error),
        activeRouteClass: "",
      });
    }
  }

  function updateClimbCategorization(
    sendResponse: (
      response: ClimbsResponse | GpxStoredResponse | TabStateResponse | TabIdResponse
    ) => void,
    model: ScoringModel
  ): void {
    const EMPTY_RESULT = {
      result: {
        climbs: [],
        totalDistance: 0,
        totalElevationGain: 0,
        totalElevationLoss: 0,
        timestamp: Date.now(),
      },
      activeRouteClass: "",
    };
    chrome.tabs.query({ url: [...MAPY_MATCHES] }, (tabs) => {
      const tabIds = tabs.map((tab) => tab.id).filter((id): id is number => id != null);
      if (tabIds.length === 0) {
        sendResponse(EMPTY_RESULT);
        return;
      }

      const keys = tabIds.flatMap((tabId) => {
        const tabKeys = getTabStorageKeys(tabId);
        return [tabKeys.lastAnalysisResult];
      });

      chrome.storage.local.get(keys, (data) => {
        const storageUpdates: Record<string, unknown> = {};

        for (const tabId of tabIds) {
          const tabKeys = getTabStorageKeys(tabId);
          const storedAnalysisResult = data[tabKeys.lastAnalysisResult] as
            | AnalysisResult
            | undefined;
          if (!storedAnalysisResult || storedAnalysisResult.climbs.length === 0) continue;
          const analysisResult = recategorizeClimbs(storedAnalysisResult.climbs, model);
          storageUpdates[tabKeys.lastAnalysisResult] = analysisResult;
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
        chrome.storage.local.get(StorageKey.ScoringModel, (pref) => {
          const model: ScoringModel =
            (pref[StorageKey.ScoringModel] as ScoringModel | undefined) ?? "aso";
          runDetection(
            request.elevation,
            model,
            sendResponse,
            request.activeRouteClass,
            request.tabId
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
