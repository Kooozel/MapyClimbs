/**
 * background entrypoint — MapyClimbs service worker.
 * Chrome messaging + storage glue only. All detection logic lives in climb-engine.ts.
 */

import { detectClimbs, recategorizeClimbs } from "../climb-engine";
import { parseGPX } from "../gpx-parser";
import {
  StorageKey,
  type ExtensionMessage,
  type ClimbsResponse,
  type GpxStoredResponse,
  type PortMessage,
  type TabStateResponse,
  type ScoringModel,
  type Climb,
  type ElevationTuple,
  type CategorizationUpdatedMessage,
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
  function getTabStorageKeys(tabId: number) {
    return {
      pendingGPX: `${StorageKey.PendingGPX}:${tabId}`,
      gpxCaptureTime: `${StorageKey.GpxCaptureTime}:${tabId}`,
      lastClimbResult: `${StorageKey.LastClimbResult}:${tabId}`,
      lastTotalDistance: `${StorageKey.LastTotalDistance}:${tabId}`,
    };
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
    tabId?: number
  ): void {
    try {
      const climbs = detectClimbs(elevation, model);
      const totalDistance = elevation.length > 0 ? elevation[elevation.length - 1][0] : 0;
      if (tabId != null) {
        const keys = getTabStorageKeys(tabId);
        chrome.storage.local.set({
          [keys.lastClimbResult]: climbs,
          [keys.lastTotalDistance]: totalDistance,
        });
      } else {
        chrome.storage.local.set({
          [StorageKey.LastClimbResult]: climbs,
          [StorageKey.LastTotalDistance]: totalDistance,
        });
      }
      sendResponse({ climbs, totalDistance });
    } catch (error) {
      sendResponse({
        climbs: [],
        totalDistance: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  function getTabState(tabId: number, sendResponse: (response: TabStateResponse) => void): void {
    const keys = getTabStorageKeys(tabId);
    chrome.storage.local.get(
      [keys.pendingGPX, keys.gpxCaptureTime, keys.lastClimbResult, keys.lastTotalDistance],
      (data) => {
        sendResponse({
          type: "TAB_STATE_RESPONSE",
          pendingGPX: data[keys.pendingGPX] as string | undefined,
          captureTime: data[keys.gpxCaptureTime] as number | undefined,
          lastClimbResult: data[keys.lastClimbResult] as Climb[] | undefined,
          lastTotalDistance: data[keys.lastTotalDistance] as number | undefined,
        });
      }
    );
  }

  function saveTabGpx(tabId: number, gpxContent: string, timestamp: number): void {
    const keys = getTabStorageKeys(tabId);
    chrome.storage.local.set(
      { [keys.pendingGPX]: gpxContent, [keys.gpxCaptureTime]: timestamp },
      () => {
        if (chrome.runtime.lastError) return;
        notifyPopupPorts({ type: "GPX_CAPTURED", timestamp, tabId });
      }
    );
  }

  function clearTabState(tabId: number): void {
    const keys = getTabStorageKeys(tabId);
    chrome.storage.local.remove([
      keys.pendingGPX,
      keys.gpxCaptureTime,
      keys.lastClimbResult,
      keys.lastTotalDistance,
    ]);
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

  function notifyPopupPorts(message: PortMessage): void {
    popupPorts.forEach((port) => {
      try {
        port.postMessage(message);
      } catch {
        // Port may have been disconnected between the filter and postMessage
      }
    });
  }

  // ── Message handler ───────────────────────────────────────────────────────

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
          runDetection(request.elevation, model, sendResponse, tabId);
        });
      } else if (request.type === "ANALYZE_GPX") {
        const tabId = getEffectiveTabId(request, sender);
        chrome.storage.local.get(StorageKey.ScoringModel, (pref) => {
          const model: ScoringModel =
            (pref[StorageKey.ScoringModel] as ScoringModel | undefined) ?? "aso";
          try {
            const elevation = parseGPX(request.gpxContent);
            runDetection(elevation, model, sendResponse, tabId);
          } catch (error) {
            sendResponse({
              climbs: [],
              totalDistance: 0,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        });
      } else if (request.type === "SAVE_TAB_GPX") {
        const tabId = getEffectiveTabId(request, sender);
        if (tabId != null) {
          saveTabGpx(tabId, request.gpxContent, request.timestamp);
        }
        sendResponse({ success: true });
      } else if (request.type === "GET_TAB_STATE") {
        const tabId = getEffectiveTabId(request, sender);
        if (tabId != null) {
          getTabState(tabId, sendResponse as (response: TabStateResponse) => void);
        } else {
          sendResponse({ type: "TAB_STATE_RESPONSE" });
        }
      } else if (request.type === "CLEAR_TAB_STATE") {
        const tabId = getEffectiveTabId(request, sender);
        if (tabId != null) {
          clearTabState(tabId);
        }
        sendResponse({ success: true });
      } else if (request.type === "GPX_CAPTURED") {
        notifyPopupPorts({ type: "GPX_CAPTURED", timestamp: request.timestamp });
        sendResponse({ success: true });
      } else if (request.type === "RECATEGORIZE_CLIMBS") {
        chrome.storage.local.get(StorageKey.ScoringModel, (pref) => {
          const model: ScoringModel =
            (pref[StorageKey.ScoringModel] as ScoringModel | undefined) ?? "aso";
          chrome.tabs.query({ url: [...MAPY_MATCHES] }, (tabs) => {
            const tabIds = tabs.map((tab) => tab.id).filter((id): id is number => id != null);
            if (tabIds.length === 0) {
              sendResponse({ climbs: [], totalDistance: 0 });
              return;
            }

            const keys = tabIds.flatMap((tabId) => {
              const tabKeys = getTabStorageKeys(tabId);
              return [tabKeys.lastClimbResult, tabKeys.lastTotalDistance];
            });

            chrome.storage.local.get(keys, (data) => {
              const storageUpdates: Record<string, unknown> = {};
              let totalDistance = 0;

              for (const tabId of tabIds) {
                const tabKeys = getTabStorageKeys(tabId);
                const storedClimbs = data[tabKeys.lastClimbResult] as Climb[] | undefined;
                const tabTotalDistance =
                  (data[tabKeys.lastTotalDistance] as number | undefined) ?? 0;
                if (!storedClimbs || storedClimbs.length === 0) continue;
                const climbs = recategorizeClimbs(storedClimbs, model);
                storageUpdates[tabKeys.lastClimbResult] = climbs;
                totalDistance = tabTotalDistance;
              }

              if (Object.keys(storageUpdates).length > 0) {
                chrome.storage.local.set(storageUpdates, () => {
                  const msg: CategorizationUpdatedMessage = { type: "CATEGORIZATION_UPDATED" };
                  tabIds.forEach((tabId) => {
                    chrome.tabs.sendMessage(tabId, msg).catch(() => {});
                  });
                  sendResponse({ climbs: [], totalDistance });
                });
              } else {
                sendResponse({ climbs: [], totalDistance });
              }
            });
          });
        });
      }
      return true; // keep message channel open for async sendResponse
    }
  );
});
