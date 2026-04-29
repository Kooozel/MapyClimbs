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
  type GpxInfo,
} from "../types";
import { MAPY_MATCHES } from "../constants";

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
  function getTabStorageKeys(tabId: number, active?: string) {
    // Base keys that are always the same for the tab
    const baseKeys = {
      pendingGPX: `${StorageKey.PendingGPX}:${tabId}`,
      gpxCaptureTime: `${StorageKey.GpxCaptureTime}:${tabId}`,
    };

    if (active) {
      // Return keys including the specific active route
      return {
        ...baseKeys,
        lastAnalysisResult: `${StorageKey.LastAnalysisResult}:${tabId}:${active}`,
      };
    } else {
      // Return keys without a specific active route
      // (Useful for clearing all results or prefix matching)
      return {
        ...baseKeys,
        lastAnalysisResult: `${StorageKey.LastAnalysisResult}:${tabId}`,
      };
    }
  }

  function getEffectiveTabId(
    request: { tabId?: number },
    sender: chrome.runtime.MessageSender
  ): number | undefined {
    return request.tabId ?? sender.tab?.id ?? undefined;
  }

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
        result: { climbs: [], totalDistance: 0, totalElevationGain: 0, totalElevationLoss: 0 },
        error: error instanceof Error ? error.message : String(error),
        activeRouteClass: "",
      });
    }
  }

  function getTabState(
    tabId: number,
    activeRouteClass: string,
    sendResponse: (response: TabStateResponse) => void
  ): void {
    const keys = getTabStorageKeys(tabId, activeRouteClass);
    chrome.storage.local.get(
      [keys.pendingGPX, keys.gpxCaptureTime, keys.lastAnalysisResult],
      (data) => {
        sendResponse({
          type: "TAB_STATE_RESPONSE",
          pendingGPX: data[keys.pendingGPX] as GpxInfo | undefined,
          captureTime: data[keys.gpxCaptureTime] as number | undefined,
          lastAnalysisResult: data[keys.lastAnalysisResult] as AnalysisResult | undefined,
        });
      }
    );
  }

  function saveTabGpx(tabId: number, gpxInfo: GpxInfo, timestamp: number): void {
    const keys = getTabStorageKeys(tabId, gpxInfo.activeRouteClass);
    console.log(gpxInfo);
    chrome.storage.local.set(
      { [keys.pendingGPX]: gpxInfo, [keys.gpxCaptureTime]: timestamp },
      () => {
        if (chrome.runtime.lastError) return;
      }
    );
  }

  function clearTabState(tabId: number): void {
    const keys = getTabStorageKeys(tabId);

    chrome.storage.local.get(null, (items) => {
      const allKeys = Object.keys(items);

      const keysToRemove = allKeys.filter(
        (key) =>
          key === keys.pendingGPX ||
          key === keys.gpxCaptureTime ||
          key.startsWith(keys.lastAnalysisResult)
      );

      if (keysToRemove.length > 0) {
        chrome.storage.local.remove(keysToRemove, () => {
          console.log(`Storage cleared for tab ${tabId}`);
        });
      }
    });
  }

  // ── Popup port management ─────────────────────────────────────────────────

  let popupPorts: chrome.runtime.Port[] = [];

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name === "popup") {
      popupPorts.push(port);
      port.onDisconnect.addListener(() => {
        popupPorts = popupPorts.filter((p) => p !== port);
      });
    }
  });
  // ── Message handler ───────────────────────────────────────────────────────

  const EMPTY_RESULT = {
    result: {
      climbs: [],
      totalDistance: 0,
      totalElevationGain: 0,
      totalElevationLoss: 0,
    },
    activeRouteClass: "",
  };

  chrome.runtime.onMessage.addListener(
    (
      request: ExtensionMessage,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: ClimbsResponse | GpxStoredResponse | TabStateResponse) => void
    ) => {
      if (request.type === "PROCESS_CLIMBS") {
        const tabId = getEffectiveTabId(request, sender);
        chrome.storage.local.get(StorageKey.ScoringModel, (pref) => {
          const model: ScoringModel =
            (pref[StorageKey.ScoringModel] as ScoringModel | undefined) ?? "aso";
          runDetection(request.elevation, model, sendResponse, request.activeRouteClass, tabId);
        });
      } else if (request.type === "SAVE_TAB_GPX") {
        const tabId = getEffectiveTabId(request, sender);
        if (tabId != null) {
          saveTabGpx(tabId, request.gpxInfo, request.timestamp);
        }
        sendResponse({ success: true });
      } else if (request.type === "GET_TAB_STATE") {
        const tabId = getEffectiveTabId(request, sender);
        if (tabId != null) {
          getTabState(
            tabId,
            request.activeRouteClass,
            sendResponse as (response: TabStateResponse) => void
          );
        } else {
          sendResponse({ type: "TAB_STATE_RESPONSE" });
        }
      } else if (request.type === "CLEAR_TAB_STATE") {
        const tabId = getEffectiveTabId(request, sender);
        if (tabId != null) {
          clearTabState(tabId);
        }
        sendResponse({ success: true });
      } else if (request.type === "RECATEGORIZE_CLIMBS") {
        chrome.storage.local.get(StorageKey.ScoringModel, (pref) => {
          const model: ScoringModel =
            (pref[StorageKey.ScoringModel] as ScoringModel | undefined) ?? "aso";
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
        });
      }
      return true; // keep message channel open for async sendResponse
    }
  );
});
