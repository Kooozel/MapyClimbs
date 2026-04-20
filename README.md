# MapyClimbs

Chrome extension that intercepts GPX exports from Mapy.cz, detects climbs, and injects analysis directly into the route-planner sidebar with live map pins.

**Version**: 1.0.4 | **Browser**: Chrome 88+ / Edge 88+ / Brave

## Quick Start

### Development build
```sh
npm install
npm run dev   # builds + opens Chrome with extension loaded
```

### Production build
```sh
npm run build   # → dist/chrome-mv3/
npm run zip     # → zip ready for Chrome Web Store
```

### Load manually
Open `chrome://extensions/`, enable **Developer mode**, click **Load unpacked**, select `dist/chrome-mv3/`.

Then: go to [mapy.cz](https://mapy.cz), open the route planner, plan a route, click **MapyClimbs** in the toolbar. Climb cards and map pins appear in the sidebar instantly.

## Project Structure

```
MapyClimbs/
├── README.md
├── CHANGELOG.md
├── ARCHITECTURE.md              ← Architecture, data flow, file responsibilities
├── wxt.config.ts                ← WXT + manifest configuration
├── package.json
├── tsconfig.json                ← extends .wxt/tsconfig.json (auto-generated)
├── vitest.config.js
├── scripts/
│   └── generate-whats-new.mjs  ← Validates & bundles public/whats-new-data.json at build time
├── public/
│   ├── whats-new-data.json      ← Hand-authored user-facing What's New bullets
│   ├── images/                  ← Extension icons (copied as-is to dist)
│   └── _locales/
│       ├── cs/messages.json     ← Czech UI strings
│       └── en/messages.json     ← English UI strings
└── src/
    ├── types.ts                 ← Shared domain types and message interfaces
    ├── constants.ts             ← ElementId enum, MAPY_MATCHES URL patterns
    ├── climb-engine.ts          ← Pure module: 7-step climb-detection pipeline
    ├── climb-engine.config.ts   ← All numeric pipeline constants (tuning)
    ├── scoring.ts               ← Pluggable scoring models: aso, garmin
    ├── format.ts                ← Shared formatting helpers
    ├── map-geometry.ts          ← Pure mercatorToPixel() projection
    ├── gpx-parser.ts            ← GPX XML parser (Haversine distances)
    ├── smap.types.ts            ← Ambient TS declarations for SMap globals
    ├── map-inject.css           ← Injected panel styles
    ├── entrypoints/
    │   ├── background.ts            ← Service worker (defineBackground)
    │   ├── interceptor.content.ts   ← Content script, document_start
    │   ├── inject.content.ts        ← Content script, document_idle (RoutePlannerController)
    │   ├── gpx-interceptor-injected.ts  ← Page-context entry point (defineUnlistedScript)
    │   ├── popup/
    │   │   ├── index.html
    │   │   ├── popup.ts
    │   │   └── popup.css
    │   └── whats-new/
    │       ├── index.html
    │       ├── whats-new.ts         ← Renders localized What's New page
    │       └── whats-new.css
    ├── injected/                    ← Page-context modules (no sandbox)
    │   ├── gpx-interceptors.ts      ← fetch/XHR monkey-patches
    │   ├── download-suppressor.ts   ← Suppresses blob download after GPX capture
    │   ├── smap-capture.ts          ← Captures live SMap instance via constructor hook
    │   └── marker-injection.ts      ← Native SMap.Layer.Marker pins
    └── content/
        ├── button-injector.ts       ← Injects MapyClimbs button, auto-triggers export
        ├── map-overlay.ts           ← SVG overlay with animated route polylines
        ├── panel.ts                 ← Sidebar panel orchestrator
        ├── panel-template.ts        ← Panel shell + header HTML
        ├── route-overview.ts        ← Route stat card + proportional climb strip
        ├── climb-card.ts            ← Per-climb card DOM + calcMaxGradientOver()
        ├── chart.ts                 ← SVG elevation chart renderer
        └── category.ts             ← Category colour palette
```

## Documentation

| File                               | Purpose                                                           |
| ---------------------------------- | ----------------------------------------------------------------- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Architecture, algorithm details, data flow, file responsibilities |
| [CHANGELOG.md](CHANGELOG.md)       | Full version history                                              |

## Features

- **Auto-capture** — intercepts GPX export requests from Mapy.cz with no manual steps
- **Sidebar panel** — climb cards injected natively into `.route-modules`, scroll with the sidebar
- **Map pins** — start (numbered) and end (mountain + category badge) SVG pins track every pan/zoom via Web Mercator
- **Elevation charts** — per-climb SVG with Catmull-Rom Bézier curves, grade-coloured gradient fills, and distance labels; click to expand
- **Climb metrics** — distance, elevation gain, avg/max grade, VAM, estimated time, Fièts index, difficulty score
- **Route overview** — total distance, total climbing, max grade, proportional climb strip
- **Smart detection** — point resampling, adaptive smoothing, valley merging, flat-end trimming, anti-flat splitting

## How It Works

### GPX Capture

`gpx-interceptor-injected.ts` monkey-patches `fetch` and `XHR` in page context. When a `/tplannerexport?export=gpx` response completes, the GPX is posted to `interceptor.content.ts` via `postMessage`, which stores it in `chrome.storage.local` and notifies the background worker.

### Climb Detection (`climb-engine.ts`) — 7-step pipeline

1. **Resample** — merge GPS points < 12 m apart (removes micro-jitter)
2. **Smooth** — adaptive rolling average (50–250 m window, terrain-weighted)
3. **Spike filter** — interpolate asymmetric DEM spikes (> 12% / < 8%)
4. **Gradients** — per-segment (Δelev / Δdist) × 100
5. **Identify + Merge** — sliding-window detection; valleys ≤ 2 km collapse into one climb
6. **Trim + Split** — flat tails (< 1.5%) removed; large flat mid-sections (> 400 m @ < 2%) split
7. **Categorize** — ProCyclingStats score → HC / Cat 1–4

### Sidebar & Map

`inject.content.ts` (`RoutePlannerController`) polls for a new GPX every 2 s after the MapyClimbs button is clicked. On receipt, it calls `detectClimbs`, then `buildPanel` (`content/panel.ts`) and `renderMapOverlay` to place animated SVG overlay pins. `injected/marker-injection.ts` additionally places native `SMap.Layer.Marker` pins that move with the map. A `MutationObserver` re-injects the panel if Mapy.cz removes it during SPA navigation.

## Climb Categories

Categorisation uses a pluggable scoring model (see `src/scoring.ts`). Default thresholds:

| Category | Score    |
| -------- | -------- |
| HC       | ≥ 40 000 |
| Cat 1    | ≥ 16 000 |
| Cat 2    | ≥ 8 000  |
| Cat 3    | ≥ 3 000  |
| Cat 4    | < 3 000  |

## Permissions

| Permission                              | Reason                                                     |
| --------------------------------------- | ---------------------------------------------------------- |
| `storage`                               | Persist captured GPX and climb results between popup opens |
| `host_permissions` (mapy.cz / mapy.com) | Inject content scripts and intercept GPX export requests   |
