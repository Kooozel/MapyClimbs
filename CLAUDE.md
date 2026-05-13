# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```sh
npm run dev             # build + open Chrome with extension loaded (hot reload)
npm run dev:firefox     # same for Firefox
npm run build           # validate whats-new-data.json, then WXT build → dist/chrome-mv3/
npm run build:firefox   # same for Firefox (MV3)
npm run zip             # package for Chrome Web Store
npm run zip:firefox     # package for Firefox Add-ons
npm run typecheck       # tsc --noEmit
npm run lint            # eslint src/ wxt.config.ts eslint.config.js
npm run lint:fix        # eslint --fix
npm run format          # prettier --write src/
npm run test            # vitest run (all tests in test/)
npm run test:watch      # vitest (interactive)
npm run test:coverage   # vitest run --coverage (report-only, no threshold)
```

Run a single test file:
```sh
npx vitest run test/climb-engine.test.js
```

The pre-commit hook runs `lint-staged`: Prettier on `*.{ts,css}` then ESLint `--fix` on `*.ts`.

## Architecture

This is a browser extension (Chrome MV3, Firefox MV3) built with [WXT](https://wxt.dev/). It intercepts GPX exports from Mapy.cz, detects cycling and hiking climbs, and injects analysis into the route-planner sidebar with live colour-coded map polylines.

### Five-layer execution model

```
Mapy.cz website
  → Page context (injected/*)         — monkey-patches fetch/XHR, no sandbox
  → Content scripts (entrypoints/*)   — intercepts postMessages, drives panel & overlay
  → Service worker (background.ts)    — climb detection, storage, lifecycle
  → Popup (popup/)                    — model toggle, layer visibility
  → What's New page (whats-new/)      — opened on install/update
```

Because content scripts cannot access page JS directly, `interceptor.content.ts` injects `gpx-interceptor-injected.ts` into page context at `document_start`. GPX data travels back via `postMessage` → `interceptor.content.ts` → `chrome.storage.local` → background service worker.

### Key data flow

1. **GPX capture**: `injected/gpx-interceptors.ts` intercepts `fetch`/`XHR` to `/tplannerexport?export=gpx`, detects route mode (cycling / hiking / other) from the active transport icon in the DOM, and posts `GPX_FETCHED`. `injected/download-suppressor.ts` suppresses the browser save dialog.

2. **Alternative routes**: `button-injector.ts` iterates every `h3.alt-*` heading in the route-summary panel, clicks each one, waits for a fresh GPX export, and stores results per `lastAnalysisResult:<tabId>:<routeClass>`. A fullscreen loader is shown during this automation. Switching between alternatives instantly loads the cached result from storage.

3. **Climb detection**: `inject.content.ts` (`RoutePlannerController`) sends `PROCESS_CLIMBS` to background → `background.ts` runs `detectClimbs()` from `climb-engine.ts` (5-step pipeline) → returns `AnalysisResult` (climbs + route-level stats). The active route mode is stored with the GPX and forwarded so the correct scoring model is selected automatically.

4. **Display**: `RoutePlannerController` calls `buildPanel()` (`content/panel.ts`) and `renderMapOverlay()` (`content/map-overlay.ts`). The SVG overlay re-projects colour-coded polylines on every pan/zoom with a 350 ms debounce.

### Tuning climb detection

All numeric pipeline constants (resample interval, interpolation gap, smoothing window, spike thresholds, merge gaps, trim thresholds) live in `src/climb-engine.config.ts`. The climb-detection logic itself is in `src/climb-engine.ts` (pure module, no Chrome APIs). Scoring models (ASO, Garmin, hiking) and category thresholds are in `src/scoring.ts`. Gradient zone colours and the full profile → zone pipeline live in `src/gradient-zones.ts`.

### Hiking mode

Hiking mode is auto-detected: `injected/gpx-interceptors.ts` reads the active transport-icon class from the Mapy.cz DOM and sets `routeMode = "hiking"` in the stored `GpxInfo`. The background then applies the TRAILS-GPX hiking formula (summit elevation + max gradient + distance) instead of the ASO/Garmin cycling formula. Grade colour bands are wider (5 / 10 / 20 / 30 / 40 %) to match walking pace. Hiking routes always keep the hiking model regardless of the user's scoring preference.

### Map overlay

A single SVG overlay (`content/map-overlay.ts`) projects colour-coded polylines onto the map using Web Mercator math (`src/map-geometry.ts`). It re-projects on pan, zoom, and window resize with a 350 ms debounce. The overlay is hidden while a Mapy.cz popup/dialog is open and restored when it closes.

### Storage

All state lives in `chrome.storage.local` using typed keys from `StorageKey` in `src/types.ts`. Tab-scoped helpers (`getTabStorageKeys`, `getTabState`, `saveTabGpx`, `clearTabState`, `getTabId`) are in `src/storage.ts`.

Key layout:
- `pendingGPX:<tabId>` — latest intercepted GPX + metadata for a tab (no route-class suffix; one per tab)
- `lastAnalysisResult:<tabId>:<routeClass>` — per-alternative-route detection result (e.g. `…:alt-0`, `…:alt-1`)
- `scoringModel` — global scoring preference (`"aso"` | `"garmin"`)
- `mapLayerVisible` — overlay toggle state

### i18n

UI strings use `__MSG_*__` manifest keys. Locale files: `public/_locales/en/messages.json` and `public/_locales/cs/messages.json`.

### What's New page

`public/whats-new-data.json` is **hand-authored** user-facing bullets — it is not derived from `CHANGELOG.md`. Update it before each release. `scripts/generate-whats-new.mjs` validates and bundles it at build time (runs automatically as part of `npm run build`). The `version` field must match `package.json`.

### Tests

Tests are plain JS in `test/` using Vitest + happy-dom. Covered modules: `climb-engine.ts`, `chart.ts` / `gradient-zones.ts`, `map-geometry.ts`, `climb-card.ts`, `gpx-parser.ts`, `gpx-integration` (full GPX fixture round-trip including hiking).
