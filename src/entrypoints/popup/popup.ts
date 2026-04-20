/**
 * popup.ts — MapyClimbs extension popup.
 * Shows last GPX capture status and climb analysis results.
 */

import {
  StorageKey,
  type ScoringModel,
  type RecategorizeMessage,
  type MapLayerVisibilityMessage,
  type ClimbCategory,
} from "../../types";
import { SCORING_CONFIGS } from "../../scoring";
import { CATEGORY_COLOR } from "../../content/category";

// ── DOM refs ─────────────────────────────────────────────────────────────────

const viewMain = document.getElementById("view-main")!;
const viewSettings = document.getElementById("view-settings")!;
const gearBtn = document.getElementById("gear-btn")!;
const backBtn = document.getElementById("back-btn")!;
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
        `<span class="cat-dot" style="background:${CATEGORY_COLOR[t.category as ClimbCategory] ?? CATEGORY_COLOR["4"]}"></span>` +
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
  chrome.runtime.sendMessage(message, () => {
    // No UI update needed in settings-only popup.
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

// No GPX-specific UI or actions are needed in the popup.
