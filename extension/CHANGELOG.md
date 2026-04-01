# Changelog

All notable changes to Mapy.cz Climb Analyzer are documented in this file.

## [0.4.1] - 2026-03-31 - UX Polish & Lifecycle Fixes

### Added

- **Info popup** (`popup.html` / `popup.css` / `popup.js`): toolbar icon now opens a dark-themed info panel with extension description, step-by-step usage guide, category scoring table, last-capture status dot, and a Buy Me a Coffee placeholder link
- **One-click analysis button**: clicking the injected *Climb Analyzer* sidebar button now silently triggers the Mapy.cz Export modal and confirms it automatically — no user interaction with the modal needed
- **Download suppression** (`gpx-interceptor-injected.js`): intercepts `HTMLAnchorElement.prototype.click` to swallow the blob download when triggered by the extension, preventing Downloads folder spam
- **Route lifecycle cleanup**: all captured GPX data and climb results are removed from `chrome.storage.local` when the route planner UI becomes invisible or the user navigates away — storage is never left stale

### Changed

- `manifest.json`: added `"default_popup": "popup.html"` and icon paths to the `action` block
- `isRoutePlannerActive()`: now additionally checks that `.route-actions` or `.route-modules` is present **and** visible (`offsetParent !== null`), not just the URL
- 150 ms poll: tracks a `_lastRoutePlannerVisible` flag — clears overlay and storage the moment the route-planner DOM disappears
- `onMutation()`: when route UI is not visible, actively removes injected button, panel, and map overlay rather than silently skipping
- `onRouteChange()`: consolidated into shared `clearRoutePlannerState()` helper (resets all in-memory state, removes DOM nodes, clears storage)
- Export modal handling: switched from 100 ms polling to a `MutationObserver` that fires before the first paint, hiding the modal with `opacity:0` so it is never seen by the user
- `findGPXExportButton()`: primary selector updated to `.icon-action[title="Export"] button` (confirmed live DOM); SVG class and text-content fallbacks kept

### Fixed

- Panel and map pins were left visible after the user closed or navigated away from the route planner without a full page load
- Stale climb result from a previous route could re-appear if the user re-opened the planner in the same tab
- Export modal briefly flashed on screen before being confirmed programmatically

## [0.4.0] - 2026-03-31 - Live Map Integration

### Added

- **Map overlay pins**: start (teardrop + climb number) and end (mountain + CAT badge) SVG pins rendered directly on the Mapy.cz tile canvas using Web Mercator math — no SMap API required
- **Sidebar panel**: climb analysis injected as a native DOM child of `.route-modules`, scrolls with the sidebar, never clipped
- **Full popup UI in sidebar**: route overview strip (total distance, climbing, max grade, climb count), per-climb cards with 6-stat grid, VAM / estimated time / Fiets index, SVG elevation chart
- **Hover chart expand**: hovering a compact elevation chart floats a 600×220 overlay extending into the map area for full readability
- **Real-time pan/zoom tracking**: 150 ms URL polling re-renders pins whenever Mapy.cz updates the `x`/`y`/`z` URL params
- **SPA resilience**: `pushState` hook + MutationObserver re-inject the panel if Mapy.cz removes it during navigation
- `map-inject.js` content script + `map-inject.css` added to manifest

### Changed

- `background.js` now returns `totalDistance` alongside `climbs` and caches it as `lastTotalDistance`
- GPX parser outputs `[distance, elevation, lat, lon]` — lat/lon preserved through `smoothElevationProfile` so `markerCoords`/`endCoords` are always populated
- `popupPorts` messaging simplified; `ROUTE_DETECTED` handler removed (unused)
- All debug `console.log` removed from background.js and map-inject.js; single `console.error` kept for climb detection failures

### Removed

- Dead `getSidebarLeftEdge()` function from map-inject.js
- Dead `injectMarkers()` wrapper from map-inject.js
- All `[Background]` / `[Climb Engine]` / `[Categorize]` / `[MapInject]` log spam

## [0.3.0] - 2026-03-31 - Cleanup & Refactor

### Added

- ARCHITECTURE.md with comprehensive system design documentation
- Enhanced popup display with climb position (start/end km)
- Elevation range display (start and end elevation) for each climb
- Max gradient display per climb (steepest 100m section)
- Persistent port connection from popup to background worker
- XHR blob response handling for GPX capture

### Changed

- **BREAKING**: Updated difficulty score formula from `distance × grade × 2` to `distance × grade × 100` (ProCyclingStats standard)
- **BREAKING**: Softened category thresholds:
  - Cat 3: ≥ 3,000 (was > 16,000)
  - Cat 2: ≥ 8,000 (was > 32,000)
  - Cat 1: ≥ 16,000 (was > 64,000)
  - HC: ≥ 40,000 (was > 80,000)
- Refactored GPX interceptor into two-layer architecture (page context + content script)
- Improved GPX capture reliability with both FETCH and XHR interception
- Better handling of blob vs. text responses
- Manifest.json version bumped to 0.3.0
- Removed "downloads" permission (not needed for GPX analysis)

### Fixed

- GPX interceptor not working on some routes (XHR blob response issue)
- Extension popup closing when clicking map (now maintains persistent connection)
- GPX capture failures with blob responseType
- Content script errors due to null document.head

### Removed

- **Removed unused file**: `content.js` (replaced by gpx-interceptor.js)
- **Removed unused file**: `map-overlay.js` (marker positioning feature abandoned)
- **Removed unused file**: `map-overlay.css` (styling for abandoned feature)
- **Removed unused file**: `README-GPX.md` (superseded by README.md)
- **Removed unused file**: Old `CHANGELOG-v0.2.md` (outdated)
- **Removed manifest declarations**:
  - Removed `downloads` permission
  - Removed `map-overlay.js` from content_scripts
- Dashboard UI overlay feature (wasn't working properly)

### Technical Details

- GPX capture now uses injected script pattern for reliable interception
- Content script properly relays GPX from page context to extension context
- Better error handling and logging throughout
- Cleaner, more maintainable codebase

## [0.2.1] - 2026-03-30 - Bug Fixes

### Fixed

- Script loading error: "Cannot read properties of null (reading 'appendChild')"
- Document.head null check before style injection in map-overlay.js
- Multiple script injection attempts
- Proper DOMContentLoaded handling for delayed script injection

### Added

- Better logging for map overlay debugging
- Distance-based marker positioning attempt
- Support for both random and percentage-based positioning

## [0.2.0] - 2026-03-15 - GPX-Based Approach

### Changed

- **BREAKING**: Switched from network interception to GPX file analysis
- Removed need for Mapy.cz API reverse-engineering
- Removed FRPC protocol decoding (proprietary format)
- Simplified to file upload paradigm

### Added

- GPX file upload interface in popup
- GP parser with Haversine distance calculation
- Offline processing capability
- SVG elevation profile visualization
- Gradient-based coloring system
- Climb difficulty categorization

### Removed

- Dashboard overlay injection
- Network request monitoring
- FRPC protocol handling

### Files Changed

- New: `gpx-parser.js`, `README-GPX.md`
- Modified: `manifest.json` (v0.1.0 → v0.2.0)
- Modified: `popup.html`, `popup.css`, `popup.js`
- Removed: FRPC protocol code

## [0.1.0] - 2026-02-28 - Initial Release

### Initial Features

- Network interception of Mapy.cz route endpoints
- Elevation data extraction from API responses
- Climb detection using gradient-based sliding window
- Dashboard overlay UI on Mapy.cz pages
- Difficulty categorization
- Gradient color visualization
- Popup display with climb details

### Architecture

- Content script for network monitoring
- Service worker for background processing
- Dashboard UI injection
- Climb detection algorithm

### Known Issues

- FRPC protocol decoding incomplete
- Overlay UI placement issues
- Network interception unreliable on some routes

---

## Migration Guides

### From v0.2.x to v0.3.0

1. **Difficulty Scores Changed**: Your 8km 5% climb:
   - Old formula: 8 × 5 × 2 = **80** (not scored)
   - New formula: 8 × 5 × 100 = **4,000** (Cat 3)

2. **Category Thresholds Changed**: Climbs may have different categories:
   - Recalculate difficulty using new formula
   - Use new category thresholds
   - Easier to hit Cat 3 and above (softer)

3. **UI Changes**:
   - New columns: Position, Elev Range
   - Max Grade display added
   - More detailed climb information

### From v0.1.0 to v0.2.0

- **User Impact**: Change from real-time map analysis to manual GPX export
- **Workflow**: Plan route → Export GPX → Upload to extension (vs. automatic detection)
- **Advantage**: Works offline, no network dependency

---

## Future Roadmap

### Planned Features

- [ ] Export climbs to CSV/JSON
- [ ] Strava segment integration
- [ ] Route comparison
- [ ] Elevation profile smoothing
- [ ] Grade distribution graphs
- [ ] Custom difficulty calculation
- [ ] Dark mode UI
- [ ] Settings panel

### Under Consideration

- Map marker integration (requires Mapy.com API documentation)
- Live tracking analysis
- Multiple GPX route comparison
- Cycling power estimation
- Weather integration
