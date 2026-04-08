/**
 * background entrypoint — MapyClimbs service worker.
 * Chrome messaging + storage glue only. All detection logic lives in climb-engine.ts.
 */

import { detectClimbs } from "../climb-engine";
import { parseGPX } from "../gpx-parser";
import {
  StorageKey,
  type ExtensionMessage,
  type ClimbsResponse,
  type GpxStoredResponse,
  type PortMessage,
} from "../types";

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
      _sender: chrome.runtime.MessageSender,
      sendResponse: (response: ClimbsResponse | GpxStoredResponse) => void
    ) => {
      if (request.type === "PROCESS_CLIMBS") {
        try {
          const climbs = detectClimbs(request.elevation);
          const totalDistance =
            request.elevation.length > 0 ? request.elevation[request.elevation.length - 1][0] : 0;
          chrome.storage.local.set({
            [StorageKey.LastClimbResult]: climbs,
            [StorageKey.LastTotalDistance]: totalDistance,
          });
          sendResponse({ climbs, totalDistance });
        } catch (error) {
          sendResponse({
            climbs: [],
            totalDistance: 0,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      } else if (request.type === "ANALYZE_GPX") {
        try {
          const elevation = parseGPX(request.gpxContent);
          const climbs = detectClimbs(elevation);
          const totalDistance = elevation.length > 0 ? elevation[elevation.length - 1][0] : 0;
          chrome.storage.local.set({
            [StorageKey.LastClimbResult]: climbs,
            [StorageKey.LastTotalDistance]: totalDistance,
          });
          sendResponse({ climbs, totalDistance });
        } catch (error) {
          sendResponse({
            climbs: [],
            totalDistance: 0,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      } else if (request.type === "GPX_CAPTURED") {
        notifyPopupPorts({ type: "GPX_CAPTURED", timestamp: request.timestamp });
        sendResponse({ success: true });
      }
      return true; // keep message channel open for async sendResponse
    }
  );
});
