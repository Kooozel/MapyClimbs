import { AnalysisResult, GpxInfo, StorageKey, TabStateResponse } from "./types";

export function getTabStorageKeys(tabId: number, active?: string) {
  const baseKeys = {
    pendingGPX: `${StorageKey.PendingGPX}:${tabId}`,
    gpxCaptureTime: `${StorageKey.GpxCaptureTime}:${tabId}`,
  };

  return active
    ? { ...baseKeys, lastAnalysisResult: `${StorageKey.LastAnalysisResult}:${tabId}:${active}` }
    : { ...baseKeys, lastAnalysisResult: `${StorageKey.LastAnalysisResult}:${tabId}` };
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
        lastAnalysisResult: data[keys.lastAnalysisResult] as AnalysisResult | undefined,
      });
    }
  );
}

export function saveTabGpx(tabId: number, gpxInfo: GpxInfo, timestamp: number): void {
  const keys = getTabStorageKeys(tabId, gpxInfo.activeRouteClass);
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
        key.startsWith(keys.lastAnalysisResult)
    );

    if (keysToRemove.length > 0) {
      chrome.storage.local.remove(keysToRemove, () => {});
    }
  });
}
