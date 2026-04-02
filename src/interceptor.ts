/**
 * interceptor.ts — Content script (document_start).
 * Injects gpx-interceptor-injected.js into the page context and relays
 * GPX_FETCHED postMessages to the background service worker via storage +
 * chrome.runtime.sendMessage.
 */

import { StorageKey, type GpxCapturedMessage } from "./types";

function injectInterceptorScript(): void {
  try {
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("gpx-interceptor-injected.js");
    script.onload = () => script.remove();
    (document.head ?? document.documentElement).appendChild(script);
  } catch {
    // document_start: documentElement always exists; catch is safety-only
  }
}

injectInterceptorScript();

// ── Type guard for page-context postMessages ──────────────────────────────────

interface PageGpxFetchedEvent {
  type: "GPX_FETCHED";
  gpxContent: string;
  timestamp?: number;
}

function isGpxFetchedEvent(data: unknown): data is PageGpxFetchedEvent {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as Record<string, unknown>)["type"] === "GPX_FETCHED" &&
    typeof (data as Record<string, unknown>)["gpxContent"] === "string"
  );
}

window.addEventListener("message", (event: MessageEvent) => {
  if (event.source !== window) return;
  if (event.origin !== location.origin) return;

  if (isGpxFetchedEvent(event.data)) {
    const ts = typeof event.data.timestamp === "number" ? event.data.timestamp : Date.now();
    storeAndNotifyGPX(event.data.gpxContent, ts);
  }
});

// ── Storage write + background notification ───────────────────────────────────

function storeAndNotifyGPX(gpxContent: string, timestamp: number): void {
  if (gpxContent.length === 0) return;

  // Write to storage first — this is the durable path.
  // If the service worker is sleeping, the data is safe in storage even if the
  // message below fails to wake it in time.
  chrome.storage.local.set(
    { [StorageKey.PendingGPX]: gpxContent, [StorageKey.GpxCaptureTime]: timestamp },
    () => {
      if (chrome.runtime.lastError) return;
      const message: GpxCapturedMessage = { type: "GPX_CAPTURED", timestamp };
      chrome.runtime.sendMessage(message, () => {
        void chrome.runtime.lastError; // background may still be starting up
      });
    }
  );
}
