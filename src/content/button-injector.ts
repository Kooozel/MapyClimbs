import { ElementId } from "../constants";

export function tryInjectButton(
  onRouteActive: (routeClass: string) => void,
  onDone: () => void
): void {
  if (document.getElementById(ElementId.Button)) return;
  const target = document.querySelector(".route-actions");
  if (!target) return;
  target.appendChild(buildButton(onRouteActive, onDone));
}

function buildButton(
  onRouteActive: (routeClass: string) => void,
  onDone: () => void
): HTMLDivElement {
  const btn = document.createElement("div");
  btn.id = ElementId.Button;
  btn.className = "icon-action";
  btn.innerHTML = `
    <button type="button">
      <img src="${chrome.runtime.getURL("images/icon-48.png")}" width="24" height="24" alt="" aria-hidden="true">
      <span>${chrome.i18n.getMessage("panelTitle")}</span>
    </button>`;

  btn
    .querySelector("button")!
    .addEventListener("click", () => runAutomatedClimb(onRouteActive, onDone));
  return btn;
}

async function runAutomatedClimb(
  onRouteActive: (routeClass: string) => void,
  onDone: () => void
): Promise<void> {
  const routes = document.querySelectorAll<HTMLHeadingElement>(
    "#layout-body > div > div.route-summary h3"
  );
  if (routes.length === 0) return;

  let originalRoute: HTMLHeadingElement | null = null;

  for (const route of routes) {
    const routeClass = route.className.split(" ").find((c) => c.startsWith("alt-")) ?? "alt-0";

    if (route.classList.contains("active")) {
      originalRoute = route;
    } else {
      route.click();
      await new Promise((resolve) => setTimeout(resolve, 800));
    }

    // 2. IMPORTANT: Update the Controller's state so it knows which key to use
    onRouteActive(routeClass);

    // 3. Trigger the export for THIS specific route
    await triggerExportAndSave();

    // Give the interceptor a moment to catch the file before switching tabs
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  // Restore the original route view
  originalRoute?.click();
  onDone();
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

    // Hide the backdrop before it paints; removed after dialog is fully gone
    const suppressStyle = document.createElement("style");
    suppressStyle.textContent = "body>div.mymaps-dialog__cover{opacity:0!important}";
    document.head.appendChild(suppressStyle);

    const observer = new MutationObserver(() => {
      const saveBtn = document.querySelector<HTMLElement>(".mymaps-dialog__saveBtn");
      if (!saveBtn) return;

      observer.disconnect();

      const dialogRoot = saveBtn.closest<HTMLElement>(".mymaps-dialog__content");
      if (dialogRoot) {
        dialogRoot.style.setProperty("opacity", "0", "important");
        if (dialogRoot.parentElement)
          dialogRoot.parentElement.style.setProperty("opacity", "0", "important");
      }

      window.postMessage({ type: "CLIMB_SUPPRESS_DOWNLOAD" }, location.origin);
      saveBtn.click();

      setTimeout(() => {
        suppressStyle.remove();
        resolve();
      }, 1000);
    });

    observer.observe(document.body, { childList: true, subtree: true });
    (exportBtn as HTMLElement).click();

    setTimeout(() => {
      observer.disconnect();
      suppressStyle.remove();
      resolve();
    }, 5000);
  });
}
