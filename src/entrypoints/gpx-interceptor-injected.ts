/**
 * gpx-interceptor-injected entrypoint — Page-context unlisted script (web_accessible_resource).
 * Intercepts fetch/XHR GPX export requests and captures the SMap instance.
 * Communicates with the content script (interceptor.content.ts) via postMessage.
 *
 * Runs in the page's JavaScript context (not a content script sandbox),
 * so it can patch window.fetch and XMLHttpRequest prototypes.
 */

// ── Ambient declarations for Mapy.cz globals ─────────────────────────────────

interface SMapInstance {
  addLayer(layer: SMapLayerMarker): void;
  removeLayer(layer: SMapLayerMarker): void;
  getCenter(): unknown;
}

interface SMapLayerMarker {
  enable(): void;
  addMarker(marker: unknown): void;
}

interface SMapConstructorStatic {
  prototype: Record<string, ((...args: unknown[]) => unknown) | undefined>;
  _climbHooked?: boolean;
  Coords: { fromWGS84(lon: number, lat: number): unknown };
  Layer: { Marker: new () => SMapLayerMarker };
  Marker: new (
    coords: unknown,
    id: string,
    opts: {
      url: HTMLImageElement;
      size: [number, number];
      anchor: { left: number; bottom: number };
      title: string;
    }
  ) => unknown;
}

interface InjectClimbData {
  category: string;
  distance: number;
  elevation: number;
  markerCoords: { lat: number; lon: number } | null;
}

declare global {
  interface Window {
    SMap?: SMapConstructorStatic;
    __climbMap?: SMapInstance;
    __climbMarkerLayer?: SMapLayerMarker;
  }

  interface XMLHttpRequest {
    _isGPXRequest?: boolean;
  }
}

export default defineUnlistedScript(() => {
  // ── Download suppression ────────────────────────────────────────────────────

  let _suppressNextDownload = false;

  window.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== window || event.origin !== location.origin) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = event.data as any;
    if (data && data.type === "CLIMB_SUPPRESS_DOWNLOAD") {
      _suppressNextDownload = true;
    }
  });

  const _origAnchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    if (_suppressNextDownload && this.download && this.href.startsWith("blob:")) {
      _suppressNextDownload = false;
      return;
    }
    return _origAnchorClick.call(this);
  };

  // ── Fetch interceptor ───────────────────────────────────────────────────────

  const originalFetch = window.fetch;

  window.fetch = (...args: Parameters<typeof fetch>): ReturnType<typeof fetch> => {
    const [input] = args;
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

    if (url.includes("tplannerexport") && url.includes("export=gpx")) {
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
              .then((gpxContent) => {
                if (gpxContent.length > 0) {
                  window.postMessage(
                    { type: "GPX_FETCHED", gpxContent, source: "fetch-blob", timestamp: Date.now() },
                    location.origin
                  );
                }
              })
              .catch(() => {});
          } else {
            cloned
              .text()
              .then((gpxContent) => {
                if (gpxContent.length > 0) {
                  window.postMessage(
                    { type: "GPX_FETCHED", gpxContent, source: "fetch-text", timestamp: Date.now() },
                    location.origin
                  );
                }
              })
              .catch(() => {});
          }
          return response;
        })
        .catch(() => {});

      return fetchPromise;
    }

    return originalFetch(...args);
  };

  // ── XHR interceptor ─────────────────────────────────────────────────────────

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
    if (typeof url === "string" && url.includes("tplannerexport") && url.includes("export=gpx")) {
      this._isGPXRequest = true;
    }
    (originalXHROpen as (...args: unknown[]) => void).apply(this, [method, url, ...rest]);
  };

  XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null): void {
    if (this._isGPXRequest) {
      const onReadyStateChange = (): void => {
        if (this.readyState !== 4 || (this.status !== 200 && this.status !== 0)) return;

        if (this.responseType === "blob" && this.response instanceof Blob) {
          (this.response as Blob)
            .text()
            .then((text) => {
              if (text.length > 0) {
                window.postMessage(
                  { type: "GPX_FETCHED", gpxContent: text, source: "xhr-blob", timestamp: Date.now() },
                  location.origin
                );
              }
            })
            .catch(() => {});
        } else if (this.responseType === "" || this.responseType === "text") {
          const gpxContent = this.responseText || (this.response as string);
          if (gpxContent && gpxContent.length > 0) {
            window.postMessage(
              { type: "GPX_FETCHED", gpxContent, source: "xhr-text", timestamp: Date.now() },
              location.origin
            );
          }
        } else if (typeof this.response === "string" && this.response.length > 0) {
          window.postMessage(
            { type: "GPX_FETCHED", gpxContent: this.response, source: "xhr-response", timestamp: Date.now() },
            location.origin
          );
        }
      };

      this.addEventListener("readystatechange", onReadyStateChange);
    }

    originalXHRSend.call(this, body);
  };

  // ── SMap instance capture ───────────────────────────────────────────────────

  let _smapRef: SMapConstructorStatic | null = null;
  let _smapPoll: ReturnType<typeof setInterval> | null = null;

  function isDuckTypedSMap(v: unknown): v is SMapInstance {
    return (
      v !== null &&
      typeof v === "object" &&
      typeof (v as Record<string, unknown>)["addLayer"] === "function" &&
      typeof (v as Record<string, unknown>)["getCenter"] === "function"
    );
  }

  function captureInstance(inst: unknown): void {
    if (!window.__climbMap && isDuckTypedSMap(inst)) {
      window.__climbMap = inst;
      if (_smapPoll !== null) clearInterval(_smapPoll);
    }
  }

  function applySMapHooks(S: SMapConstructorStatic): void {
    if (!S || S._climbHooked) return;
    S._climbHooked = true;
    _smapRef = S;

    const hookMethods = [
      "$constructor",
      "addLayer",
      "setCenter",
      "getCenter",
      "addDefaultLayer",
      "lock",
      "unlock",
      "redraw",
    ];
    const proto = S.prototype;
    hookMethods.forEach((name) => {
      if (!proto[name]) return;
      const _orig = proto[name]!;
      proto[name] = function (this: SMapInstance, ...args: unknown[]) {
        captureInstance(this);
        return _orig.apply(this, args);
      };
    });
  }

  if (window.SMap) {
    applySMapHooks(window.SMap);
  }

  try {
    let _smapValue: SMapConstructorStatic | undefined = window.SMap;
    Object.defineProperty(window, "SMap", {
      get(): SMapConstructorStatic | undefined {
        return _smapValue;
      },
      set(val: SMapConstructorStatic | undefined): void {
        _smapValue = val;
        if (val) applySMapHooks(val);
      },
      configurable: true,
    });
  } catch {
    // defineProperty failed — fall through to polling
  }

  let _pollCount = 0;
  _smapPoll = setInterval(() => {
    if (window.__climbMap || _pollCount++ > 20) {
      clearInterval(_smapPoll!);
      return;
    }
    const S = window.SMap;
    if (S && !S._climbHooked) applySMapHooks(S);
  }, 500);

  function discoverMapInstance(): SMapInstance | null {
    if (window.__climbMap) return window.__climbMap;

    for (const key of Object.keys(window)) {
      try {
        const v = (window as unknown as Record<string, unknown>)[key];
        if (isDuckTypedSMap(v)) {
          captureInstance(v);
          return window.__climbMap ?? null;
        }
      } catch {
        // skip inaccessible properties
      }
    }

    const candidates = Array.from(
      document.querySelectorAll('div[id], div[class*="map"], div[class*="Map"]')
    );
    for (const el of candidates) {
      for (const prop of Object.getOwnPropertyNames(el)) {
        try {
          const v = (el as unknown as Record<string, unknown>)[prop];
          if (isDuckTypedSMap(v)) {
            captureInstance(v);
            if (window.__climbMap) return window.__climbMap;
          }
        } catch {
          // skip inaccessible properties
        }
      }
    }

    return null;
  }

  // ── Marker injection ────────────────────────────────────────────────────────

  window.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== window) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = event.data as any;
    if (data?.type !== "INJECT_CLIMB_MARKERS") return;

    const climbs = data.climbs as InjectClimbData[] | undefined;
    if (!climbs?.length) return;

    const tryInject = (attemptsLeft: number): void => {
      const map = discoverMapInstance();
      const S = _smapRef ?? window.SMap;
      if (!map || !S) {
        if (attemptsLeft > 0) {
          if (S && !S._climbHooked) applySMapHooks(S);
          setTimeout(() => tryInject(attemptsLeft - 1), 1000);
        }
        return;
      }
      doInjectMarkers(map, S, climbs);
    };

    tryInject(10);
  });

  function doInjectMarkers(
    map: SMapInstance,
    S: SMapConstructorStatic,
    climbs: InjectClimbData[]
  ): void {
    try {
      if (window.__climbMarkerLayer) {
        try {
          map.removeLayer(window.__climbMarkerLayer);
        } catch {
          // layer may already be removed
        }
      }

      const layer = new S.Layer.Marker();
      map.addLayer(layer);
      layer.enable();
      window.__climbMarkerLayer = layer;

      const CAT_COLORS: Record<string, string> = {
        HC: "#d42b2b",
        "1": "#e85d17",
        "2": "#e8a117",
        "3": "#c8c022",
        "4": "#6b7280",
      };

      climbs.forEach((climb, i) => {
        if (!climb.markerCoords) return;
        const { lat, lon } = climb.markerCoords;
        const color = CAT_COLORS[climb.category] ?? "#6b7280";
        const num = i + 1;

        const svg =
          `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="34" viewBox="0 0 28 34">` +
          `<path d="M14 0C6.27 0 0 6.27 0 14c0 9.6 14 20 14 20S28 23.6 28 14C28 6.27 21.73 0 14 0z" fill="${color}" stroke="#fff" stroke-width="1.5"/>` +
          `<circle cx="14" cy="14" r="9" fill="rgba(0,0,0,0.25)"/>` +
          `<text x="14" y="19" font-size="11" font-weight="bold" fill="#fff" text-anchor="middle" font-family="sans-serif">${num}</text>` +
          `</svg>`;

        const img = new Image();
        img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);

        const coords = S.Coords.fromWGS84(lon, lat);
        const marker = new S.Marker(coords, "climb-" + i, {
          url: img,
          size: [28, 34],
          anchor: { left: 14, bottom: 0 },
          title:
            `Climb ${num} · Cat ${climb.category} · ` +
            `${(climb.distance / 1000).toFixed(1)} km +${Math.round(climb.elevation)} m`,
        });
        layer.addMarker(marker);
      });
    } catch {
      // SMap API may not be ready; silently fail
    }
  }
});
