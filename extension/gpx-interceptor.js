/**
 * Content Script - Listens for GPX messages from injected script
 * and relays them to background worker
 * Also injects the page-level interceptor script
 */

console.log('[GPX Interceptor - Content Script] Loaded');

// Inject the page-level script that actually intercepts network calls
function injectInterceptorScript() {
  try {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('gpx-interceptor-injected.js');
    script.onload = function() {
      this.remove();
      console.log('[GPX Interceptor] ✓ Injected script loaded and removed');
    };
    (document.head || document.documentElement).appendChild(script);
    console.log('[GPX Interceptor] ✓ Injected interceptor script into page');
  } catch (error) {
    console.error('[GPX Interceptor] Error injecting script:', error);
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

  if (event.data.type === 'GPX_FETCHED') {
    console.log('[GPX Interceptor - Content Script] ✓ Received GPX message from injected script, source:', event.data.source);
    storeAndNotifyGPX(event.data.gpxContent, event.data.timestamp);
  }
});

// === STORAGE AND NOTIFICATION ===
function storeAndNotifyGPX(gpxContent, timestamp) {
  if (!gpxContent || gpxContent.length === 0) {
    console.warn('[GPX Interceptor] Empty GPX content');
    return;
  }

  timestamp = timestamp || Date.now();

  console.log('[GPX Interceptor] Processing captured GPX, length:', gpxContent.length);

  // Store in chrome.storage.local 
  chrome.storage.local.set({ 
    'pendingGPX': gpxContent,
    'gpxCaptureTime': timestamp
  }, () => {
    if (chrome.runtime.lastError) {
      console.error('[GPX Interceptor] Storage error:', chrome.runtime.lastError);
    } else {
      console.log('[GPX Interceptor] ✓ GPX stored in chrome.storage.local');
    }
  });

  // Also store in sessionStorage as immediate fallback
  try {
    sessionStorage.setItem('pendingGPX', gpxContent);
    sessionStorage.setItem('gpxCaptureTime', timestamp);
    console.log('[GPX Interceptor] ✓ GPX also stored in sessionStorage');
  } catch (error) {
    console.log('[GPX Interceptor] Could not write to sessionStorage:', error.message);
  }

  // Send message to background worker
  chrome.runtime.sendMessage({
    type: 'GPX_CAPTURED',
    gpxContent: gpxContent,
    timestamp: timestamp
  }, (response) => {
    if (chrome.runtime.lastError) {
      console.log('[GPX Interceptor] Background not ready, but GPX is stored:', chrome.runtime.lastError.message);
    } else {
      console.log('[GPX Interceptor] ✓ Background worker notified');
    }
  });
}

console.log('[GPX Interceptor - Content Script] ✓ Ready - Waiting for GPX capture messages');
