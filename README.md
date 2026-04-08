# MapyClimbs

Chrome extension that intercepts GPX exports from Mapy.cz, detects climbs, and injects analysis directly into the route-planner sidebar with live map pins.

**Version**: 0.6.0 | **Browser**: Chrome 88+ / Edge 88+ / Brave

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
climb/
├── README.md
├── CHANGELOG.md
├── ARCHITECTURE.md              ← Architecture, algorithm, data flow, file responsibilities
├── wxt.config.ts                ← WXT + manifest configuration
├── package.json
├── tsconfig.json                ← extends .wxt/tsconfig.json (auto-generated)
├── vitest.config.js
├── public/
│   ├── images/                  ← Extension icons (copied as-is to dist)
│   └── _locales/
│       ├── cs/messages.json     ← Czech UI strings
│       └── en/messages.json     ← English UI strings
└── src/
    ├── types.ts                 ← Shared domain types and message interfaces
    ├── climb-engine.ts          ← Pure module: all climb-detection logic
    ├── gpx-parser.ts            ← GPX XML parser (Haversine distances)
    ├── map-inject.css           ← Injected panel styles
    ├── entrypoints/
    │   ├── background.ts        ← Service worker (defineBackground)
    │   ├── interceptor.content.ts   ← Content script, document_start (defineContentScript)
    │   ├── inject.content.ts        ← Content script, document_idle (defineContentScript)
    │   ├── gpx-interceptor-injected.ts  ← Unlisted page-context script (defineUnlistedScript)
    │   └── popup/
    │       ├── index.html       ← Popup HTML
    │       ├── popup.ts         ← Popup logic
    │       └── popup.css        ← Popup styles
    └── content/
        ├── chart.ts             ← SVG elevation chart renderer
        └── panel.ts             ← Sidebar panel DOM builder
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

`inject.content.ts` polls for a new GPX every 2 s after the MapyClimbs button is clicked. On receipt, it calls `detectClimbs`, then `buildPanel` (`content/panel.ts`) and `renderMapOverlay` to place Web Mercator pins. A `MutationObserver` re-injects the panel if Mapy.cz removes it during SPA navigation.

## Climb Categories

`Score = distance (km) × avg grade (%) × 100` — ProCyclingStats formula

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
