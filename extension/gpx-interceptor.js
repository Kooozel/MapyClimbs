/**
 * Content Script - Listens for GPX messages from injected script
 * and relays them to background worker
 * Also injects the page-level interceptor script
 */


// Inject the page-level script that actually intercepts network calls
function injectInterceptorScript() {
  try {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('gpx-interceptor-injected.js');
    script.onload = function() {
      this.remove();
    };
    (document.head || document.documentElement).appendChild(script);
  } catch (error) {
  }
}

// Inject immediately - manifest runs this at document_start so documentElement always exists
injectInterceptorScript();

// === LISTEN FOR GPX MESSAGES FROM INJECTED SCRIPT ===
window.addEventListener('message', (event) => {
  // Only accept messages from same window
  if (event.source !== window) {
    return;
  }

  if (event.data?.type === 'GPX_FETCHED') {
    storeAndNotifyGPX(event.data.gpxContent, event.data.timestamp);
  }
});

// === STORAGE AND NOTIFICATION ===
function storeAndNotifyGPX(gpxContent, timestamp) {
  if (!gpxContent || gpxContent.length === 0) return;

  const ts = timestamp ?? Date.now();

  chrome.storage.local.set({
    pendingGPX: gpxContent,
    gpxCaptureTime: ts
  }, () => { void chrome.runtime.lastError; });

  chrome.runtime.sendMessage({
    type: 'GPX_CAPTURED',
    gpxContent,
    timestamp: ts
  }, () => { void chrome.runtime.lastError; });
}

