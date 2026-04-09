/**
 * popup.ts — MapyClimbs extension popup.
 * Shows last GPX capture status and climb analysis results.
 */

import {
  StorageKey,
  type Climb,
  type AnalyzeGpxMessage,
  type ClimbsResponse,
  type PortMessage,
  type ScoringModel,
  type RecategorizeMessage,
  type MapLayerVisibilityMessage,
} from "../../types";
import { SCORING_CONFIGS } from "../../scoring";

// ── DOM refs ─────────────────────────────────────────────────────────────────

const viewMain = document.getElementById("view-main")!;
const viewSettings = document.getElementById("view-settings")!;
const gearBtn = document.getElementById("gear-btn")!;
const backBtn = document.getElementById("back-btn")!;

const dot = document.getElementById("status-dot")!;
const text = document.getElementById("status-text")!;
const spinner = document.getElementById("analysis-spinner")!;
const climbStatsSection = document.getElementById("climb-stats")!;
const climbStatsText = document.getElementById("climb-stats-text")!;
const retrySection = document.getElementById("retry-section")!;
const retryBtn = document.getElementById("retry-btn")!;
const catList = document.getElementById("cat-list")!;
const catFormula = document.getElementById("cat-formula")!;
const modelDesc = document.getElementById("model-desc")!;
const mapLayerToggle = document.getElementById("map-layer-toggle")! as HTMLInputElement;

// ── i18n ─────────────────────────────────────────────────────────────────────

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

// Populate version from manifest
const versionEl = document.getElementById("ext-version");
if (versionEl) versionEl.textContent = `v${chrome.runtime.getManifest().version}`;

// ── View routing ──────────────────────────────────────────────────────────────

function showMain(): void {
  viewMain.style.display = "";
  viewSettings.style.display = "none";
}

function showSettings(): void {
  viewMain.style.display = "none";
  viewSettings.style.display = "";
}

gearBtn.addEventListener("click", showSettings);
backBtn.addEventListener("click", showMain);

// ── Categories rendering ──────────────────────────────────────────────────────

const CAT_COLORS: Record<string, string> = {
  HC: "#d42b2b",
  "1": "#e85d17",
  "2": "#e8a117",
  "3": "#c8c022",
  "4": "#6b7280",
};

function formatThreshold(min: number, index: number, allMins: readonly number[]): string {
  if (index === allMins.length - 1 && min === 0) {
    return `< ${allMins[index - 1].toLocaleString("en")}`;
  }
  return `\u2265 ${min.toLocaleString("en")}`;
}

function renderCategories(model: ScoringModel): void {
  const cfg = SCORING_CONFIGS[model];
  const mins = cfg.thresholds.map((t) => t.min);
  catList.innerHTML = cfg.thresholds
    .map((t, i) => {
      const label = t.category === "HC" ? "HC" : `Cat ${t.category}`;
      const score = formatThreshold(t.min, i, mins);
      return (
        `<div class="cat-row">` +
        `<span class="cat-dot" style="background:${CAT_COLORS[t.category] ?? CAT_COLORS["4"]}"></span>` +
        `<span class="cat-label">${label}</span>` +
        `<span class="cat-score">${score}</span>` +
        `</div>`
      );
    })
    .join("");

  if (model === "garmin") {
    catFormula.textContent = chrome.i18n.getMessage("popupFormulaGarmin");
    modelDesc.textContent = chrome.i18n.getMessage("popupModelDescGarmin");
  } else {
    catFormula.textContent = chrome.i18n.getMessage("popupFormulaASO");
    modelDesc.textContent = chrome.i18n.getMessage("popupModelDescASO");
  }
}

// ── Scoring model toggle ──────────────────────────────────────────────────────

function setActiveModelBtn(model: ScoringModel): void {
  document.querySelectorAll<HTMLButtonElement>(".model-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.model === model);
  });
}

function recategorizeWithModel(): void {
  const message: RecategorizeMessage = { type: "RECATEGORIZE_CLIMBS" };
  chrome.runtime.sendMessage(message, (response: ClimbsResponse | undefined) => {
    if (chrome.runtime.lastError || !response) return;
    updateClimbStats();
  });
}

document.querySelectorAll<HTMLButtonElement>(".model-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const model = btn.dataset.model as ScoringModel;
    chrome.storage.local.set({ [StorageKey.ScoringModel]: model }, () => {
      setActiveModelBtn(model);
      renderCategories(model);
      recategorizeWithModel();
    });
  });
});

chrome.storage.local.get(StorageKey.ScoringModel, (pref) => {
  const model = (pref[StorageKey.ScoringModel] as ScoringModel | undefined) ?? "aso";
  setActiveModelBtn(model);
  renderCategories(model);
});

// ── Map layer toggle ──────────────────────────────────────────────────────────

chrome.storage.local.get(StorageKey.MapLayerVisible, (pref) => {
  const visible = pref[StorageKey.MapLayerVisible] as boolean | undefined;
  mapLayerToggle.checked = visible !== false; // default true
});

mapLayerToggle.addEventListener("change", () => {
  const visible = mapLayerToggle.checked;
  chrome.storage.local.set({ [StorageKey.MapLayerVisible]: visible });
  // Broadcast to all open tabs so already-open pages stay in sync.
  chrome.tabs.query({}, (tabs) => {
    const msg: MapLayerVisibilityMessage = { type: "MAP_LAYER_VISIBILITY_CHANGED", visible };
    for (const tab of tabs) {
      if (!tab.id) continue;
      chrome.tabs.sendMessage(tab.id, msg).catch(() => {
        // Content script not present on this tab — ignore
      });
    }
  });
});

// ── Spinner helpers ───────────────────────────────────────────────────────────

function showSpinner(): void {
  spinner.style.display = "flex";
  climbStatsSection.style.display = "none";
  retrySection.style.display = "none";
}

function hideSpinner(): void {
  spinner.style.display = "none";
}

function updateClimbStats(): void {
  chrome.storage.local.get([StorageKey.LastClimbResult, StorageKey.LastTotalDistance], (data) => {
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
  });
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
