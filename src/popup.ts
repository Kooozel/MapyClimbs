/**
 * popup.ts — Climb Analyzer extension popup.
 * Shows last GPX capture status and climb analysis results.
 */

import { parseGPX } from "./gpx-parser";
import type { Climb } from "./types";

const dot = document.getElementById("status-dot")!;
const text = document.getElementById("status-text")!;
const spinner = document.getElementById("analysis-spinner")!;
const climbStatsSection = document.getElementById("climb-stats")!;
const retrySection = document.getElementById("retry-section")!;
const retryBtn = document.getElementById("retry-btn")!;
const climbCountEl = document.getElementById("climb-count")!;
const totalDistanceEl = document.getElementById("total-distance")!;

function showSpinner(): void {
  spinner.style.display = "flex";
  climbStatsSection.style.display = "none";
  retrySection.style.display = "none";
}

function hideSpinner(): void {
  spinner.style.display = "none";
}

function updateClimbStats(): void {
  chrome.storage.local.get(["lastClimbResult", "lastTotalDistance"], (data) => {
    hideSpinner();
    const climbs = data["lastClimbResult"] as Climb[] | undefined;
    const totalDistance = data["lastTotalDistance"] as number | undefined;

    if (climbs && climbs.length > 0) {
      climbCountEl.textContent = String(climbs.length);
      totalDistanceEl.textContent = ((totalDistance ?? 0) / 1000).toFixed(1);
      climbStatsSection.style.display = "block";
      retrySection.style.display = "none";
    } else if (climbs !== undefined) {
      climbStatsSection.style.display = "none";
      retrySection.style.display = "block";
    }
  });
}

retryBtn.addEventListener("click", (e) => {
  e.preventDefault();
  chrome.storage.local.get("pendingGPX", (data) => {
    const pendingGPX = data["pendingGPX"] as string | undefined;
    if (pendingGPX) {
      showSpinner();
      chrome.runtime.sendMessage(
        { type: "PROCESS_CLIMBS", elevation: parseGPX(pendingGPX) },
        (response: { climbs?: Climb[] } | undefined) => {
          if (response?.climbs) {
            updateClimbStats();
          }
        }
      );
    }
  });
});

const port = chrome.runtime.connect({ name: "popup" });
port.onMessage.addListener((msg: { type?: string }) => {
  if (msg.type === "GPX_CAPTURED") {
    showSpinner();
    setTimeout(updateClimbStats, 500);
  }
});

chrome.storage.local.get(["gpxCaptureTime", "pendingGPX", "lastClimbResult"], (data) => {
  const climbs = data["lastClimbResult"] as Climb[] | undefined;
  const pendingGPX = data["pendingGPX"] as string | undefined;
  const captureTime = data["gpxCaptureTime"] as number | undefined;

  if (climbs && climbs.length > 0) {
    updateClimbStats();
  } else if (pendingGPX && captureTime) {
    const d = new Date(captureTime);
    const timeStr = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const dateStr = d.toLocaleDateString([], { month: "short", day: "numeric" });
    dot.classList.add("ok");
    text.textContent = `GPX captured at ${timeStr}, ${dateStr}`;
    updateClimbStats();
  } else {
    dot.classList.add("none");
    text.textContent = "No GPX captured yet";
  }
});
