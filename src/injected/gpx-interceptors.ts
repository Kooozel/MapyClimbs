/**
 * injected/gpx-interceptors.ts
 * Patches window.fetch and XMLHttpRequest to capture GPX export responses
 * and broadcast them via postMessage to the content script.
 */

type RouteMode = "cycling" | "hiking" | "other";

function detectRouteMode(): RouteMode {
  if (document.querySelector("button.active .icon-bike")) return "cycling";
  if (document.querySelector("button.active .icon-walk")) return "hiking";
  return "other";
}

function postGpxFetched(gpxContent: string): void {
  if (!gpxContent.length) return;
  const activeRouteClass = document
    .querySelector<HTMLHeadingElement>("#layout-body > div > div.route-summary h3.active")
    ?.className.split(" ")[0];
  const routeMode = detectRouteMode();
  window.postMessage(
    {
      type: "GPX_FETCHED",
      gpxInfo: { gpxContent, activeRouteClass, routeMode },
      timestamp: Date.now(),
    },
    location.origin
  );
}

function isGpxExportUrl(url: string): boolean {
  return url.includes("tplannerexport") && url.includes("export=gpx");
}

export function installXhrInterceptor(): void {
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;

  (
    XMLHttpRequest.prototype as {
      open: (method: string, url: string | URL, ...rest: unknown[]) => void;
    }
  ).open = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ): void {
    const normalizedUrl = url instanceof URL ? url.href : url;
    if (isGpxExportUrl(normalizedUrl)) {
      this._isGPXRequest = true;
    }
    (originalXHROpen as (...args: unknown[]) => void).apply(this, [method, url, ...rest]);
  };

  XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null): void {
    if (this._isGPXRequest) {
      this.addEventListener("readystatechange", () => {
        if (this.readyState !== 4 || (this.status !== 200 && this.status !== 0)) return;

        if (this.responseType === "blob" && this.response instanceof Blob) {
          (this.response as Blob)
            .text()
            .then((text) => postGpxFetched(text))
            .catch(() => {});
        }
      });
    }

    originalXHRSend.call(this, body);
  };
}
