/**
 * background.ts — Mapy.cz Climb Analyzer service worker.
 * Chrome messaging + storage glue only. All detection logic lives in climb-engine.ts.
 */

import { detectClimbs } from "./climb-engine";
import type { Climb, ElevationTuple } from "./types";

// ── Storage version guard ─────────────────────────────────────────────────────

const STORAGE_VERSION = 1;

chrome.storage.local.get("storageVersion", (result) => {
  if (result["storageVersion"] !== STORAGE_VERSION) {
    console.log("[ClimbAnalyzer] Storage version mismatch, clearing old cache");
    chrome.storage.local.clear(() => {
      chrome.storage.local.set({ storageVersion: STORAGE_VERSION });
    });
  }
});

// ── Popup port management ─────────────────────────────────────────────────────

let popupPorts: chrome.runtime.Port[] = [];

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "popup") {
    popupPorts.push(port);
    port.onDisconnect.addListener(() => {
      popupPorts = popupPorts.filter((p) => p !== port);
    });
  }
});

// ── Message types ─────────────────────────────────────────────────────────────

interface ProcessClimbsMessage {
  type: "PROCESS_CLIMBS";
  elevation: ElevationTuple[];
}

interface GpxCapturedMessage {
  type: "GPX_CAPTURED";
  gpxContent: string;
  timestamp: number;
}

type ExtensionMessage = ProcessClimbsMessage | GpxCapturedMessage;

interface ProcessClimbsResponse {
  climbs: Climb[];
  totalDistance: number;
  error?: string;
}

interface GpxCapturedResponse {
  success: true;
}

// ── Message handler ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (
    request: ExtensionMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: ProcessClimbsResponse | GpxCapturedResponse) => void
  ) => {
    if (request.type === "PROCESS_CLIMBS") {
      try {
        const climbs = detectClimbs(request.elevation);
        const totalDistance =
          request.elevation.length > 0
            ? request.elevation[request.elevation.length - 1][0]
            : 0;
        chrome.storage.local.set({ lastClimbResult: climbs, lastTotalDistance: totalDistance });
        sendResponse({ climbs, totalDistance });
      } catch (error) {
        console.error("[ClimbAnalyzer] Climb detection error:", error);
        sendResponse({
          climbs: [],
          totalDistance: 0,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } else if (request.type === "GPX_CAPTURED") {
      chrome.storage.local.set(
        { pendingGPX: request.gpxContent, gpxCaptureTime: request.timestamp },
        () => {
          popupPorts.forEach((port) => {
            try {
              port.postMessage({ type: "GPX_CAPTURED", timestamp: request.timestamp });
            } catch {}
          });
        }
      );
      sendResponse({ success: true });
    }
    return true; // keep message channel open for async sendResponse
  }
);
