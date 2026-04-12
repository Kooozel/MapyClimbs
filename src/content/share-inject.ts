/**
 * content/share-inject.ts — Injects a MapyClimbs share button into Mapy's
 * native "Send link" share dialog.
 *
 * Selectors (verified against mapy.cz live DOM):
 *   Dialog container : div.mymap-popup.share
 *   Social row       : .share-tab .share-buttons
 *   Short URL input  : .share-tab .inputs input[readonly]
 *   Tab switches     : .share-switch
 */

import { parseGPX } from "../gpx-parser";
import { generateShareCard } from "../share-card";
import { StorageKey, type Climb } from "../types";

// Attribute used as idempotency guard — never inject twice into the same dialog.
const MC_ATTR = "data-mc-share";

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Sets up a MutationObserver that watches for Mapy's share dialog and injects
 * the MapyClimbs split button whenever it appears.
 *
 * @param getClimbs Callback returning the current detected climbs (or null).
 */
export function initShareDialogWatcher(getClimbs: () => Climb[] | null): void {
  const observer = new MutationObserver(() => {
    const dialog = document.querySelector<HTMLElement>("div.mymap-popup.share");
    if (!dialog) return;
    tryInjectShareButton(dialog, getClimbs);
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

// ── Injection logic ───────────────────────────────────────────────────────────

function tryInjectShareButton(dialog: HTMLElement, getClimbs: () => Climb[] | null): void {
  const shareTab = dialog.querySelector<HTMLElement>(".share-tab");
  if (!shareTab?.classList.contains("active")) return;

  const socialRow = shareTab.querySelector<HTMLElement>(".share-buttons");
  if (!socialRow) return;

  // Idempotency: already injected
  if (socialRow.querySelector(`[${MC_ATTR}]`)) return;

  // Keep a reference to the input so URL is read fresh at click time
  const urlInput = shareTab.querySelector<HTMLInputElement>(".inputs input[readonly]");

  const copyBtn = buildCopyButton(urlInput, getClimbs);
  const saveBtn = buildSaveButton(urlInput, getClimbs);
  socialRow.appendChild(copyBtn);
  socialRow.appendChild(saveBtn);

  // Re-inject when user switches tabs back to "Send link"
  dialog.querySelectorAll<HTMLElement>(".share-switch").forEach((tab) => {
    tab.addEventListener(
      "click",
      () => {
        // Remove old buttons so they're rebuilt with a fresh URL
        socialRow.querySelectorAll(`[${MC_ATTR}]`).forEach((el) => el.remove());
        // Give Mapy a tick to toggle .active on .share-tab
        setTimeout(() => tryInjectShareButton(dialog, getClimbs), 50);
      },
      { once: true }
    );
  });
}

// ── Button builder ────────────────────────────────────────────────────────────

function buildSaveButton(
  urlInput: HTMLInputElement | null,
  getClimbs: () => Climb[] | null
): HTMLElement {
  const hasClimbs = (getClimbs()?.length ?? 0) > 0;
  const disabledTip = "No climbs detected yet — export your route first";

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.setAttribute(MC_ATTR, "1");
  saveBtn.className = "share-qr";
  saveBtn.title = hasClimbs ? "Download PNG (MapyClimbs)" : disabledTip;
  saveBtn.disabled = !hasClimbs;
  saveBtn.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">' +
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>' +
    '<polyline points="7 10 12 15 17 10"/>' +
    '<line x1="12" y1="15" x2="12" y2="3"/>' +
    "</svg>Save";

  saveBtn.addEventListener("click", () => handleShare("download", saveBtn, urlInput, getClimbs));
  return saveBtn;
}

function buildCopyButton(
  urlInput: HTMLInputElement | null,
  getClimbs: () => Climb[] | null
): HTMLElement {
  const hasClimbs = (getClimbs()?.length ?? 0) > 0;
  const disabledTip = "No climbs detected yet — export your route first";

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.setAttribute(MC_ATTR, "1");
  copyBtn.className = "share-qr";
  copyBtn.title = hasClimbs ? "Copy image to clipboard (MapyClimbs)" : disabledTip;
  copyBtn.disabled = !hasClimbs;
  copyBtn.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">' +
    '<rect x="9" y="9" width="13" height="13" rx="2"/>' +
    '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>' +
    "</svg>Copy";

  copyBtn.addEventListener("click", () => handleShare("copy", copyBtn, urlInput, getClimbs));
  return copyBtn;
}

// ── Share action ──────────────────────────────────────────────────────────────

async function handleShare(
  mode: "copy" | "download",
  btn: HTMLButtonElement,
  urlInput: HTMLInputElement | null,
  getClimbs: () => Climb[] | null
): Promise<void> {
  const climbs = getClimbs();
  if (!climbs?.length) return;

  const mapyUrl = urlInput?.value?.trim() ?? "";

  const originalHTML = btn.innerHTML;
  btn.innerHTML = "…";
  btn.disabled = true;

  const restore = () => {
    btn.innerHTML = originalHTML;
    btn.disabled = false;
  };

  try {
    const blob = await generateCardBlob(climbs, mapyUrl);
    if (mode === "copy") {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      btn.innerHTML = "✓";
      setTimeout(restore, 1800);
    } else {
      triggerDownload(blob);
      restore();
    }
  } catch (err) {
    console.error("[MapyClimbs] Share card error:", err);
    btn.innerHTML = "!";
    setTimeout(restore, 2000);
  }
}

async function generateCardBlob(climbs: Climb[], mapyUrl: string): Promise<Blob> {
  const gpxRaw = await loadStoredGPX();
  return generateShareCard(climbs, getTotalDistance(climbs), gpxRaw, mapyUrl);
}

async function loadStoredGPX(): Promise<import("../types").ElevationTuple[]> {
  return new Promise((resolve) => {
    chrome.storage.local.get(StorageKey.PendingGPX, (data) => {
      const gpx = data[StorageKey.PendingGPX] as string | undefined;
      if (!gpx) {
        resolve([]);
        return;
      }
      try {
        resolve(parseGPX(gpx));
      } catch {
        resolve([]);
      }
    });
  });
}

function getTotalDistance(climbs: Climb[]): number {
  let max = 0;
  for (const c of climbs) {
    const last = c.segments[c.segments.length - 1];
    if (last && last.endDistance > max) max = last.endDistance;
  }
  return max;
}

function triggerDownload(blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "mapyclimbs-route.png";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
