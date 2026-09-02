# MapyClimbs

Browser extension that intercepts GPX exports from Mapy.cz, detects climbs, and injects analysis directly into the route-planner sidebar with live grade-coloured map polylines.

**Browser**: Chrome 88+ / Edge 88+ / Brave, and Firefox (MV3)

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

Then: go to [mapy.cz](https://mapy.cz), open the route planner, plan a route, click **MapyClimbs** in the toolbar. Climb cards appear in the sidebar and the climbs are drawn on the map.

## Project Structure

```
MapyClimbs/
├── ARCHITECTURE.md          ← Layer map + per-file index
├── CLAUDE.md                ← How each mechanism works, and why
├── CHANGELOG.md
├── wxt.config.ts            ← WXT build config + full manifest
├── scripts/                 ← Build-time helpers (What's New bundling, CLI build, fixtures)
├── public/                  ← Icons, en/cs locales, hand-authored whats-new-data.json
├── test/                    ← Vitest suites + real Mapy.cz GPX fixtures
└── src/
    ├── climb-engine.ts      ← Pure detection pipeline (no Chrome APIs, no DOM)
    ├── scoring.ts           ← Scoring models: aso, garmin, hiking
    ├── entrypoints/         ← Service worker, content scripts, popup, What's New page
    ├── injected/            ← Page-context modules (XHR capture, download suppression, map centring)
    ├── content/             ← Sidebar panel, elevation charts, map overlay
    └── cli/                 ← Node CLI: Garmin ride GPX in, climb JSON out
```

Every file under `src/` is listed in [ARCHITECTURE.md](ARCHITECTURE.md).

## Documentation

| File                               | Purpose                                                           |
| ---------------------------------- | ----------------------------------------------------------------- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Layer map and per-file index; points at CLAUDE.md for detail |
| [CLAUDE.md](CLAUDE.md)             | How each mechanism works, and the constraints behind it           |
| [CHANGELOG.md](CHANGELOG.md)       | Full version history                                              |

## Features

- **Auto-capture** — intercepts GPX export requests from Mapy.cz with no manual steps
- **Sidebar panel** — climb cards injected natively into `.route-modules`, scroll with the sidebar
- **Map overlay** — each climb drawn on the map as grade-coloured polylines, re-projected on every pan/zoom via Web Mercator; click a card to centre the map on its summit
- **Elevation charts** — per-climb SVG with Catmull-Rom Bézier curves, grade-coloured gradient fills, and distance labels; drag across one to measure a section
- **Climb metrics** — distance, elevation gain, avg/max grade, VAM, estimated time, Fièts index, difficulty score
- **Route overview** — total distance, total climbing, max grade, proportional climb strip
- **Alternative routes** — every alternative Mapy.cz offers is analysed and cached, so switching between them is instant
- **Hiking mode** — auto-detected from the transport mode; swaps in the TRAILS-GPX scoring formula and wider grade bands
- **Smart detection** — point resampling, adaptive smoothing, valley merging, flat-end trimming, anti-flat splitting

## How It Works

### GPX Capture

`gpx-interceptor-injected.ts` monkey-patches `XMLHttpRequest` in page context (`window.fetch` is deliberately left alone — Mapy.cz issues the export over XHR). When a `/tplannerexport?export=gpx` response completes, the GPX is posted to `interceptor.content.ts` via `postMessage`, which stores it in `chrome.storage.local` and notifies the background worker.

### Climb Detection (`climb-engine.ts`) — 5-step pipeline

1. **Profile** — raw `[distance, elevation, lat, lon]` tuples → structured points
2. **Condition** — resample away GPS micro-jitter, interpolate wide gaps, smooth, compute per-segment gradients
3. **Identify** — find raw climb candidates; a candidate closes on sustained descent or flat
4. **Merge** — collapse adjacent candidates across short valleys, with the permitted gap scaling with combined elevation gain
5. **Trim, score, snap** — strip flat lead-in and tail, categorise, then snap each summit to the raw-profile peak

Every threshold the pipeline uses lives in `src/climb-engine.config.ts`.

### Sidebar & Map

`inject.content.ts` (`RoutePlannerController`) polls for a new GPX after the MapyClimbs button is clicked. On receipt it sends `PROCESS_CLIMBS` to the background worker, then renders the result with `buildPanel` (`content/panel.ts`) and `renderMapOverlay` (`content/map-overlay.ts`), which projects grade-coloured polylines over the map and re-projects them on pan and zoom. A `MutationObserver` re-injects the panel if Mapy.cz removes it during SPA navigation.

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
