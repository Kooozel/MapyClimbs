/**
 * injected/gpx-interceptors.ts
 * Patches window.fetch and XMLHttpRequest to capture GPX export responses
 * and broadcast them via postMessage to the content script.
 */

function postGpxFetched(gpxContent: string, source: string): void {
  if (!gpxContent.length) return;
  window.postMessage(
    { type: "GPX_FETCHED", gpxContent, source, timestamp: Date.now() },
    location.origin
  );
}

function isGpxExportUrl(url: string): boolean {
  return url.includes("tplannerexport") && url.includes("export=gpx");
}

export function installFetchInterceptor(): void {
  const originalFetch = window.fetch;

  window.fetch = (...args: Parameters<typeof fetch>): ReturnType<typeof fetch> => {
    const [input] = args;
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

    if (!isGpxExportUrl(url)) {
      return originalFetch(...args);
    }

    const fetchPromise = originalFetch(...args);

    fetchPromise
      .then((response) => {
        const contentType = response.headers.get("content-type") ?? "";
        const cloned = response.clone();

        if (
          contentType.includes("application/octet-stream") ||
          contentType.includes("application/blob")
        ) {
          cloned
            .blob()
            .then((blob) => blob.text())
            .then((text) => postGpxFetched(text, "fetch-blob"))
            .catch(() => {});
        } else {
          cloned
            .text()
            .then((text) => postGpxFetched(text, "fetch-text"))
            .catch(() => {});
        }
        return response;
      })
      .catch(() => {});

    return fetchPromise;
  };
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
            .then((text) => postGpxFetched(text, "xhr-blob"))
            .catch(() => {});
        } else if (this.responseType === "" || this.responseType === "text") {
          postGpxFetched(this.responseText || (this.response as string), "xhr-text");
        } else if (typeof this.response === "string") {
          postGpxFetched(this.response, "xhr-response");
        }
      });
    }

    originalXHRSend.call(this, body);
  };
}
