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
npm run test:trace      # DEBUG_PIPELINE=1 + --reporter=verbose on the GPX fixtures
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

Mapy.com ships two map builds behind an A/B test, and the overlay supports both:

- **Raster (original)** renders into `div#map`.
- **Vector (WASM/WebGL)** leaves `div#map` in the DOM but hides it (`display:none`, 0x0)
  and renders into `div#scene` > `div#wasm` > `canvas#wasm-canvas`.

`getMapContainer()` picks the first `MAP_CONTAINER_SELECTORS` entry with a non-zero box, so
one build works on both. Two vector-only behaviours the overlay has to respect:

- **Zoom is continuous** (`z=13.248` in the URL), so `viewportFromURL` must `parseFloat` the
  zoom — truncating it misplaces the overlay by ~60-110 px. The projection itself is unchanged:
  the vector renderer uses the same Web Mercator / 256 px-tile math, verified against its own
  `Scene.coordsToPixel` to sub-pixel agreement.
- **The canvas `preventDefault()`s `pointerdown`**, which suppresses the compatibility
  `mousedown`/`mouseup` pair entirely. Pan detection therefore listens for pointer events, on
  `document` rather than the container (the canvas is created after `document_idle`).

### Centering the map on a climb

Clicking a climb card centres the map on that climb's summit (`endCoords`), keeping the current
zoom. Moving the map needs the page's own globals, so the work is split: `content/map-center.ts`
computes the target coordinate and posts it, `injected/map-center.ts` performs the call in page
context, and `RoutePlannerController` re-projects the overlay when it answers.

There is no cross-build API — `Scene.setCenter` looks like one but is a no-op stub on vector:

- **Vector:** `Mapy.getComponent("wasm").wasm.setCenterZoom(lon, lat)` — note lon first.
- **Raster:** `Mapy.debugGlobals().Scene._mapProvider.setCenter(SMap.Coords.fromWGS84(lon, lat))`.
  `fromWGS84` does `new this(...)` — call it on `SMap.Coords`, never through a detached reference.

Both are exact and instant, and both leave mapy.com's own route geometry and markers aligned.
Two consequences drive the rest of the design:

- **Only vector rewrites `x`/`y` in the URL.** Since the overlay projects from the URL
  (`viewportFromURL`), the injected script writes those two params itself on both builds, by
  patching the raw search string rather than round-tripping `URLSearchParams` — which would
  re-encode mapy.com's other params (`rc`, `mrp`, `rwp`). The controller then assigns that URL
  to `lastURL`, or the SPA watcher would read its own extension's write as a navigation.
- **Only vector redraws the planned route.** The raster build culls the route's SVG geometry
  once it scrolls out of view and rebuilds it only from the interactive pan pipeline, so jumping
  back from far away leaves the map right but the route invisible. `nudgeMap` therefore drags the
  raster map 12 px and straight back — net travel zero, but far enough past the click threshold
  that it is read as a drag, not as a click on the route under the summit. `redraw()`,
  a `resize` event, `setCenterZoom` and hand-fired `map-redraw` / `map-pan` signals were all
  measured as no-ops. The controller mutes its own pan handling (`isCentering`) while this runs.
- **Neither API may be reachable** (a page mid-load, a future mapy.com refactor). The whole
  chain degrades to a silent no-op and the click still highlights the climb where it is.

### Measuring a section of a climb

The elevation chart on each climb card is drag-selectable: press and drag horizontally to mark a
section, and the colour legend below the chart is replaced by that section's distance and average
gradient until it is cleared (the × button, Escape, or a plain click on the chart). Only one
selection exists at a time across all cards.

`content/chart.ts` stays a pure string renderer; `content/chart-selection.ts` holds the range maths
(`summarizeRange`, `elevationAtDistance`) plus the pointer wiring, which `buildClimbCard` attaches
after `innerHTML`. Three constraints shape it:

- **The chart's margins must not be duplicated.** Pointer x → distance goes through
  `chartXToDistance` / `distanceToChartX` in `chart.ts`, the exact inverse pair of the `sx` the
  curve is drawn with. The SVG is `preserveAspectRatio="none"`, so viewBox units scale linearly
  onto the rendered box and a proportional scale off `getBoundingClientRect` is exact.
- **The readout cannot be SVG text.** That same `preserveAspectRatio="none"` stretches glyphs
  horizontally, so the readout is an HTML row (`.climb-selection`) swapped with `.climb-legend`.
- **A drag must not centre the map.** The card's click handler jumps the map to the climb's summit,
  and a drag ends with a synthetic `click`. After a real drag (≥ 4 px) the module installs a
  one-shot capture-phase `click` listener on the card that swallows it; a press below that
  threshold is left alone, so a plain click still clears the selection and centres the map.

`generateElevationChart` takes an already-simplified `ProfilePoint[]` rather than raw segments, so
the drawn curve and the measured numbers come from the same points.

### Storage

All state lives in `chrome.storage.local` using typed keys from `StorageKey` in `src/types.ts`. Tab-scoped helpers (`getTabStorageKeys`, `getTabState`, `saveTabGpx`, `clearTabState`, `getTabId`) are in `src/storage.ts`.

Key layout:
- `pendingGPX:<tabId>` — latest intercepted GPX + metadata for a tab (no route-class suffix; one per tab)
- `lastAnalysisResult:<tabId>:<routeClass>` — per-alternative-route detection result (e.g. `…:alt-0`, `…:alt-1`)
- `scoringModel` — global scoring preference (`"aso"` | `"garmin"`)
- `mapLayerVisible` — overlay toggle state

A result key always carries a route class, so anything working across a whole tab (clearing
its state, re-categorising after a scoring-model switch) must match on
`getTabStorageKeys(tabId).lastAnalysisResultPrefix` — the `:`-terminated prefix — and never
build one from the exact-key field. Without the trailing colon, tab `1`'s prefix matches
tab `12`'s keys.

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
`chart.ts` / `gradient-zones.ts`, `chart-selection.ts`, `map-geometry.ts`, `climb-card.ts`,
`gpx-parser.ts`, `storage.ts`, `gpx-integration` (full GPX fixture round-trip including hiking),
plus the CLI layer: `garmin-gpx`, `ride-metrics`, `ride-analysis`.

Fixtures in `test/fixtures/` are real Mapy.cz route exports, except
`ride-synthetic.gpx` — a generated ride-shaped track (1 Hz noise, stops, recording gaps,
heart rate) so CLI behaviour can be tested without committing a real ride.

**Tracing the detection pipeline.** `detectClimbs` takes an optional `ClimbDebugSink`
(`src/types.ts`) that emits one structured event per decision point. Two consumers render it:
`npm run test:trace` (`DEBUG_PIPELINE=1` in `test/gpx-integration.test.js`) prints human-readable
lines for the route fixtures, and `climb-cli --debug` writes NDJSON to stderr for a ride GPX.
Both need their flag — vitest's default reporter hides `console.log` from passing tests, so a
plain `npm test` makes `DEBUG_PIPELINE` / `DEBUG_OUTPUT` look broken when they are not.

### Branching and release

`develop` is the integration branch; `main` is the release branch. CI runs on PRs into
either. Pushing to `main` triggers `.github/workflows/release.yml`: build zip → manual
approval (`production` environment) → Chrome Web Store publish → version bump + tag →
GitHub Release → merge `main` back into `develop`. The workflow's own commits carry
`[skip ci]`, and it bumps `package.json` itself — don't hand-bump the version for a release.
CI also enforces CWS limits: locale `extDescription` ≤ 132 chars, manifest `name` ≤ 45 chars,
manifest version matching `package.json`.
