# Architecture — MapyClimbs

## System Overview

The extension uses a **six-layer architecture** spanning page context, content scripts, a service worker, a popup, and two standalone pages:

```
┌─────────────────────────────────────────┐
│         Mapy.cz Website                 │
│  (Fetch/XHR to /api/tplannerexport)     │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  Page Context (Injected Scripts)        │
│  injected/gpx-interceptors.ts           │  ← GPX fetch/XHR monkey-patch
│  injected/download-suppressor.ts        │  ← Suppresses blob download anchor
│  injected/smap-capture.ts              │  ← Captures live SMap instance
│  injected/marker-injection.ts          │  ← Native SMap.Layer.Marker pins
│  (all loaded by gpx-interceptor-injected.ts)
└──────────────┬──────────────────────────┘
               │  postMessage
               ▼
┌─────────────────────────────────────────┐
│  Content Script Context                 │
│  interceptor.content.ts                 │  ← Stores GPX, notifies background
│  inject.content.ts (RoutePlannerController)│← Panel, overlay, button, SPA lifecycle
│  content/button-injector.ts            │
│  content/map-overlay.ts                │
│  content/panel.ts → chart/card/overview │
└──────────────┬──────────────────────────┘
               │  chrome.runtime API
               ▼
┌─────────────────────────────────────────┐
│  Service Worker Context                 │
│  background.ts                          │
│  - Climb detection (climb-engine.ts)    │
│  - onInstalled → opens What's New page  │
│  - Tab state, categorization updates    │
└──────────────┬──────────────────────────┘
               │
       ┌───────┴────────┐
       ▼                ▼
┌─────────────┐  ┌──────────────────────┐
│  Popup      │  │  What's New Page     │
│  popup.ts   │  │  whats-new/          │
│  popup.html │  │  (opened on install) │
└─────────────┘  └──────────────────────┘
```

## Data Flow

### 1. GPX Capture Flow

```
User clicks "Export Route" on Mapy.cz (or MapyClimbs button triggers it automatically)
         ↓
button-injector.ts: observes save dialog, clicks GPX button,
  posts CLIMB_SUPPRESS_DOWNLOAD to suppress file download
         ↓
injected/gpx-interceptors.ts intercepts XHR/fetch to /tplannerexport?export=gpx
         ↓
Converts blob/text response → GPX string
window.postMessage({ type: 'GPX_FETCHED', gpxContent })
         ↓
interceptor.content.ts receives message, validates GPX
Stores in chrome.storage.local
Sends GPX_CAPTURED message to background.ts
Notifies popup via long-lived port
         ↓
injected/download-suppressor.ts blocks the blob-download anchor click
(user never sees a file-save dialog)
```

### 2. Analysis & Display Flow

```
User clicks "MapyClimbs" button in toolbar (injected by button-injector.ts)
         ↓
inject.content.ts → RoutePlannerController.pollForGPX()
Reads { pendingGPX, lastTotalDistance } from chrome.storage.local
         ↓
parseGPX() from gpx-parser.ts
→ ElevationTuple[] [distance_m, elevation_m, lat, lon]
         ↓
PROCESS_CLIMBS message → background.ts → detectClimbs() from climb-engine.ts
7-step pipeline:
  1. resamplePoints()           — remove GPS micro-jitter (< 12 m)
  2. smoothElevationProfile()   — adaptive rolling average (50–250 m)
  3. filterNoiseSpikes()        — interpolate asymmetric DEM spikes
  4. calculateGradients()       — per-segment (Δelev/Δdist)×100
  5. identifyClimbs() + mergeNearbyClimbs() (2 000 m)
  6. trimClimbEndpoints() + splitAntiGreenClimbs() (> 400 m @ < 2%)
  7. mergeNearbyClimbs() again (1 500 m) → re-trim → categorizeClimb()
         ↓
Climb[] returned to inject.content.ts
         ↓
buildPanel(climbs, totalRouteDistance)   ← content/panel.ts
renderMapOverlay(climbs)                 ← content/map-overlay.ts  (SVG overlay)
postMessage INJECT_CLIMB_MARKERS         ← injected/marker-injection.ts (native SMap pins)
```

### 3. Map Overlay Interaction

```
User hovers a climb card or map pin
         ↓
showClimbRoute(index) → SVG strokeDashoffset animation (900 ms ease-out)
  Layer 1 (glow): stroke-width 10 px, opacity 0.45, SVG blur filter
  Layer 2 (line): stroke-width 5 px, opacity 0.92
         ↓
User pans/zooms map
         ↓
handleMapInteraction() — hides overlay immediately,
  re-renders after 350 ms debounce (Web Mercator re-projection)
```

### 4. What's New Page Flow

```
chrome.runtime.onInstalled fires (install or version upgrade)
         ↓
background.ts checks StorageKey.LastSeenVersion vs manifest version
         ↓
chrome.tabs.create({ url: 'whats-new.html' })
         ↓
whats-new.ts fetches public/whats-new-data.json
Detects browser locale (cs / en fallback)
Renders version + localized bullets
```

## File Responsibilities

### Build & Config

#### `wxt.config.ts`
- WXT build configuration and full manifest definition
- Declares permissions, host permissions, action, web_accessible_resources, icons, i18n locale
- Replaces the old `manifest.json` + `vite.config.ts` pair

#### `scripts/generate-whats-new.mjs`
- Validates and bundles `public/whats-new-data.json` at build time
- Run automatically before WXT via `npm run build`
- **`whats-new-data.json` is hand-authored** — user-facing plain language bullets, not derived from the technical CHANGELOG

#### `public/whats-new-data.json`
- Schema: `{ "version": "x.y.z", "entries": { "en": [...], "cs": [...] } }`
- Fill manually before each release with user-facing feature descriptions

---

### Shared Modules

#### `src/types.ts`
- `StorageKey` — typed constants for all `chrome.storage.local` keys (incl. `LastSeenVersion`)
- `ElevationTuple`, `GpsPoint`, `Climb`, `ClimbCategory` — core pipeline data types
- `ProcessClimbsMessage`, `AnalyzeGpxMessage`, `GpxCapturedMessage` — background message union
- `CategorizationUpdatedMessage`, `MapLayerVisibilityMessage`, `GetTabStateMessage`, `ClearTabStateMessage` — inject↔background message types
- `ClimbsResponse`, `GpxStoredResponse`, `TabStateResponse` — response shapes

#### `src/climb-engine.config.ts`
- All numeric pipeline constants in one place: resample interval, smoothing window bounds, spike thresholds, climb start/end grade thresholds, merge gap distances, trim thresholds, anti-green split parameters
- Imported by `climb-engine.ts`; edit here to tune detection behaviour

#### `src/scoring.ts`
- Two configurable climb scoring models:
  - `aso`: `distance (km) × grade (%)²` — emphasises steep short climbs
  - `garmin`: `distance (km) × grade (%)` — linear weighting
- Each model ships full `HC / Cat 1–4` threshold tables
- Used by `categorizeClimb()` in `climb-engine.ts`

#### `src/format.ts`
- `metersToKm(m)`, `toPercent(ratio)`, `ratioToPercent(r)`, `formatMinutes(mins)`
- Imported by content modules and injected scripts; no Chrome APIs

#### `src/map-geometry.ts`
- `mercatorToPixel(lat, lon, centerLat, centerLon, zoom, viewportW, viewportH)` — pure Web Mercator projection; converts GPS coords to SVG pixel positions for overlay rendering
- No mutable state; fully unit-tested in `test/map-geometry.test.js`

#### `src/constants.ts`
- `ElementId` enum — DOM element IDs used by inject + button-injector
- `MAPY_MATCHES` — content-script URL match patterns

#### `src/smap.types.ts`
- Ambient TypeScript declarations for the Mapy.cz `SMap` global, `SMapInstance`, `SMapConstructorStatic`, `InjectClimbData`
- Eliminates `any` casts across injected files; no runtime code

---

### Entrypoints

#### `entrypoints/gpx-interceptor-injected.ts`
**Context**: Page/window context — `defineUnlistedScript`; injected at `document_start` by `interceptor.content.ts`

- Entry point that calls `installFetchInterceptor()`, `installXhrInterceptor()`, `installDownloadSuppressor()`, `applySMapHooks()`, and `installMarkerInjectionListener()` from the `injected/` modules

#### `entrypoints/interceptor.content.ts`
**Context**: Content script — `defineContentScript({ runAt: 'document_start' })`

- Injects `gpx-interceptor-injected.ts` as a page-context script
- Listens for `GPX_FETCHED` postMessage events from the injected script
- Validates GPX content; stores in `chrome.storage.local`
- Sends `chrome.runtime.sendMessage` to `background.ts`
- Maintains persistent long-lived port connection to popup for push notifications

#### `entrypoints/background.ts`
**Context**: Service worker ES module — `defineBackground`

- Storage version guard — clears stale cache on schema change
- Manages connected popup port list
- `GPX_CAPTURED` handler: stores GPX + timestamp, notifies popup ports
- `PROCESS_CLIMBS` handler: delegates to `detectClimbs()`, writes `Climb[]` to storage, sends response
- `ANALYZE_GPX` handler: parses raw GPX via `parseGPX()` then runs `detectClimbs()` (popup retry path)
- `chrome.runtime.onInstalled` listener: compares version → updates `LastSeenVersion` → opens `whats-new.html`
- `GetTabState` / `ClearTabState` / `CategorizationUpdated` / `MapLayerVisibility` message handlers

#### `entrypoints/inject.content.ts` — `RoutePlannerController`
**Context**: Content script — `defineContentScript({ runAt: 'document_idle', cssInjectionMode: 'manifest' })`

- `init()` — sets up `MutationObserver`, GPX poll interval, map interaction listeners, resize listener, registers message listeners
- `pollForGPX()` — reads `pendingGPX` + `lastTotalDistance` from storage; sends `PROCESS_CLIMBS` to background
- `handleMapInteraction()` — hides overlay immediately on wheel/drag; re-renders after 350 ms debounce
- `registerMessageListeners()` — handles `CategorizationUpdated`, `MapLayerVisibility`, `GetTabState`, `ClearTabState`
- `renderPanel()` / `tryInjectPanel()` — calls `buildPanel()` from `content/panel.ts`
- `renderMapOverlay()` — calls `renderMapOverlay()` from `content/map-overlay.ts`
- `clearRoutePlannerState()` — removes panel, overlay, and storage keys on route-planner exit
- `startSPAWatcher()` — 150 ms interval detects URL change / planner-visibility change on Mapy.cz SPA navigation

#### `entrypoints/popup/`
**Files**: `index.html`, `popup.ts`, `popup.css`

- Shows last capture status, climb count, total distance
- Spinner while analysis is pending; retry button sends `ANALYZE_GPX` with `pendingGPX`
- Reads from `StorageKey` constants; establishes persistent port to background

#### `entrypoints/whats-new/`
**Files**: `index.html`, `whats-new.ts`, `whats-new.css`

- Opened by `background.ts` on install/update
- Fetches `whats-new-data.json`; detects browser locale (`cs` / `en` fallback)
- Renders version badge + localised bullet list in a dark-themed standalone page

---

### Injected Scripts (`src/injected/`)

All four modules run in **page context** (no sandbox), loaded via `gpx-interceptor-injected.ts`.

#### `injected/gpx-interceptors.ts`
- `installFetchInterceptor()` — wraps `window.fetch`; on `/tplannerexport?export=gpx` responses clones and reads blob/text, calls `postGpxFetched()`
- `installXhrInterceptor()` — wraps `XMLHttpRequest.open`/`send`; same URL check and post

#### `injected/download-suppressor.ts`
- `installDownloadSuppressor()` — patches `HTMLAnchorElement.prototype.click`; suppresses blob-download clicks after receiving `CLIMB_SUPPRESS_DOWNLOAD` postMessage

#### `injected/smap-capture.ts`
- `applySMapHooks()` — installs a `set` trap via `Object.defineProperty(window, 'SMap', ...)` to intercept the Mapy.cz `SMap` constructor the moment it is assigned; also starts a polling fallback
- `discoverMapInstance(S)` — duck-type checks `addLayer` / `getCenter` to locate the live `SMapInstance`
- `getSmapRef()` — returns the captured `SMapConstructorStatic` for use by `marker-injection.ts`

#### `injected/marker-injection.ts`
- `installMarkerInjectionListener()` — listens for `INJECT_CLIMB_MARKERS` postMessages from the content script
- `doInjectMarkers(map, S, climbs)` — removes any existing `__climbMarkerLayer`; creates a new `SMap.Layer.Marker`; renders teardrop SVG start pins (numbered, category colour) and mountain SVG end pins for each climb via native `SMap` API

---

### Content Modules (`src/content/`)

#### `content/button-injector.ts`
- `tryInjectButton()` — inserts the MapyClimbs button next to `.route-actions`
- `onClimbButtonClick()` — triggers Mapy.cz GPX export dialog via `findGPXExportButton()`; observes the dialog to locate and click the save button automatically; posts `CLIMB_SUPPRESS_DOWNLOAD` before saving

#### `content/map-overlay.ts`
- `renderMapOverlay(climbs)` — reads `x`/`y`/`z` from the page URL; calls `mercatorToPixel()` for each climb endpoint; builds an SVG overlay positioned over `#map`
- `showClimbRoute(index)` — animates the route polyline via `strokeDashoffset` (900 ms ease-out); renders two layers: glow (blur filter, 10 px, 0.45 opacity) and line (5 px, 0.92 opacity)
- `hideClimbRoute(index)` — resets stroke animation
- `setOverlayVisible(visible)` — hides/shows the SVG overlay (used when a native Mapy.cz popup is open to avoid z-index conflicts)

#### `content/panel.ts`
- `buildPanel(climbs, totalRouteDistance)` — top-level orchestrator; calls `renderPanelShell()`, `buildRouteOverview()`, `buildClimbCard()` for each climb
- `showChartOverlay(svgEl)` / `hideChartOverlay()` — floating chart overlay on card hover
- Delegates rendering to `panel-template.ts`, `route-overview.ts`, `climb-card.ts`, `chart.ts`

#### `content/panel-template.ts`
- `renderPanelShell()` — panel container + header HTML with title and the eye/layer-toggle button
- `renderEmptyPanel()` — placeholder shown before analysis completes

#### `content/route-overview.ts`
- `buildRouteOverview(climbs, totalRouteDistance)` — top route-stat card: total distance, total elevation gain, max grade; proportional colour strip showing where each climb sits on the route

#### `content/climb-card.ts`
- `buildClimbCard(climb, index)` — per-climb card DOM: category badge, distance, elevation, avg/max grade, VAM, estimated climb time, Fiéts index, summit elevation, summit distance
- `calcMaxGradientOver(segments, windowMeters)` — sliding-window max-gradient helper; unit-tested in `test/climb-card.test.js`

#### `content/chart.ts`
- `generateElevationChart(segments, totalDistanceMeters, climbCategory)` — entry point
- `simplifyProfile(profile)` — reduces points to 8–20 key inflection points for SVG rendering
- `buildGradientZones(profile)` — groups consecutive points by `GRADE_COLORS` tier
- `mergeShortZones(zones, minLen)` — absorbs zones shorter than `minLen` into neighbours
- `renderElevationSVG(...)` — builds SVG with Catmull-Rom Bézier curves, grade-coloured `linearGradient` fills, X-axis distance labels, max-grade badge
- No Chrome APIs; no mutable module state (except internal `_chartUid` counter for unique SVG IDs)
- Unit-tested in `test/chart.test.js` (16 tests)

#### `content/category.ts`
- `CATEGORY_COLOR` map: `HC=#800020`, `C1=#D32F2F`, `C2=#F57C00`, `C3=#FBC02D`, `C4=#4CAF50`
- `getCategoryColor(cat)` — used by chart, card, overlay, and marker modules

---

### Core Algorithms

#### `src/climb-engine.ts`
**Context**: Pure ES module — no Chrome APIs; imported only by `background.ts`.

- `detectClimbs(profile)` — 7-step pipeline entry point (see Data Flow §2)
- All other functions are private to the module; constants imported from `climb-engine.config.ts`
- 40 tests in `test/climb-engine.test.js`

#### `src/gpx-parser.ts`
**Context**: Shared — imported by `inject.content.ts` and `background.ts`

- Parses GPX XML with support for three `<trkpt>` namespace variants
- Haversine formula for cumulative distance
- Returns `ElevationTuple[]` `[distance_m, elevation_m, lat, lon]`

---

## Key Design Decisions

### 1. Two-Layer Injection
**Why**: Content scripts run in a sandbox and cannot access the page's `fetch`/`XHR` directly.  
**Solution**: `gpx-interceptor-injected.ts` runs in page context; communicates back via `postMessage`.  
**Trade-off**: More complex, but guaranteed interception of all network calls regardless of Mapy.cz bundling.

### 2. Automatic Export + Download Suppression
**Why**: Requiring the user to manually click Export GPX is friction; showing a browser save dialog after auto-capture is confusing.  
**Solution**: `button-injector.ts` auto-clicks the GPX save button; `download-suppressor.ts` patches `HTMLAnchorElement.prototype.click` to discard the blob download anchor.

### 3. Dual Marker System
**Why**: SVG overlay pins (Web Mercator math) work at any zoom but detach from the map on pan/zoom until re-rendered. Native `SMap.Layer.Marker` pins move with the map natively.  
**Solution**: Both systems run in parallel — SVG overlay for animated route polylines; native SMap markers for persistent start/end pins. `smap-capture.ts` acquires the live `SMap` instance by hooking its constructor prototype.

### 4. Single Storage Backend
**Why**: GPX capture must survive extension reload and popup close.  
**Solution**: All state stored exclusively in `chrome.storage.local`; accessible from service worker and content scripts.

### 5. Pluggable Scoring Models (`scoring.ts`)
**Why**: No single formula best serves all use cases; ASO weighting favours steep short climbs while Garmin/linear weighting favours long steady climbs.  
**Solution**: `scoring.ts` exports `aso` and `garmin` model objects, each with threshold tables; `categorizeClimb()` in `climb-engine.ts` selects the active model.

### 6. Externalised Pipeline Constants (`climb-engine.config.ts`)
**Why**: Numeric thresholds were scattered across `climb-engine.ts`, making tuning fragile.  
**Solution**: All detection parameters centralised in one config file; changing detection behaviour requires only editing that file.

### 7. CHANGELOG ↔ What's New Separation
**Why**: Developer changelog entries reference file names and function signatures — noise for an end user.  
**Solution**: `CHANGELOG.md` remains developer-facing. `public/whats-new-data.json` is **hand-authored** user-facing bullets (plain language, benefit-oriented). `scripts/generate-whats-new.mjs` validates and bundles `whats-new-data.json` at build time without reading `CHANGELOG.md`.

---

## Security Considerations

- **Content script sandbox**: Cannot access page JavaScript; exchange via `postMessage` only.
- **postMessage origin guard**: `interceptor.content.ts` and `download-suppressor.ts` check `event.source === window && event.origin === location.origin` before processing.
- **No external requests**: All processing is local; no outbound connections.
- **Storage scope**: `chrome.storage.local` is per-extension; no cross-extension data access.

## Performance Optimisations

1. **Debounced overlay re-render**: 350 ms wait after map pan/zoom; avoids projecting on every scroll event.
2. **SVG simplification**: `simplifyProfile()` reduces elevation data to 8–20 inflection points before rendering.
3. **O(n) smoothing**: `smoothElevationProfile()` uses a two-pointer sliding window; replaced an earlier O(n²) double full-array scan.
4. **Message batching**: All climbs returned in a single `PROCESS_CLIMBS` response message.
5. **Lazy parse**: GPX is parsed only when the MapyClimbs button is clicked, not on every page load.
