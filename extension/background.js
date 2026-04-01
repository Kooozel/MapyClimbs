/**
 * background.js - Mapy.cz Climb Analyzer
 * Service worker: Chrome messaging + storage glue only.
 * All climb detection logic lives in climb-engine.js.
 */

import { detectClimbs } from './climb-engine.js';

// --- Storage version guard ---------------------------------------------------
// Increment STORAGE_VERSION whenever the stored data schema changes so that
// stale cached results are flushed on extension update.
const STORAGE_VERSION = 1;

chrome.storage.local.get('storageVersion', (result) => {
  if (result.storageVersion !== STORAGE_VERSION) {
    console.log('[ClimbAnalyzer] Storage version mismatch, clearing old cache');
    chrome.storage.local.clear(() => {
      chrome.storage.local.set({ storageVersion: STORAGE_VERSION });
    });
  }
});

// --- Popup port management ---------------------------------------------------
// Keep track of open popup connections so we can push GPX_CAPTURED events.
let popupPorts = [];

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'popup') {
    popupPorts.push(port);
    port.onDisconnect.addListener(() => {
      popupPorts = popupPorts.filter(p => p !== port);
    });
  }
});

// --- Message handler ---------------------------------------------------------

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'PROCESS_CLIMBS') {
    try {
      const climbs = detectClimbs(request.elevation);
      const totalDistance = request.elevation.length > 0
        ? request.elevation[request.elevation.length - 1][0] : 0;
      chrome.storage.local.set({ lastClimbResult: climbs, lastTotalDistance: totalDistance });
      sendResponse({ climbs, totalDistance });
    } catch (error) {
      console.error('[ClimbAnalyzer] Climb detection error:', error);
      sendResponse({ climbs: [], error: error.message });
    }

  } else if (request.type === 'GPX_CAPTURED') {
    chrome.storage.local.set({
      pendingGPX:     request.gpxContent,
      gpxCaptureTime: request.timestamp
    }, () => {
      popupPorts.forEach(port => {
        try { port.postMessage({ type: 'GPX_CAPTURED', timestamp: request.timestamp }); }
        catch (_) {}
      });
    });
    sendResponse({ success: true });
  }
});


