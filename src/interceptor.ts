/**
 * interceptor.ts — Content script (document_start).
 * Injects gpx-interceptor-injected.js into the page context and relays
 * GPX_FETCHED postMessages to the background service worker via storage +
 * chrome.runtime.sendMessage.
 */

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

window.addEventListener("message", (event: MessageEvent) => {
  if (event.source !== window) return;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = event.data as any;
  if (data?.type === "GPX_FETCHED") {
    storeAndNotifyGPX(String(data.gpxContent), typeof data.timestamp === "number" ? data.timestamp : undefined);
  }
});

function storeAndNotifyGPX(gpxContent: string, timestamp?: number): void {
  if (!gpxContent || gpxContent.length === 0) return;

  const ts = timestamp ?? Date.now();

  chrome.storage.local.set({ pendingGPX: gpxContent, gpxCaptureTime: ts }, () => {
    void chrome.runtime.lastError;
  });

  chrome.runtime.sendMessage({ type: "GPX_CAPTURED", gpxContent, timestamp: ts }, () => {
    void chrome.runtime.lastError;
  });
}
