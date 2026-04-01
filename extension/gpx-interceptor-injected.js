/**
 * Injected Script - Runs in page context to intercept network requests
 * This bypasses content script isolation and properly intercepts fetch/XHR
 * Communicates back to content script via postMessage
 */

(function() {
  'use strict';

  // === DOWNLOAD SUPPRESSION ===
  // When the Climb Analyzer button triggers the GPX export programmatically,
  // we suppress the resulting file download so the user's Downloads folder is
  // not spammed.  map-inject.js (content script) signals intent via postMessage.

  let _suppressNextDownload = false;

  window.addEventListener('message', (event) => {
    if (event.source === window && event.data && event.data.type === 'CLIMB_SUPPRESS_DOWNLOAD') {
      _suppressNextDownload = true;
    }
  });

  // Intercept the programmatic anchor.click() that triggers blob downloads
  const _origAnchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (_suppressNextDownload && this.download && this.href.startsWith('blob:')) {
      _suppressNextDownload = false;
      console.log('[GPX Interceptor] Download suppressed — data captured by extension');
      return;
    }
    return _origAnchorClick.call(this);
  };

  // === FETCH INTERCEPTOR ===
  const originalFetch = window.fetch;

  window.fetch = function(...args) {
    const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
    
    // Check if this is a GPX export request
    if (url.includes('tplannerexport') && url.includes('export=gpx')) {
      console.log('[GPX Interceptor] ✓ FETCH intercepted - GPX export detected:', url);
      
      const fetchPromise = originalFetch.apply(this, args);
      
      fetchPromise
        .then((response) => {
          // Check content-type to determine how to read
          const contentType = response.headers.get('content-type') || '';
          const clonedResponse = response.clone();
          
          // Handle different response types
          if (contentType.includes('application/octet-stream') || contentType.includes('application/blob')) {
            // Binary blob response
            clonedResponse.blob().then((blob) => {
              return blob.text();
            }).then((gpxContent) => {
              if (gpxContent && gpxContent.length > 0) {
                console.log('[GPX Interceptor] ✓ GPX content captured via FETCH (blob), length:', gpxContent.length);
                window.postMessage({
                  type: 'GPX_FETCHED',
                  gpxContent: gpxContent,
                  source: 'fetch-blob',
                  timestamp: Date.now()
                }, '*');
              }
            }).catch((error) => {
              console.error('[GPX Interceptor] Error reading blob:', error);
            });
          } else {
            // Text response
            clonedResponse.text().then((gpxContent) => {
              if (gpxContent && gpxContent.length > 0) {
                console.log('[GPX Interceptor] ✓ GPX content captured via FETCH (text), length:', gpxContent.length);
                window.postMessage({
                  type: 'GPX_FETCHED',
                  gpxContent: gpxContent,
                  source: 'fetch-text',
                  timestamp: Date.now()
                }, '*');
              }
            }).catch((error) => {
              console.error('[GPX Interceptor] Error reading fetch response:', error);
            });
          }
          
          return response;
        })
        .catch((error) => {
          console.error('[GPX Interceptor] Fetch error:', error);
        });
      
      return fetchPromise;
    }
    
    return originalFetch.apply(this, args);
  };

  // === XHR INTERCEPTOR ===
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;
  let xhrGPXUrl = null;

  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    // Check if this is a GPX request
    if (typeof url === 'string' && url.includes('tplannerexport') && url.includes('export=gpx')) {
      console.log('[GPX Interceptor] ✓ XHR intercepted - GPX export detected:', url);
      xhrGPXUrl = url;
      this._isGPXRequest = true;
    }
    return originalXHROpen.apply(this, [method, url, ...rest]);
  };

  XMLHttpRequest.prototype.send = function(...args) {
    if (this._isGPXRequest) {
      // Set up load listener to capture the response
      const onReadyStateChange = () => {
        if (this.readyState === 4 && (this.status === 200 || this.status === 0)) {
          let gpxContent = null;

          // Handle different response types
          if (this.responseType === 'blob' && this.response instanceof Blob) {
            // Response is a blob - read it as text
            this.response.text().then((text) => {
              if (text && text.length > 0) {
                console.log('[GPX Interceptor] ✓ GPX content captured via XHR (blob), length:', text.length);
                window.postMessage({
                  type: 'GPX_FETCHED',
                  gpxContent: text,
                  source: 'xhr-blob',
                  timestamp: Date.now()
                }, '*');
              }
            }).catch((error) => {
              console.error('[GPX Interceptor] Error reading blob:', error);
            });
          } else if (this.responseType === '' || this.responseType === 'text') {
            // Response is text
            gpxContent = this.responseText || this.response;
            if (gpxContent && gpxContent.length > 0) {
              console.log('[GPX Interceptor] ✓ GPX content captured via XHR (text), length:', gpxContent.length);
              window.postMessage({
                type: 'GPX_FETCHED',
                gpxContent: gpxContent,
                source: 'xhr-text',
                timestamp: Date.now()
              }, '*');
            }
          } else {
            // Try response property as fallback
            if (typeof this.response === 'string' && this.response.length > 0) {
              console.log('[GPX Interceptor] ✓ GPX content captured via XHR (response property), length:', this.response.length);
              window.postMessage({
                type: 'GPX_FETCHED',
                gpxContent: this.response,
                source: 'xhr-response',
                timestamp: Date.now()
              }, '*');
            }
          }
        }
      };
      
      this.addEventListener('readystatechange', onReadyStateChange);
    }
    
    return originalXHRSend.apply(this, args);
  };

  console.log('[GPX Interceptor - Injected] ✓ Ready - Monitoring for GPX exports via FETCH and XHR');

  // === SMAP INSTANCE CAPTURE ===
  //
  // Three-layer strategy (most → least reliable):
  //   1. addLayer hook  — Mapy.cz MUST call map.addLayer() to add tile/geometry
  //      layers at startup, so this fires regardless of when SMap was defined.
  //   2. $constructor hook — fires when a new SMap instance is created.
  //   3. Duck-type window scan — last resort, looks for any object with the
  //      shape of an SMap instance (has addLayer + getCenter methods).

  let _smapRef = null; // the SMap constructor function once known
  let _smapPoll = null; // polling interval reference (declared early for captureInstance)

  function captureInstance(inst) {
    if (!window.__climbMap && inst &&
        typeof inst.addLayer === 'function' &&
        typeof inst.getCenter === 'function') {
      window.__climbMap = inst;
      console.log('[GPX Interceptor] ✓ SMap instance captured');
      clearInterval(_smapPoll);
    }
  }

  function applySMapHooks(S) {
    if (!S || S._climbHooked) return;
    S._climbHooked = true;
    _smapRef = S;

    // Hook every method that carries `this` = the map instance.
    // $constructor fires on creation, addLayer during init,
    // setCenter/getCenter on every pan/zoom — between these we will
    // always catch the instance even if already created.
    const hookMethods = ['$constructor', 'addLayer', 'setCenter', 'getCenter',
                         'addDefaultLayer', 'lock', 'unlock', 'redraw'];
    hookMethods.forEach(name => {
      if (!S.prototype[name]) return;
      const _orig = S.prototype[name];
      S.prototype[name] = function(...args) {
        captureInstance(this);
        return _orig.apply(this, args);
      };
    });
  }

  // If SMap is already on window (loaded before us), hook it immediately
  if (window.SMap) {
    applySMapHooks(window.SMap);
  }

  // Setter trap catches future window.SMap = assignments
  try {
    let _smapValue = window.SMap; // preserve existing value if any
    Object.defineProperty(window, 'SMap', {
      get() { return _smapValue; },
      set(val) {
        _smapValue = val;
        applySMapHooks(val);
      },
      configurable: true
    });
  } catch (e) {
    console.warn('[GPX Interceptor] defineProperty failed:', e.message);
  }

  // Poll for SMap in case setter trap missed it (e.g. loaded via async module)
  let _pollCount = 0;
  _smapPoll = setInterval(() => {
    if (window.__climbMap || _pollCount++ > 20) { clearInterval(_smapPoll); return; }
    const S = window.SMap;
    if (S && !S._climbHooked) applySMapHooks(S);
  }, 500);

  function discoverMapInstance() {
    if (window.__climbMap) return window.__climbMap;

    // 1. Scan window.* properties
    for (const key of Object.keys(window)) {
      try {
        const v = window[key];
        if (v && typeof v === 'object' &&
            typeof v.addLayer === 'function' &&
            typeof v.getCenter === 'function') {
          captureInstance(v);
          return window.__climbMap;
        }
      } catch (_) {}
    }

    // 2. Scan DOM elements — SMap stores its instance on its container element.
    //    We don't know the exact property name so we probe own properties.
    const candidates = document.querySelectorAll('div[id], div[class*="map"], div[class*="Map"]');
    for (const el of candidates) {
      for (const prop of Object.getOwnPropertyNames(el)) {
        try {
          const v = el[prop];
          if (v && typeof v === 'object' &&
              typeof v.addLayer === 'function' &&
              typeof v.getCenter === 'function') {
            captureInstance(v);
            if (window.__climbMap) {
              console.log('[GPX Interceptor] ✓ SMap found via DOM scan (el.' + prop + ')');
              return window.__climbMap;
            }
          }
        } catch (_) {}
      }
    }

    return null;
  }

  // === MARKER INJECTION LISTENER ===
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data?.type !== 'INJECT_CLIMB_MARKERS') return;

    const { climbs } = event.data;
    if (!climbs?.length) return;

    const tryInject = (attemptsLeft) => {
      const map = discoverMapInstance();
      const S = _smapRef || window.SMap;
      if (!map || !S) {
        if (attemptsLeft > 0) {
          // On first attempt also try hooking SMap in case it appeared asynchronously
          if (S && !S._climbHooked) applySMapHooks(S);
          console.log('[GPX Interceptor] Map not ready, retrying... (' + attemptsLeft + ' left)');
          setTimeout(() => tryInject(attemptsLeft - 1), 1000);
        } else {
          console.warn('[GPX Interceptor] Could not find SMap instance — markers skipped');
        }
        return;
      }
      doInjectMarkers(map, S, climbs);
    };

    tryInject(10);
  });

  function doInjectMarkers(map, S, climbs) {

    try {
      // Remove previous marker layer if it exists
      if (window.__climbMarkerLayer) {
        try { map.removeLayer(window.__climbMarkerLayer); } catch (_) {}
      }

      const layer = new S.Layer.Marker();
      map.addLayer(layer);
      layer.enable();
      window.__climbMarkerLayer = layer;

      const CAT_COLORS = {
        HC: '#d42b2b', '1': '#e85d17', '2': '#e8a117', '3': '#c8c022', '4': '#6b7280'
      };

      let injected = 0;
      climbs.forEach((climb, i) => {
        if (!climb.markerCoords) return;
        const { lat, lon } = climb.markerCoords;
        const color = CAT_COLORS[climb.category] || '#6b7280';
        const num = i + 1;

        // SVG pin: teardrop shape with climb number
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="34" viewBox="0 0 28 34">` +
          `<path d="M14 0C6.27 0 0 6.27 0 14c0 9.6 14 20 14 20S28 23.6 28 14C28 6.27 21.73 0 14 0z" fill="${color}" stroke="#fff" stroke-width="1.5"/>` +
          `<circle cx="14" cy="14" r="9" fill="rgba(0,0,0,0.25)"/>` +
          `<text x="14" y="19" font-size="11" font-weight="bold" fill="#fff" text-anchor="middle" font-family="sans-serif">${num}</text>` +
          `</svg>`;

        const img = new Image();
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);

        const coords = S.Coords.fromWGS84(lon, lat);
        const marker = new S.Marker(coords, 'climb-' + i, {
          url: img,
          size: [28, 34],
          anchor: { left: 14, bottom: 0 },
          title: 'Climb ' + num + ' · Cat ' + climb.category + ' · ' + (climb.distance / 1000).toFixed(1) + ' km +' + Math.round(climb.elevation) + ' m'
        });
        layer.addMarker(marker);
        injected++;
      });

      console.log('[GPX Interceptor] ✓ Injected ' + injected + ' climb markers');
    } catch (err) {
      console.error('[GPX Interceptor] Marker injection failed:', err);
    }
  }
})();
