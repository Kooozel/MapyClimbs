# Changelog — MapyClimbs

All notable changes to the MapyClimbs extension are documented here.

## [1.0.0] — 2026-04-02 (First Public Release)

### Changed

- Version bumped to 1.0.0 for initial Chrome Web Store publication.

---

## [0.6.0] — 2026-04-02 (TypeScript Migration)

### Added

- `src/types.ts` — shared domain types and message interfaces: `StorageKey`, `Climb`, `GpsPoint`, `ElevationTuple`, `ExtensionMessage`, `ProcessClimbsMessage`, `AnalyzeGpxMessage`, `GpxCapturedMessage`, `ClimbsResponse`
- `ANALYZE_GPX` message type — background worker accepts raw GPX content directly; used by the popup retry flow so it no longer depends on a separately parsed elevation profile
- `_locales/cs/messages.json` and `_locales/en/messages.json` — full i18n message catalogs (Czech and English)
- `vite.config.ts` — Vite + `@crxjs/vite-plugin` build, replacing the hand-rolled `build.js`
- `tsconfig.json` — TypeScript strict-mode configuration
- `test/climb-engine.test.js` — Vitest test suite (40 tests, 83.6% branch coverage)
- CI — GitHub Actions workflow (`.github/workflows/ci.yml`): typecheck, lint, and test on every push
- ESLint flat config (`eslint.config.js`) and Prettier (`.prettierrc`) for consistent code style

### Changed

- Complete rewrite of all source files from JavaScript to TypeScript under `src/`
- File renames: `gpx-interceptor.js` → `interceptor.ts`; `map-inject-chart.js` → `content/chart.ts`; `map-inject-panel.js` → `content/panel.ts`; `map-inject.js` → `content/inject.ts`; `popup.js` → `popup.ts`
- Source root moved from `extension/` to `src/`; `manifest.json` promoted to repo root
- `chart-utils.js` merged into `content/chart.ts`; SVG icons replaced with PNG (required by Chrome for packed extensions)
- `npm run build` now runs Vite; `npm run pack` wraps web-ext around the Vite output

---

## [0.5.5] — 2026-04-01 (CSS Cleanup)

### Changed

- `map-inject.css`: removed duplicate header comment; fixed `.cip-header-bar` border order (was overwritten by `border: none`); removed redundant `:hover` from `#climb-inject-button` outer compound selector; removed non-standard `image-rendering: optimizeQuality` from `.profile-svg`
- `popup.css`: removed ~110 lines of dead chart/tooltip/legend CSS left over from when the elevation chart lived in the popup (`.climb-chart`, `.hover-line`, `.hover-tooltip`, `.tooltip-row`, `svg path.climb-fill`, `.chart-legend`)

---

## [0.5.4] — 2026-04-01 (Refactor & Bug Fixes)

### Added

- `climb-engine.js` — extracted all climb-detection logic from `background.js` into a standalone pure ES module; `background.js` now imports `detectClimbs` from it

### Fixed

- `climb-engine.js` — `filterNoiseSpikes` read from the already-mutated result array, causing cascade over-smoothing; now reads from an immutable copy of the original
- `climb-engine.js` — `splitAntiGreenClimbs` copied the parent climb's `markerCoords`/`endCoords` to sub-climbs instead of stamping from the sub-climb's own first/last segment (wrong map pins)
- `climb-engine.js` — `smoothElevationProfile` had an O(n²) double full-array scan; replaced with O(n) two-pointer sliding windows
- `map-inject.css` — fixed `.cip-header-bar` where `border: none` was declared before `border-bottom`, causing it to silently overwrite the separator

### Changed

- Removed all `console.log` / `console.*` calls from `climb-engine.js`, `gpx-parser.js`, `gpx-interceptor.js`, `gpx-interceptor-injected.js`
- `gpx-interceptor.js`: added `event.data?.type` null guard (prevented crash on bare `postMessage` events); removed dead `sessionStorage` dual-write block; replaced empty storage callbacks with `() => { void chrome.runtime.lastError; }`
- `gpx-interceptor-injected.js`: removed unused `xhrGPXUrl` variable and `injected` counter; renamed unused catch params to `_`
- `map-inject.js`: split 900-line monolithic IIFE into three files — `map-inject-chart.js` (SVG chart renderer), `map-inject-panel.js` (sidebar DOM builder), `map-inject.js` (SPA lifecycle controller only); removed fake `savitzkyGolay` implementation (built a polynomial design matrix then ignored it and did a plain moving average)
- `manifest.json`: content-script `js` array updated to load `map-inject-chart.js` and `map-inject-panel.js` before `map-inject.js`
- Removed `'use strict'` from ES modules (redundant)

---

## [0.5.3] — 2026-04-01 (Segmented Aura Charts)

### Changed

- `map-inject.js` — rewrote `renderElevationSVG()`: Catmull-Rom Bézier curves replace jagged polyline; fill uses per-segment vertical gradients (green < 3%, orange 3–9%, red > 9%) plus a category-colour aura overlay; 2px category-colour stroke; max-grade badge positioned at the steepest point; soft grid lines at 10% opacity
- Category colour palette updated: HC `#800020`, C1 `#D32F2F`, C2 `#F57C00`, C3 `#FBC02D`, C4 `#4CAF50`

---

## [0.5.2] — 2026-04-01 (Map Pins Redesign)

### Changed

- `map-inject.js` — replaced teardrop start pins with a numbered circle ("The Pulse", 32×52 px) and mountain silhouette end pins ("The Summit") bearing the category label; heat-scale palette HC `#660000` → C4 `#FFD600`; drop-shadow filter for terrain contrast

---

## [0.5.1] — 2026-04-01 (Smoothing & Trimming)

### Added

- `climb-engine.js` — `resamplePoints()`: merges GPS points < 12 m apart, eliminating elevation-chart stripes
- `climb-engine.js` — `splitAntiGreenClimbs()`: splits climbs that contain > 400 m of < 2% grade in the middle
- `climb-engine.js` — `trimClimbEndpoints()`: strips flat (< 1.5%) lead-in and tail from each climb

### Fixed

- Climb profiles ending past the summit (trailing flat/downhill sections) now trimmed correctly

---

## [0.5.0] — 2026-04-01 (Algorithm Overhaul)

### Added

- `climb-engine.js` — `smoothElevationProfile()`: adaptive rolling average (50–250 m window, weighted by terrain gradient)
- `climb-engine.js` — `filterNoiseSpikes()`: interpolates single-segment DEM spikes (> 12% asymmetric)
- `climb-engine.js` — `mergeNearbyClimbs()`: joins climbs separated by valleys ≤ 2 km / ≤ 15% relative gain drop
- Popup: loading spinner, climb-count + total-distance display, retry button
- `background.js`: storage versioning — clears stale cache on schema change

### Changed

- Minimum elevation gain threshold raised from 10 m → 30 m
- Descent confirmation distance tightened to 150 m

---

## [0.4.1] — 2026-03-31 (UX Polish & Lifecycle Fixes)

### Added

- Info popup (`popup.html` / `popup.css` / `popup.js`): status dot, usage guide, category scoring table
- One-click analysis: injected _MapyClimbs_ button silently triggers and confirms the Mapy.cz Export modal
- `gpx-interceptor-injected.js`: intercepts `HTMLAnchorElement.click` to suppress blob download when triggered by the extension

### Changed

- `isRoutePlannerActive()`: now also checks that `.route-actions` or `.route-modules` is present and visible (`offsetParent !== null`)
- 150 ms poll: tracks `_lastRoutePlannerVisible` — clears overlay and storage the moment the route-planner DOM disappears
- Export modal: switched to `MutationObserver` (fires before first paint) + `opacity:0` hide — never visible to the user
- `findGPXExportButton()`: primary selector updated to `.icon-action[title="Export"] button`

### Fixed

- Panel and map pins left visible after navigating away from the route planner
- Stale climb result from a previous route reappearing on re-open

---

## [0.4.0] — 2026-03-31 (Sidebar Panel & Map Overlay)

### Added

- `map-inject.js` + `map-inject.css`: sidebar climb panel injected into `.route-modules`; route overview strip; per-climb stat cards (VAM, estimated time, Fiets index); SVG elevation charts; hover chart expand (600×220 overlay)
- Map overlay: start (numbered teardrop) and end (mountain + category badge) SVG pins positioned with Web Mercator math from URL `x`/`y`/`z` params; 150 ms re-render on pan/zoom

### Changed

- `background.js` now returns `totalDistance` alongside `climbs`; cached as `lastTotalDistance`
- GPX parser preserves `lat`/`lon` through smoothing so `markerCoords`/`endCoords` are always populated

---

## [0.3.0] — 2026-03-31 (Formula & Threshold Overhaul)

### Changed

- Difficulty formula changed from `distance × grade × 2` to `distance × grade × 100` (ProCyclingStats standard)
- Category thresholds updated to match ProCyclingStats: Cat 3 ≥ 3 000, Cat 2 ≥ 8 000, Cat 1 ≥ 16 000, HC ≥ 40 000
- GPX interceptor refactored into two-layer architecture (page context + content script) for reliable fetch/XHR capture
- Removed `downloads` permission (not needed)
