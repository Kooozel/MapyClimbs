# Architecture — MapyClimbs

## System Overview

The extension uses a **five-layer architecture** for GPX capture, analysis, and display:

```
┌─────────────────────────────────────────┐
│         Mapy.cz Website                 │
│  (Fetch/XHR to /api/tplannerexport)     │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  Page Context (Injected Script)         │
│  gpx-interceptor-injected.js            │
│  - Intercepts FETCH & XHR               │
│  - Converts blob responses to text      │
│  - Posts GPX via postMessage            │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  Content Script Context                 │
│  gpx-interceptor.js                     │
│  - Listens for GPX via postMessage      │
│  - Stores in chrome.storage.local       │
│  - Notifies background worker           │
│  - Maintains port to popup              │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  Service Worker Context                 │
│  background.js                          │
│  - Receives GPX via chrome.runtime API  │
│  - Processes climb detection            │
│  - Responds to popup requests           │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  Popup Context                          │
│  popup.js/html/css                      │
│  - Shows last capture status            │
│  - Displays climb count + distance      │
│  - Retry button for reanalysis          │
└─────────────────────────────────────────┘
```

_(Sidebar panel and map pins are rendered by the content scripts_
_`map-inject-chart.js` + `map-inject-panel.js` + `map-inject.js` —_
_not by the popup.)_

## Data Flow

### 1. GPX Capture Flow

```
User clicks "Export Route" on Mapy.cz
         ↓
XHR/Fetch to /api/tplannerexport?export=gpx
         ↓
gpx-interceptor-injected.js intercepts response
         ↓
Converts blob/text to GPX string
         ↓
window.postMessage({ type: 'GPX_FETCHED', gpxContent })
         ↓
gpx-interceptor.js content script receives message
         ↓
Stores in chrome.storage.local
Sends message to background.js
Notifies popup via port
         ↓
Extension icon shows notification (optional)
```

### 2. Analysis & Display Flow

```
User clicks "MapyClimbs" button injected in the route toolbar
         ↓
map-inject.js: onClimbButtonClick() → pollForGPX()
         ↓
Reads { pendingGPX, lastTotalDistance } from chrome.storage.local
         ↓
Calls parseGPX() from gpx-parser.js (shared content-script library)
         ↓
Generates elevation profile [[distance_m, elevation_m, lat, lon], ...]
         ↓
Sends PROCESS_CLIMBS message to background.js
         ↓
background.js imports detectClimbs() from climb-engine.js
climb-engine.js 7-step pipeline:
  1. Build structured profile from raw tuples
  2. resamplePoints() - remove GPS micro-jitter (<12 m)
  3. smoothElevationProfile() / filterNoiseSpikes() - adaptive smoothing
  4. calculateGradients() → identifyClimbs() → mergeNearbyClimbs() (2000 m)
  5. trimClimbEndpoints() → categorizeClimb() per climb
  6. splitAntiGreenClimbs() - split on >400 m of <2% grade
  7. mergeNearbyClimbs() again (1500 m) → re-trim / re-categorize
         ↓
Returns Climb[] to background.js
         ↓
background.js stores results in chrome.storage.local, responds to map-inject.js
         ↓
map-inject.js calls buildPanel(climbs, totalRouteDistance) from map-inject-panel.js
map-inject.js calls renderMapOverlay(climbs) to place Web Mercator pins
```

## File Responsibilities

### `manifest.json`

- Extension metadata, permissions (`storage` only)
- Service worker with `"type": "module"` (enables ES module `import` in background.js)
- Content scripts: `gpx-interceptor.js` at `document_start`; `gpx-parser.js` + `map-inject-chart.js` + `map-inject-panel.js` + `map-inject.js` at `document_idle`
- Web-accessible resource: `gpx-interceptor-injected.js`
- Host permissions for `mapy.cz` and `mapy.com`

### `gpx-interceptor-injected.js`

**Context**: Page/window context (not sandboxed)
**When**: Runs at document_start
**Responsibilities**:

- Intercepts `window.fetch()` calls
- Intercepts `XMLHttpRequest` open/send
- Detects URLs containing "tplannerexport" and "export=gpx"
- Handles both blob and text responses
- Converts blob responses to text
- Posts captured GPX to content script via postMessage

### `gpx-interceptor.js`

**Context**: Content script (sandboxed, separate from page)
**When**: Runs at document_start
**Responsibilities**:

- Injects gpx-interceptor-injected.js into page
- Listens for postMessage events from injected script
- Validates GPX content
- Stores in chrome.storage.local
- Sends chrome.runtime.sendMessage to background.js
- Maintains persistent port connection to popup

### `background.js`

**Context**: Service worker ES module (always running)
**Responsibilities**:

- Storage version guard — clears stale cache on schema change
- Manages connected popup port list for push notifications
- Handles `GPX_CAPTURED` messages: stores GPX + timestamp, notifies popup ports
- Handles `PROCESS_CLIMBS` messages: delegates to `detectClimbs()` (imported from `climb-engine.js`), writes results to storage, sends response

### `climb-engine.js`

**Context**: ES module imported by `background.js`
**Responsibilities** (pure functions — no Chrome APIs):

- `detectClimbs()` — 7-step pipeline entry point
- `resamplePoints()` — remove GPS micro-jitter (<12 m gap)
- `smoothElevationProfile()` — adaptive-window rolling average (50–250 m)
- `filterNoiseSpikes()` — interpolate one-sided DEM artifacts (>12% / <8% asymmetric spike check)
- `calculateGradients()` — per-segment `(Δelev/Δdist)×100`
- `identifyClimbs()` — sliding-window climb detection
- `pushClimb()` — validate and push a climb candidate
- `mergeNearbyClimbs()` — join climbs separated by short valleys
- `trimClimbEndpoints()` — strip flat (<1.5%) lead-in/tail
- `splitAntiGreenClimbs()` — split on >400 m of <2% grade
- `categorizeClimb()` — ProCyclingStats score → HC/1/2/3/4

Only `detectClimbs` is exported; all other functions are private to the module.

### `gpx-parser.js`

**Context**: Shared library — loaded as content script on mapy.cz pages AND via `<script>` tag in `popup.html`
**Responsibilities**:

- Parse GPX XML format with support for three namespace variants
- Extract track points with latitude, longitude, elevation
- Calculate cumulative distance using the Haversine formula
- Return elevation profile as `[[distance_m, elevation_m, lat, lon], ...]`

### `popup.html`

- 280px-wide info popup opened from the toolbar icon
- Shows GPX capture status (dot indicator + timestamp)
- Shows last analysis summary: climb count + total route distance
- Loading spinner while analysis runs; retry button if no climbs found
- Static sections: how-to guide, category reference table, buy-me-a-coffee link
- No climb cards — full analysis is in the injected sidebar panel

### `popup.css`

- Dark-theme styles for the 280px toolbar popup
- Status dot, spinner animation, retry button, info sections

### `popup.js`

**Context**: Popup window script (runs when popup opened)
**Responsibilities**:

- Establish persistent port connection to background.js for push notifications
- Read `lastClimbResult` + `lastTotalDistance` from `chrome.storage.local` on open
- Update climb count and total distance display
- Show spinner while analysis is pending; show retry button if result is empty
- Retry button re-sends the last `pendingGPX` to background.js for reanalysis

### `map-inject.js`

**Context**: Content script IIFE — SPA lifecycle controller
**State** (private to IIFE): `_climbs`, `_panelInjected`, `_lastGPXLength`, `_totalRouteDistance`
**Responsibilities**:

- `isRoutePlannerActive()` — guards all logic; returns false outside the route-planner view
- `init()` — entry point: hooks `pushState`, starts `MutationObserver`, starts 150 ms poll loop
- `onClimbButtonClick()` — triggered by injected button; calls `pollForGPX()`
- `pollForGPX()` — reads `pendingGPX` + `lastTotalDistance` from storage; sends `PROCESS_CLIMBS` to background
- `analyzeGPX(gpxText)` → `parseGPX()` → sends message → on response calls `renderPanel` + `renderMapOverlay`
- `renderPanel()` / `tryInjectPanel()` — calls `buildPanel(climbs, totalRouteDistance)` from `map-inject-panel.js`
- `renderMapOverlay(climbs)` — reads viewport from URL `x`/`y`/`z` params; places Web Mercator SVG pins
- `tryInjectButton()` / `buildButton()` — injects "MapyClimbs" button next to export button in toolbar
- `clearRoutePlannerState()` — removes panel, overlay, and storage keys when route planner closes
- `onMutation()` — re-injects button/panel if Mapy.cz SPA navigation removes them

### `map-inject-chart.js`

**Context**: Content script (loaded before `map-inject.js`, shares global scope)
**Responsibilities**:

- `generateElevationChart(segments, totalDistanceMeters, climbCategory)` — entry point
- `simplifyElevationProfile(profile)` — reduce points for SVG rendering
- `renderElevationSVG(profile, totalDistance, climbCategory)` — builds SVG with Catmull-Rom Bezier curves, grade-coloured gradient fills, and X-axis distance labels
- No Chrome APIs, no mutable state (except an internal `_chartUid` counter for unique SVG IDs)

### `map-inject-panel.js`

**Context**: Content script (loaded after `map-inject-chart.js`, before `map-inject.js`)
**Responsibilities**:

- `buildPanel(climbs, totalRouteDistance)` — constructs the full sidebar DOM tree
- `buildClimbCard(climb, index)`, `buildRouteOverview(climbs, totalRouteDistance)` — card/overview builders
- `showChartOverlay(svgEl)` / `hideChartOverlay()` — floating chart overlay on hover
- `calcVAM`, `estimateClimbTime`, `calcFiets`, `calcMaxGradientOver` — per-climb metric helpers
- Depends on `generateElevationChart` from `map-inject-chart.js`

## Key Design Decisions

### 1. Two-Layer Injection

**Why**: Content scripts run in a sandbox, can't access page's fetch/XHR directly
**Solution**: Inject a second script that runs in page context
**Trade-off**: More complex, but guaranteed to intercept all network calls

### 2. Single Storage Backend

**Why**: GPX capture must survive extension reload/popup close
**Solution**: Store exclusively in `chrome.storage.local` (persistent, accessible from service worker and content scripts)
**Note**: An earlier `sessionStorage` dual-write was removed — service workers cannot read `sessionStorage` and the popup reads from `chrome.storage.local` directly

### 3. Persistent Port Connection

**Why**: Popup can close while GPX is being exported
**Solution**: Maintain port connection even after popup closes
**Benefit**: Background can notify popup of new GPX, and data survives tab close

### 4. ProCyclingStats Formula

**Why**: Industry standard for climb difficulty
**Formula**: `distance(km) × avgGrade(%) × 100`
**Advantage**: Matches professional cycling categorization systems, better than simple distance/elevation

### 5. Sliding Window Detection

**Why**: Accurately identify contiguous climb sections
**Algorithm**:

- Start when gradient >3% for 500m+
- End when gradient <0% for 300m+
- Trim flat sections from start/end (threshold 4%)
- Remove spikes followed by 150m+ flat sections

## Security Considerations

- Content script sandbox: Can't access page's JavaScript
- Page-level injection: Has full access but isolated per tab
- Storage: Uses chrome.storage.local (safe per-extension scope)
- No external API calls: All processing local

## Performance Optimizations

1. **SVG Charts**: Pre-simplify elevation profile to ~10 points for rendering
2. **Lazy Parsing**: Parse GPX only when popup opened
3. **Service Worker**: Pre-compile climb detection, avoid repeated calculations
4. **Message Batching**: Send all climbs in one message, not one per climb
5. **Port Reuse**: Single persistent port to background, not new message per update

## Known Limitations

1. **Marker Positioning**: Web Mercator math reads center/zoom from URL `x`/`y`/`z` params — no SMap API required; works at any zoom level
2. **Spike Detection**: Single-sample DEM spikes shorter than one segment may not be caught by the asymmetric thresholds
3. **Real-time Updates**: No live tracking; analysis runs on GPX export only
4. **Multi-tab**: Each tab's GPX overwrites the previous (design choice — single active route assumed)

## Algorithm Details

### Gradient Calculation

$$\text{gradient} = \frac{\Delta \text{elevation}}{\Delta \text{distance}} \times 100\%$$

Example: Point A at 0 m distance / 100 m elevation, point B at 100 m distance / 110 m elevation → gradient = 10%

### Sliding Window Parameters

| Parameter                    | Value   | Rationale                                         |
| ---------------------------- | ------- | ------------------------------------------------- |
| `CLIMB_START_GRADE`          | 3%      | Below 3% is not considered a climbing challenge   |
| `CLIMB_MIN_DISTANCE`         | 500 m   | Filters out short bumps                           |
| `DESCENT_THRESHOLD_GRADE`    | 0%      | Any downward segment can end a climb              |
| `DESCENT_THRESHOLD_DISTANCE` | 300 m   | Avoids false endings from brief downhill flats    |
| `MERGE_GAP_LIMIT`            | 2 000 m | Valleys shorter than this collapse into one climb |
| `FLAT_SPLIT_LENGTH`          | 400 m   | Flat sections longer than this split a climb      |
| `FLAT_SPLIT_GRADE`           | 2%      | Grade below which a mid-section counts as flat    |
| `TRIM_THRESHOLD`             | 1.5%    | Flat lead-in/tail removed below this grade        |

### Categorization Formula

`Score = distance (km) × avg grade (%) × 100` — ProCyclingStats standard

| Category | Min Score | Typical         |
| -------- | --------- | --------------- |
| HC       | 40 000    | 20+ km @ 5%+    |
| Cat 1    | 16 000    | 10–20 km @ 4–7% |
| Cat 2    | 8 000     | 5–10 km @ 3–6%  |
| Cat 3    | 3 000     | 2–5 km @ 3–5%   |
| Cat 4    | < 3 000   | < 2 km @ 3%+    |

Example: 2 km climb, 200 m gain → avg grade = 10% → score = 2 × 10 × 100 = **2 000 → Cat 4**
