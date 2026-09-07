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
npx vitest run test/engine-smoke.test.js
```

The pre-commit hook runs `lint-staged`: Prettier on `*.{ts,css}` then ESLint `--fix` on `*.ts`.

## Architecture

This is a browser extension (Chrome MV3, Firefox MV3) built with [WXT](https://wxt.dev/). It intercepts GPX exports from Mapy.cz, detects cycling and hiking climbs, and injects analysis into the route-planner sidebar with live colour-coded map polylines.

### Five-layer execution model

```
Mapy.cz website
  → Page context (injected/*)         — monkey-patches XHR, no sandbox
  → Content scripts (entrypoints/*)   — intercepts postMessages, drives panel & overlay
  → Service worker (background.ts)    — climb detection, storage, lifecycle
  → Popup (popup/)                    — model toggle, layer visibility
  → What's New page (whats-new/)      — opened on install/update
```

Climb detection itself sits outside this stack entirely: it is the `climb-engine`
package (see [The climb engine is a dependency](#the-climb-engine-is-a-dependency)),
which `background.ts` imports like any other dependency.

Because content scripts cannot access page JS directly, `interceptor.content.ts` injects `gpx-interceptor-injected.ts` into page context at `document_start`. GPX data travels back via `postMessage` → `interceptor.content.ts` → `chrome.storage.local` → background service worker.

### Key data flow

1. **GPX capture**: `injected/gpx-interceptors.ts` intercepts `XHR` to `/tplannerexport?export=gpx`, detects route mode (cycling / hiking / other) from the active transport icon in the DOM, and posts `GPX_FETCHED`. `injected/download-suppressor.ts` suppresses the browser save dialog.

2. **Alternative routes**: `button-injector.ts` iterates every `h3.alt-*` heading in the route-summary panel, clicks each one, waits for a fresh GPX export, and stores results per `lastAnalysisResult:<tabId>:<routeClass>`. A fullscreen loader is shown during this automation. Switching between alternatives instantly loads the cached result from storage.

3. **Climb detection**: `inject.content.ts` (`RoutePlannerController`) sends `PROCESS_CLIMBS` to background → `background.ts` runs `detectClimbs()` from `climb-engine.ts` (5-step pipeline) → returns `DetectionResult` (every measured candidate + route-level stats). The active route mode is stored with the GPX and forwarded, so `scoring-view.ts` can force a hiking route to the hiking model when it scores the result for display.

4. **Display**: `RoutePlannerController` calls `buildPanel()` (`content/panel.ts`) and `renderMapOverlay()` (`content/map-overlay.ts`). The SVG overlay re-projects colour-coded polylines on every pan/zoom with a 350 ms debounce.

### Tuning climb detection

Detection is not tuned in this repo any more — the pipeline and its constants live in the
`climb-engine` package. All numeric constants (resample interval, interpolation gap, smoothing
window, spike thresholds, merge gaps, trim thresholds, summit-snap lookahead) are one exported
object, `DEFAULT_CLIMB_CONFIG`, and the *only* way to move them from here is to override a subset
at the call site — `detectClimbs(data, { config: { CLIMB_START_GRADE_PCT: 4 } })` — which the
engine shallow-merges over the defaults once, at the top of `detectClimbs` (#76). Two keys,
`SPIKE_MAX_SEGMENT_M` and `TRIM_START_GRADE_PCT`, are *computed* from another key to produce their
default and are then plain keys: overriding what they derive from does not move them, so set both.
Nothing is validated — a wrong number produces wrong climbs, which is the consumer's business.
A change the default should carry belongs in `climb-engine` and arrives here as a version bump.

Scoring models (`ASO`, `GARMIN`, `HIKING`) and category thresholds come from the same package —
a view over a detection result, not a pipeline step; `src/scoring-view.ts` is where the extension
applies one and filters. Gradient zone colours and the full profile → zone pipeline stay here, in
`src/gradient-zones.ts`.

Two different figures are called a "max gradient", and both come from the engine's single
`maxGradientOverWindow` scan so they cannot drift apart again: `MeasuredClimb.maxSustainedGradient`
(measured inside the engine) reads the dense smoothed segments over a 200 m window and feeds the
hiking score, while `maxPitchGradient` (`src/gradient-zones.ts`, on this side) reads the simplified
chart profile and is the card's "Max grade" stat, which must never contradict the steepest colour
band drawn above it. `test/max-gradient.test.js` is the guard on that agreement and is the reason
the engine re-exports `_computeMaxSustainedGradient`.

### The climb engine is a dependency

Climb detection is the `climb-engine` package (`Kooozel/climb-engine`), consumed here as a git
dependency and imported by package name. No file in this repo implements detection (#83).

**The version is pinned to an exact tag, and it must stay that way:**

```json
"climb-engine": "github:Kooozel/climb-engine#v0.1.0"
```

Never widen this to `#semver:^0.1.0` or a branch. A retune changes what every card on the map
says, so it must arrive as a deliberate act — a tag bump in one line of `package.json`, with the
lockfile's resolved commit as the provenance. `test/engine-smoke.test.js` pins the *installed*
package's output on a real route, so a bump that moves detection fails there loudly instead of
surfacing as a wrong panel in the browser; when a bump is intended, re-pin those numbers in the
same commit.

What to import from where:

- **`climb-engine`** — `detectClimbs`, `emptyDetectionResult`, `score` plus `ASO` / `GARMIN` /
  `HIKING` / `SCORING_CONFIGS`, `maxGradientOverWindow`, `DEFAULT_CLIMB_CONFIG`, `ClimbCategory`,
  and every domain type (`MeasuredClimb`, `ScoredClimb`, `DetectionResult`, `Segment`, `Coords`,
  `ElevationTuple`, `ScoringModel`, `ClimbConfig`).
- **`climb-engine/gpx`** — `parseGpx`. One reader, running in the browser and in Node.
- Anything `_`-prefixed carries no semver promise and exists for tests.

Two properties of the engine the extension depends on, and must not paper over:

- **`detectClimbs` is deterministic.** No clock, no ambient state: same input, same output.
  `DetectionResult` therefore has no `timestamp` and no `routeMode`; the extension adds both at
  the storage boundary via `stampResult()` (`src/storage.ts`), producing a `StoredAnalysisResult`.
- **The core measures; it does not judge.** `detectClimbs` takes no scoring model and returns
  every candidate as a `MeasuredClimb` — geometry only. Whether a climb counts is this side's
  question, so `score(result, model)` is a separate view returning `ScoredClimb`s whose `category`
  is `null` when nothing was cleared, and the consumer filters (#77). The hiking model in
  particular is chosen here, in `src/scoring-view.ts`, not in the engine.

`src/types.ts` stays extension-only — `StorageKey`, the `chrome.runtime` message union,
`RouteMode`, `StoredAnalysisResult` — and the dependency runs one way: it imports the domain from
the package, never the reverse. That used to be a hand-maintained rule policed by
`tsconfig.engine.json` and an `ENGINE_CLOSURE` walk in `scripts/build-cli.mjs`; both are gone,
because the package boundary enforces it now.

### Hiking mode

Hiking mode is auto-detected: `injected/gpx-interceptors.ts` reads the active transport-icon class from the Mapy.cz DOM and sets `routeMode = "hiking"` in the stored `GpxInfo`. The render path then applies the TRAILS-GPX hiking formula (summit elevation + max gradient + distance) instead of the ASO/Garmin cycling formula — see `effectiveModel` in `src/scoring-view.ts`. Grade colour bands are wider (5 / 10 / 20 / 30 / 40 %) to match walking pace. Hiking routes always keep the hiking model regardless of the user's scoring preference.

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

All state lives in `chrome.storage.local` using typed keys from `StorageKey` in `src/types.ts`. Tab-scoped helpers (`getTabStorageKeys`, `getTabState`, `saveTabGpx`, `clearTabState`, `getTabId`, `stampResult`) are in `src/storage.ts`. A stored result is a `StoredAnalysisResult` — the engine's clock-free `DetectionResult` plus the `timestamp` and `routeMode` this side stamps on. It holds *measurements*: every candidate the pipeline found, with no difficulty and no category (#77).

Key layout:
- `pendingGPX:<tabId>` — latest intercepted GPX + metadata for a tab (no route-class suffix; one per tab)
- `lastAnalysisResult:<tabId>:<routeClass>` — per-alternative-route detection result (e.g. `…:alt-0`, `…:alt-1`)
- `scoringModel` — global scoring preference (`"aso"` | `"garmin"`)
- `mapLayerVisible` — overlay toggle state

A result key always carries a route class, so anything working across a whole tab (clearing
its state) must match on
`getTabStorageKeys(tabId).lastAnalysisResultPrefix` — the `:`-terminated prefix — and never
build one from the exact-key field. Without the trailing colon, tab `1`'s prefix matches
tab `12`'s keys.

A stored result is large — one `Segment` per ~12 m, so a 100 km route is ~1.3 MB of JSON,
almost all of it `climbs[].segments` — and the manifest asks for `storage` without
`unlimitedStorage`, so the default 10 MB quota applies across every tab and alternative.
Each segment is written exactly once, in the one `climbs[]` array. That array used to be
only the climbs the current model had kept, with the rejects beside it in
`droppedCandidates[]` so a model switch could give them back; the pair existed because
detection dropped what it would not score, and encoding it as a partition was what kept
the geometry from being serialised twice (issue #49). Detection keeps everything now, so
the partition and its deprecated predecessor `candidates` are both gone, at a cost of a
few scalars per previously-rejected candidate.

**A scoring-model switch performs no storage write.** The popup's `RECATEGORIZE_CLIMBS`
message makes the background broadcast the new preference; each content script re-scores
the result it already holds (`scoring-view.ts`) and repaints. It used to read every result
key across every open tab, re-partition each one and write them all back — a storage sweep
to change a display choice.

`STORAGE_VERSION` is `2`. The version guard clears everything on a mismatch, but re-writes
`scoringModel`, `mapLayerVisible` and `lastSeenVersion` afterwards: analysis results
regenerate on the next GPX export, those three have no such source.

### i18n

UI strings use `__MSG_*__` manifest keys. Locale files: `public/_locales/en/messages.json` and `public/_locales/cs/messages.json`.

### What's New page

`public/whats-new-data.json` is **hand-authored** user-facing bullets — it is not derived from `CHANGELOG.md`. Update it before each release. `scripts/generate-whats-new.mjs` validates and bundles it at build time (runs automatically as part of `npm run build`). The `version` field must match `package.json`.

### Climb-engine CLI

The ride CLI moved out with the engine (#83). It ships from the `climb-engine` package as its
`bin`, `climb-cli` — a Node CLI that takes a **Garmin Connect ride GPX** and prints enriched climb
JSON on stdout for a downstream `sync.py --insert-climbs` importer. Nothing in this repo builds or
tests it; `npm run build:cli` and `dist-cli/` are gone. Its consumers (`~/sport`, krpaly) take the
standalone `climb-cli.mjs` / `climb-engine.mjs` assets from the library's own releases.

Two things worth knowing from this side, because they explain the shape of the shared reader:
`parseGpx` (`climb-engine/gpx`) scans the XML itself — no `DOMParser`, no Node API, which is what
lets one reader serve the browser and the CLI — and it keeps `<time>` and heart rate, which ride
analysis needs and the extension ignores. Malformed XML and a well-formed empty track raise the
same error, which the panel never renders anyway.

### Tests

Tests are plain JS in `test/` using Vitest + happy-dom. Detection, scoring and GPX parsing are
tested in `climb-engine` and not re-tested here; what remains is consumer-side: `chart.ts` /
`gradient-zones.ts`, `chart-selection.ts`, `map-geometry.ts`, `map-center.ts`, `panel.ts`,
`route-class.ts`, `storage.ts`, `max-gradient` (the two-sides-agree guard, see
[Tuning climb detection](#tuning-climb-detection)), and `engine-smoke` — one real route through
the *installed* package, pinned exactly, so a bad version bump fails here rather than in the
browser.

`test/fixtures/` holds one file, `travny.gpx`, a real Mapy.cz route export, and
`engine-smoke.test.js` is its only reader. The other seven fixtures and `expected.js` went to
`climb-engine` with the tests that read them.

**Tracing the detection pipeline.** `detectClimbs` still takes an optional `ClimbDebugSink` that
emits one structured event per decision point, but both renderers of that stream now live in the
library: its own trace script, and `climb-cli --debug`, which writes NDJSON to stderr for a ride
GPX. Trace a suspect route by running it through the CLI, or in the engine's repo.

### Branching and release

`develop` is the integration branch; `main` is the release branch. CI runs on PRs into
either. Pushing to `main` triggers `.github/workflows/release.yml`: build zip → manual
approval (`production` environment) → Chrome Web Store publish → version bump + tag →
GitHub Release → merge `main` back into `develop`. The workflow's own commits carry
`[skip ci]`, and it bumps `package.json` itself — don't hand-bump the version for a release.
CI also enforces CWS limits: locale `extDescription` ≤ 132 chars, manifest `name` ≤ 45 chars,
manifest version matching `package.json`.
