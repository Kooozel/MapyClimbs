# Architecture — MapyClimbs

This is the map: what each layer does, what each file is, and where the detail lives. The detail
itself is in [CLAUDE.md](CLAUDE.md) — the mechanisms, the constraints behind them, and the reasons
a thing is shaped the way it is. When the two disagree, `CLAUDE.md` is right; this file is a
directory, and every entry in it is one line.

## Execution model

Five layers inside the browser, over a detection engine that is no longer part of this repo.

```
Mapy.cz / Mapy.com website
  → Page context (src/injected/*)         — monkey-patches XHR, calls page globals; no sandbox
  → Content scripts (src/entrypoints/*)   — intercepts postMessages, drives panel & overlay
  → Service worker (background.ts)        — climb detection, storage, lifecycle
  → Popup (entrypoints/popup/)            — scoring model toggle, layer visibility
  → What's New page (entrypoints/whats-new/) — opened on install/update

                    climb-engine (npm dependency, pinned to a tag)
                          ↑
  background.ts ──────────┘   — detection, scoring and GPX parsing all live in the package
```

Content scripts run in an isolated world and cannot touch page JavaScript, so
`interceptor.content.ts` injects `gpx-interceptor-injected.ts` into page context at
`document_start`; everything crosses back by `postMessage`.

## Flows

**Capture → analysis → display.** The MapyClimbs button triggers Mapy's own GPX export →
`injected/gpx-interceptors.ts` intercepts the XHR and posts `GPX_FETCHED` →
`interceptor.content.ts` stores it under `pendingGPX:<tabId>` → `inject.content.ts` sends
`PROCESS_CLIMBS` → `background.ts` runs `detectClimbs()` → the result renders as the sidebar panel
(`content/panel.ts`) and the SVG map overlay (`content/map-overlay.ts`).
→ `CLAUDE.md` § Key data flow.

**Alternative routes.** `content/button-injector.ts` clicks each `h3.alt-*` heading in turn, waits
for a fresh export per alternative, and stores one result per
`lastAnalysisResult:<tabId>:<routeClass>`; switching alternatives afterwards reads from storage.
→ `CLAUDE.md` § Key data flow, § Storage.

The detection pipeline itself is five steps and lives in the `climb-engine` package (#83); its
own repo documents them. It is not restated here — a third copy is a third thing to keep in sync.

## File index

### `src/` — shared modules

| File | What it is |
| --- | --- |
| `scoring-view.ts` | Where the extension applies a model and filters to the categorised climbs. A scoring-model switch is this and nothing else. |
| `gradient-zones.ts` | Profile → colour-zone pipeline shared by the chart and the map polylines. |
| `map-geometry.ts` | Web Mercator projection and viewport helpers. Pure except `getMapContainer` / `viewportFromURL`. |
| `storage.ts` | Tab-scoped `chrome.storage.local` helpers. Result keys always carry a route class. |
| `types.ts` | The extension's own vocabulary, importing the domain from `climb-engine` and never the reverse: `StorageKey`, the `chrome.runtime` message/response union, `RouteMode`, `StoredAnalysisResult` (measured, as stored) and `ScoredAnalysisResult` / `CategorizedClimb` (scored and filtered, as rendered). |
| `constants.ts` | `MAPY_MATCHES`, `MAP_CONTAINER_SELECTORS`, `PageMessage`, `ElementId`, `CssClass`, route-class helpers. |
| `format.ts` | Display formatting (km, percent, minutes). No Chrome APIs. |
| `map-inject.css` | Injected panel and overlay styles. |

### `src/entrypoints/` — WXT entrypoints

| File | What it is |
| --- | --- |
| `background.ts` | Service worker. Chrome messaging and storage glue only; detection lives in the engine. |
| `interceptor.content.ts` | Content script at `document_start`. Injects the page script, relays `GPX_FETCHED` to storage + background. |
| `inject.content.ts` | Content script at `document_idle`. `RoutePlannerController`: SPA lifecycle, GPX polling, button/panel/overlay injection. |
| `gpx-interceptor-injected.ts` | Page-context unlisted script. Installs the XHR interceptor, download suppressor, and map-centre listener. |
| `popup/index.html`, `popup.ts`, `popup.css` | Scoring-model toggle, overlay visibility, last-capture status. |
| `whats-new/index.html`, `whats-new.ts`, `whats-new.css` | Localised release-notes page, opened by `background.ts` on install/update. |

### `src/injected/` — page context, no sandbox

| File | What it is |
| --- | --- |
| `gpx-interceptors.ts` | Patches `XMLHttpRequest` to capture the GPX export and read the active transport mode. `window.fetch` is deliberately left alone. |
| `download-suppressor.ts` | Patches `HTMLAnchorElement.prototype.click` so the captured export never opens a save dialog. |
| `map-center.ts` | Performs the actual map-centring call, which needs page globals. Vector and raster builds need different APIs. |

### `src/content/` — content-script modules

| File | What it is |
| --- | --- |
| `button-injector.ts` | Injects the MapyClimbs button; drives the export and the alternative-route sweep. |
| `panel.ts` | Sidebar panel orchestrator and event wiring. |
| `panel-template.ts` | Panel shell, header, and empty-state HTML. |
| `route-overview.ts` | Route-level stat card and the proportional climb strip. |
| `climb-card.ts` | Per-climb card DOM: stats, badge, elevation chart. |
| `chart.ts` | Elevation-profile SVG renderer. Pure string output. |
| `chart-selection.ts` | Drag-to-measure: pure range maths plus the pointer wiring attached per card. |
| `map-overlay.ts` | The SVG overlay over the map: projection, visibility, pin flashing. |
| `route-highlight.ts` | Draws and animates each climb's polylines — one glow and one sharp line per gradient zone. |
| `map-center.ts` | Content-script half of click-to-centre: works out the target coordinate, posts it to page context. |
| `category.ts` | `ClimbCategory` → CSS class and colour. |

### `climb-engine` — the detection engine, as a dependency

Detection, scoring and GPX parsing are the `climb-engine` package (`Kooozel/climb-engine`), pinned
in `package.json` to an exact tag and imported by package name (#83). Nothing in this repo
implements them.

| Import | What it gives |
| --- | --- |
| `climb-engine` | `detectClimbs`, `emptyDetectionResult`, `score` + `ASO` / `GARMIN` / `HIKING` / `SCORING_CONFIGS`, `maxGradientOverWindow`, `DEFAULT_CLIMB_CONFIG`, `ClimbCategory`, and every domain type. |
| `climb-engine/gpx` | `parseGpx` — one reader for the browser and for Node. |

The ride CLI moved out with it and ships from the package's own `bin`, `climb-cli`: a Node CLI
that takes a Garmin Connect ride GPX and prints enriched climb JSON on stdout for a downstream
`sync.py --insert-climbs` importer. `npm run build:cli` and `dist-cli/` no longer exist here.

The version pin is deliberate and must stay exact — never a range. See `CLAUDE.md`
§ The climb engine is a dependency.

### `test/`

Plain JS with Vitest + happy-dom. Detection, scoring and GPX parsing are tested in `climb-engine`
and not re-tested here. `test/fixtures/` holds one file, `travny.gpx`, a real Mapy.cz route export
read only by `engine-smoke.test.js`.

| File | Covers |
| --- | --- |
| `engine-smoke.test.js` | One real route through the *installed* package, pinned exactly — the guard on a bad version bump. |
| `chart.test.js` | The chart renderer and `gradient-zones.ts`. |
| `chart-selection.test.js`, `chart-selection-dom.test.js` | Drag-to-measure: range maths, then pointer wiring. |
| `map-geometry.test.js`, `map-center.test.js` | Projection, and click-to-centre's target coordinate. |
| `max-gradient.test.js` | That the card's `maxPitchGradient` and the engine's sustained figure cannot contradict each other (#44). |
| `panel.test.js` | Panel rendering. |
| `storage.test.js`, `route-class.test.js` | Tab-scoped keys and route-class parsing. |

### `scripts/` and `public/`

| File | What it is |
| --- | --- |
| `scripts/generate-whats-new.mjs` | Validates and bundles `public/whats-new-data.json`; runs as part of `npm run build`. |
| `public/whats-new-data.json` | Hand-authored user-facing release bullets. Its `version` must match `package.json`. |
| `public/_locales/en/messages.json`, `public/_locales/cs/messages.json` | UI strings behind the `__MSG_*__` manifest keys. |
| `public/images/` | Extension icons, copied as-is. |
| `wxt.config.ts` | WXT build config and the full manifest: permissions, host permissions, web-accessible resources, i18n. |

## Where the detail lives

| Topic | Section |
| --- | --- |
| Tuning detection | `CLAUDE.md` § Tuning climb detection |
| The two max-gradient figures | `CLAUDE.md` § Tuning climb detection |
| Hiking mode | `CLAUDE.md` § Hiking mode |
| Vector vs raster map builds | `CLAUDE.md` § Map overlay |
| Click-to-centre | `CLAUDE.md` § Centering the map on a climb |
| Drag-to-measure | `CLAUDE.md` § Measuring a section of a climb |
| Storage layout and the split result | `CLAUDE.md` § Storage |
| The CLI's contract | `CLAUDE.md` § Climb-engine CLI |
| Tracing the pipeline | `CLAUDE.md` § Tests |
| Branching and release | `CLAUDE.md` § Branching and release |

## Security

- **Isolated world**: content scripts cannot reach page JavaScript; everything crosses by
  `postMessage`.
- **Origin guard**: every `message` listener on both sides of that boundary checks
  `event.source === window && event.origin === location.origin` before acting —
  `interceptor.content.ts`, `inject.content.ts`, `injected/download-suppressor.ts`,
  `injected/map-center.ts`.
- **No external requests**: all processing is local; the extension makes no outbound connections
  and collects nothing.
- **Least privilege**: the manifest asks for `storage` and mapy.cz / mapy.com host permissions,
  and nothing else (`wxt.config.ts`).
- **Storage scope**: `chrome.storage.local` is per-extension; no cross-extension access.
