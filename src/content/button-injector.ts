import { ElementId } from "../constants";

export function tryInjectButton(): void {
  if (document.getElementById(ElementId.Button)) return;
  const target = document.querySelector(".route-actions");
  if (!target) return;
  target.appendChild(buildButton());
}

function buildButton(): HTMLDivElement {
  const btn = document.createElement("div");
  btn.id = ElementId.Button;
  btn.className = "icon-action";
  btn.innerHTML = `
    <button type="button">
      <img src="${chrome.runtime.getURL("images/icon-48.png")}" width="24" height="24" alt="" aria-hidden="true">
      <span>${chrome.i18n.getMessage("panelTitle")}</span>
    </button>`;
  btn.querySelector("button")!.addEventListener("click", onClimbButtonClick);
  return btn;
}

async function onClimbButtonClick(): Promise<void> {
  const routes = document.querySelectorAll<HTMLHeadingElement>(
    "#layout-body > div > div.route-summary h3"
  );
  if (routes.length === 0) {
    return;
  }

  let originalRoute;

  for (const route of routes) {
    if (route.classList.contains("active")) {
      originalRoute = route;
    } else {
      route.click();
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
    await triggerExportAndSave();
  }

  originalRoute?.click();
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

/**
 * Encapsulates the MutationObserver logic into a Promise
 * so we can "await" the completion of one route before starting the next.
 */
function triggerExportAndSave(): Promise<void> {
  return new Promise((resolve) => {
    const exportBtn = findGPXExportButton();
    if (!exportBtn) {
      resolve();
      return;
    }

    const observer = new MutationObserver(() => {
      const saveBtn = document.querySelector<HTMLElement>(".mymaps-dialog__saveBtn");
      if (!saveBtn) return;

      observer.disconnect();

      // Visual suppression logic
      const dialogRoot = saveBtn.closest<HTMLElement>(".mymaps-dialog__content");
      if (dialogRoot) {
        dialogRoot.style.setProperty("opacity", "0", "important");
        if (dialogRoot.parentElement) {
          dialogRoot.parentElement.style.setProperty("opacity", "0", "important");
        }
      }

      window.postMessage({ type: "CLIMB_SUPPRESS_DOWNLOAD" }, location.origin);

      saveBtn.click();

      // Give the "Save" action a moment to process before resolving
      setTimeout(resolve, 1000);
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Click the export button to trigger the dialog
    (exportBtn as HTMLElement).click();

    // Timeout safety
    setTimeout(() => {
      observer.disconnect();
      resolve();
    }, 5000);
  });
}
