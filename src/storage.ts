import { GpxInfo, RouteMode, StorageKey, StoredAnalysisResult, TabStateResponse } from "./types";
import type { AnalysisResult } from "./climb-types";

interface TabStorageKeys {
  pendingGPX: string;
  gpxCaptureTime: string;
  /**
   * Matches every route-class result stored for this tab. Always ends in ":",
   * so tab 1's prefix cannot match tab 12's keys — see issue #38.
   */
  lastAnalysisResultPrefix: string;
}

interface TabStorageKeysForRoute extends TabStorageKeys {
  /** The exact result key for one alternative route (e.g. `…:12:alt-0`). */
  lastAnalysisResult: string;
}

/**
 * Storage keys scoped to one tab. Pass a route class to address a single
 * alternative's result; omit it for tab-wide work, which must use
 * `lastAnalysisResultPrefix` rather than building a prefix by hand.
 */
export function getTabStorageKeys(tabId: number, active: string): TabStorageKeysForRoute;
export function getTabStorageKeys(tabId: number): TabStorageKeys;
export function getTabStorageKeys(
  tabId: number,
  active?: string
): TabStorageKeys | TabStorageKeysForRoute {
  const prefix = `${StorageKey.LastAnalysisResult}:${tabId}:`;
  const baseKeys = {
    pendingGPX: `${StorageKey.PendingGPX}:${tabId}`,
    gpxCaptureTime: `${StorageKey.GpxCaptureTime}:${tabId}`,
    lastAnalysisResultPrefix: prefix,
  };

  return active ? { ...baseKeys, lastAnalysisResult: `${prefix}${active}` } : baseKeys;
}

let cachedTabId: number | null = null;

export async function getTabId(): Promise<number> {
  if (cachedTabId !== null) return cachedTabId;

  const response = await chrome.runtime.sendMessage({ type: "GET_TAB_ID" });
  if (response?.tabId == null) throw new Error("GET_TAB_ID returned no tabId");
  cachedTabId = response.tabId as number;
  return cachedTabId;
}

export function getTabState(
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
        lastAnalysisResult: data[keys.lastAnalysisResult] as StoredAnalysisResult | undefined,
      });
    }
  );
}

/**
 * Decorate an engine result with the two fields the extension owns. The engine
 * is deterministic and clock-free (#68), so the stamp belongs at the storage
 * boundary — here. One factory so both the success and the error path of
 * runDetection produce the same shape, mirroring emptyAnalysisResult() on the
 * engine side.
 */
export function stampResult(result: AnalysisResult, routeMode?: RouteMode): StoredAnalysisResult {
  return { ...result, timestamp: Date.now(), ...(routeMode ? { routeMode } : {}) };
}

export function saveTabGpx(tabId: number, gpxInfo: GpxInfo, timestamp: number): void {
  const keys = getTabStorageKeys(tabId);
  chrome.storage.local.set({ [keys.pendingGPX]: gpxInfo, [keys.gpxCaptureTime]: timestamp }, () => {
    if (chrome.runtime.lastError) return;
  });
}

export function clearTabState(tabId: number): void {
  const keys = getTabStorageKeys(tabId);

  chrome.storage.local.get(null, (items) => {
    const allKeys = Object.keys(items);

    const keysToRemove = allKeys.filter(
      (key) =>
        key === keys.pendingGPX ||
        key === keys.gpxCaptureTime ||
        key.startsWith(keys.lastAnalysisResultPrefix)
    );

    if (keysToRemove.length > 0) {
      chrome.storage.local.remove(keysToRemove, () => {});
    }
  });
}
