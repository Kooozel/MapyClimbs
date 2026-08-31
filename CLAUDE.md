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
npm run build:cli       # esbuild-bundle the climb engine + CLI → dist-cli/
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

Regenerate the synthetic ride fixture (only when its shape must change):
```sh
node scripts/generate-ride-fixture.mjs   # → test/fixtures/ride-synthetic.gpx
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

A sixth, non-browser consumer sits outside this stack: the Node CLI in `src/cli/`
(see [Climb-engine CLI](#climb-engine-cli)) reuses `climb-engine.ts` directly.

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

### Climb-engine CLI

`src/cli/` is a second consumer of the same pure engine — a Node CLI that takes a
**Garmin Connect ride GPX** and prints enriched climb JSON on stdout, for a downstream
`sync.py --insert-climbs` importer. It ships from `npm run build:cli`
(`scripts/build-cli.mjs`, esbuild) as two dependency-free ESM files in `dist-cli/`:
`climb-engine.mjs` (library) and `climb-cli.mjs` (executable). `dist-cli/` is kept
separate from `dist/` so `wxt build` never touches it, and CI builds it in its own step
so a broken CLI bundle cannot block an extension release.

- `cli/garmin-gpx.ts` — Node-side GPX reader. It exists *alongside* `src/gpx-parser.ts`
  (which needs `DOMParser` and discards `<time>` / heart rate) because ride analysis needs
  both. Same haversine formula, pinned together over a shared fixture by
  `test/garmin-gpx.test.js`.
- `cli/ride-metrics.ts` — pure moving-time and HR-zone aggregation. VAM must be computed
  on moving time, not elapsed.
- `cli/analyze-ride.ts` — the output contract: every `climbs[]` key maps 1:1 onto a column
  of the consumer's `climbs` table, so keys are **snake_case** here and camelCase↔snake_case
  conversion happens in this file and nowhere else.
- `cli/index.ts` — the only impure file: arg parsing, file reads, printing. Stdout is JSON
  and nothing else; diagnostics go to stderr.

HR zone boundaries are personal data and are never committed — they come in via `--zones`.
When absent, `pct_z4z5` is null but HR avg/max are still emitted.

### Tests

Tests are plain JS in `test/` using Vitest + happy-dom. Covered modules: `climb-engine.ts`,
`chart.ts` / `gradient-zones.ts`, `map-geometry.ts`, `climb-card.ts`, `gpx-parser.ts`,
`gpx-integration` (full GPX fixture round-trip including hiking), plus the CLI layer:
`garmin-gpx`, `ride-metrics`, `ride-analysis`.

Fixtures in `test/fixtures/` are real Mapy.cz route exports, except
`ride-synthetic.gpx` — a generated ride-shaped track (1 Hz noise, stops, recording gaps,
heart rate) so CLI behaviour can be tested without committing a real ride.

### Branching and release

`develop` is the integration branch; `main` is the release branch. CI runs on PRs into
either. Pushing to `main` triggers `.github/workflows/release.yml`: build zip → manual
approval (`production` environment) → Chrome Web Store publish → version bump + tag →
GitHub Release → merge `main` back into `develop`. The workflow's own commits carry
`[skip ci]`, and it bumps `package.json` itself — don't hand-bump the version for a release.
CI also enforces CWS limits: locale `extDescription` ≤ 132 chars, manifest `name` ≤ 45 chars,
manifest version matching `package.json`.
