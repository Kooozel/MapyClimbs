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
npm run test:coverage   # vitest run --coverage (80% branches/lines enforced)
```

Run a single test file:
```sh
npx vitest run test/climb-engine.test.js
```

The pre-commit hook runs `lint-staged`: Prettier on `*.{ts,css}` then ESLint `--fix` on `*.ts`.

## Architecture

This is a browser extension (Chrome MV3, Firefox MV3) built with [WXT](https://wxt.dev/). It intercepts GPX exports from Mapy.cz, detects cycling climbs, and injects analysis into the route-planner sidebar with live map pins.

### Six-layer execution model

```
Mapy.cz website
  → Page context (injected/*)         — monkey-patches fetch/XHR/SMap, no sandbox
  → Content scripts (entrypoints/*)   — intercepts postMessages, drives panel & overlay
  → Service worker (background.ts)    — climb detection, storage, lifecycle
  → Popup (popup/)                    — status display, retry
  → What's New page (whats-new/)      — opened on install/update
```

Because content scripts cannot access page JS directly, `interceptor.content.ts` injects `gpx-interceptor-injected.ts` into page context at `document_start`. GPX data travels back via `postMessage` → `interceptor.content.ts` → `chrome.storage.local` → background service worker.

### Key data flow

1. **GPX capture**: `injected/gpx-interceptors.ts` intercepts `fetch`/`XHR` to `/tplannerexport?export=gpx` → posts `GPX_FETCHED` → `interceptor.content.ts` stores it and notifies background. `injected/download-suppressor.ts` suppresses the browser save dialog.

2. **Climb detection**: User clicks the injected MapyClimbs button → `inject.content.ts` (`RoutePlannerController`) sends `PROCESS_CLIMBS` to background → `background.ts` runs `detectClimbs()` from `climb-engine.ts` (7-step pipeline) → returns `Climb[]`.

3. **Display**: `RoutePlannerController` calls `buildPanel()` (`content/panel.ts`) and `renderMapOverlay()` (`content/map-overlay.ts`). It also posts `INJECT_CLIMB_MARKERS` to the page context so `injected/marker-injection.ts` places native `SMap.Layer.Marker` pins.

### Tuning climb detection

All numeric pipeline constants (resample interval, smoothing window, spike thresholds, merge gaps, trim thresholds) live in `src/climb-engine.config.ts`. The climb-detection logic itself is in `src/climb-engine.ts` (pure module, no Chrome APIs). Scoring models (ASO, Garmin) and category thresholds are in `src/scoring.ts`.

### Dual marker system

Two independent pin systems run in parallel:
- **SVG overlay** (`content/map-overlay.ts`): animated route polylines using Web Mercator math (`src/map-geometry.ts`); re-projected on pan/zoom with a 350 ms debounce.
- **Native SMap pins** (`injected/marker-injection.ts`): `SMap.Layer.Marker` objects that move with the map natively; acquired by hooking the SMap constructor in `injected/smap-capture.ts`.

### Storage

All state (captured GPX, processed climbs, version tracking) lives exclusively in `chrome.storage.local` using typed keys from `StorageKey` in `src/types.ts`. This survives extension reloads and popup closes.

### i18n

UI strings use `__MSG_*__` manifest keys. Locale files: `public/_locales/en/messages.json` and `public/_locales/cs/messages.json`.

### What's New page

`public/whats-new-data.json` is **hand-authored** user-facing bullets — it is not derived from `CHANGELOG.md`. Update it before each release. `scripts/generate-whats-new.mjs` validates and bundles it at build time (runs automatically as part of `npm run build`).

### Tests

Tests are plain JS in `test/` using Vitest + happy-dom. Covered modules: `climb-engine.ts` (40 tests), `chart.ts` (16 tests), `map-geometry.ts`, `climb-card.ts`, `gpx-parser.ts`.
