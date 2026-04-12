export function tryInjectButton(): void {
  if (document.getElementById("climb-inject-button")) return;
  const target = document.querySelector(".route-actions");
  if (!target) return;
  target.appendChild(buildButton());
}

function buildButton(): HTMLDivElement {
  const btn = document.createElement("div");
  btn.id = "climb-inject-button";
  btn.className = "icon-action";
  btn.innerHTML = `
    <button type="button">
      <img src="${chrome.runtime.getURL("images/icon-48.png")}" width="24" height="24" alt="" aria-hidden="true">
      <span>${chrome.i18n.getMessage("panelTitle")}</span>
    </button>`;
  btn.querySelector("button")!.addEventListener("click", onClimbButtonClick);
  return btn;
}

function onClimbButtonClick(): void {
  const exportBtn = findGPXExportButton();
  if (!exportBtn) return;

  const observer = new MutationObserver(() => {
    const saveBtn = document.querySelector<HTMLElement>(".mymaps-dialog__saveBtn");
    if (!saveBtn) return;
    observer.disconnect();

    const dialogRoot = saveBtn.closest<HTMLElement>(".mymaps-dialog__content");
    if (dialogRoot) {
      dialogRoot.style.setProperty("opacity", "0", "important");
      dialogRoot.style.setProperty("pointer-events", "none", "important");
      if (dialogRoot.parentElement) {
        dialogRoot.parentElement.style.setProperty("opacity", "0", "important");
        dialogRoot.parentElement.style.setProperty("pointer-events", "none", "important");
      }
    }

    window.postMessage({ type: "CLIMB_SUPPRESS_DOWNLOAD" }, location.origin);
    saveBtn.click();
  });

  observer.observe(document.body, { childList: true, subtree: true });
  setTimeout(() => observer.disconnect(), 5000);
  (exportBtn as HTMLElement).click();
}

function findGPXExportButton(): Element | null {
  const confirmed = document.querySelector('.icon-action[title="Export"] button');
  if (confirmed) return confirmed;
  const bySvg = document.querySelector("button .icon-export2");
  if (bySvg) return bySvg.closest("button");
  for (const el of Array.from(document.querySelectorAll('button, a, [role="button"]'))) {
    const t = el.textContent?.trim() ?? "";
    if (t === "Export" || t === "GPX" || t === "Export GPX") return el;
  }
  return null;
}
