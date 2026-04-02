/**
 * popup.ts — MapyClimbs extension popup.
 * Shows last GPX capture status and climb analysis results.
 */

import { StorageKey, type Climb, type AnalyzeGpxMessage, type ClimbsResponse, type PortMessage } from "./types";

const dot = document.getElementById("status-dot")!;
const text = document.getElementById("status-text")!;
const spinner = document.getElementById("analysis-spinner")!;
const climbStatsSection = document.getElementById("climb-stats")!;
const climbStatsText = document.getElementById("climb-stats-text")!;
const retrySection = document.getElementById("retry-section")!;
const retryBtn = document.getElementById("retry-btn")!;

// Apply Chrome i18n translations to all data-i18n / data-i18n-html elements
function applyI18n(): void {
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    const msg = chrome.i18n.getMessage(el.dataset.i18n!);
    if (msg) el.textContent = msg;
  });
  document.querySelectorAll<HTMLElement>("[data-i18n-html]").forEach((el) => {
    const msg = chrome.i18n.getMessage(el.dataset.i18nHtml!);
    if (msg) el.innerHTML = msg;
  });
}
applyI18n();

// Populate version from manifest — avoids hardcoded string drifting out of sync
const versionEl = document.getElementById("ext-version");
if (versionEl) versionEl.textContent = `v${chrome.runtime.getManifest().version}`;

function showSpinner(): void {
  spinner.style.display = "flex";
  climbStatsSection.style.display = "none";
  retrySection.style.display = "none";
}

function hideSpinner(): void {
  spinner.style.display = "none";
}

function updateClimbStats(): void {
  chrome.storage.local.get(
    [StorageKey.LastClimbResult, StorageKey.LastTotalDistance],
    (data) => {
      hideSpinner();
      const climbs = data[StorageKey.LastClimbResult] as Climb[] | undefined;
      const totalDistance = data[StorageKey.LastTotalDistance] as number | undefined;

      if (climbs && climbs.length > 0) {
        climbStatsText.innerHTML = chrome.i18n.getMessage("popupClimbsDetected", [
          `<strong>${climbs.length}</strong>`,
          `<strong>${((totalDistance ?? 0) / 1000).toFixed(1)}</strong>`,
        ]);
        climbStatsSection.style.display = "block";
        retrySection.style.display = "none";
      } else if (climbs !== undefined) {
        climbStatsSection.style.display = "none";
        retrySection.style.display = "block";
      }
    }
  );
}

retryBtn.addEventListener("click", (e) => {
  e.preventDefault();
  chrome.storage.local.get(StorageKey.PendingGPX, (data) => {
    const pendingGPX = data[StorageKey.PendingGPX] as string | undefined;
    if (pendingGPX) {
      showSpinner();
      const message: AnalyzeGpxMessage = { type: "ANALYZE_GPX", gpxContent: pendingGPX };
      chrome.runtime.sendMessage(message, (response: ClimbsResponse | undefined) => {
        if (chrome.runtime.lastError || !response?.climbs) return;
        updateClimbStats();
      });
    }
  });
});

const port = chrome.runtime.connect({ name: "popup" });
port.onMessage.addListener((msg: PortMessage) => {
  if (msg.type === "GPX_CAPTURED") {
    showSpinner();
    setTimeout(updateClimbStats, 500);
  }
});

chrome.storage.local.get(
  [StorageKey.GpxCaptureTime, StorageKey.PendingGPX, StorageKey.LastClimbResult],
  (data) => {
    const climbs = data[StorageKey.LastClimbResult] as Climb[] | undefined;
    const pendingGPX = data[StorageKey.PendingGPX] as string | undefined;
    const captureTime = data[StorageKey.GpxCaptureTime] as number | undefined;

    if (climbs && climbs.length > 0) {
      updateClimbStats();
    } else if (pendingGPX && captureTime) {
      const d = new Date(captureTime);
      const timeStr = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const dateStr = d.toLocaleDateString([], { month: "short", day: "numeric" });
      dot.classList.add("ok");
      text.textContent = chrome.i18n.getMessage("popupStatusCaptured", [timeStr, dateStr]);
      updateClimbStats();
    } else {
      dot.classList.add("none");
      text.textContent = chrome.i18n.getMessage("popupStatusNone");
    }
  }
);
