# Mapy.cz Climb Analyzer — Chrome Extension

Automatically captures GPX route exports from Mapy.cz, detects climbs, and displays analysis directly inside the route-planner sidebar with map pins.

**Version**: 0.4.0 | **Status**: Production Ready

## Features

- **Auto-Capture**: Intercepts GPX exports (no manual upload needed on Mapy.cz)
- **Live Map Pins**: Start (numbered teardrop) and end (mountain + CAT badge) pins rendered on the map, following every pan and zoom
- **Sidebar Panel**: Full climb analysis injected natively into the Mapy.cz route-planner sidebar — route overview strip, per-climb stat cards, VAM / time / Fiets index, SVG elevation profiles
- **Hover Chart Expand**: Hover any elevation chart to see a 600×220 floating view extending into the map
- **Professional Scoring**: ProCyclingStats formula — `distance(km) × avg_grade(%) × 100`
- **Smart Detection**: Distance-weighted smoothing, valley merging, flat-end trimming
- **Gradient Colors**: Green < 3% · Yellow 3–6% · Orange 6–9% · Red 9–12% · Dark Red > 12%
- **Manual Upload**: Also works as a standalone popup for any GPX file

## Installation

1. Open `chrome://extensions/` and enable **Developer mode**
2. Click **Load unpacked** → select the `extension/` directory
3. Navigate to [mapy.cz](https://mapy.cz) and open the route planner

## Usage

**Auto mode (Mapy.cz route planner)**
1. Plan a route on Mapy.cz
2. Click *Export Route → GPX → Export* — the extension captures it automatically
3. The sidebar panel and map pins appear immediately
4. Hover any elevation chart to expand it

**Manual mode**
1. Click the extension icon in the toolbar
2. Upload any GPX file

## Project Structure

```
extension/
├── manifest.json                # MV3 manifest
├── background.js                # Service worker: climb detection engine
├── gpx-interceptor.js           # Content script: injects page-level interceptor
├── gpx-interceptor-injected.js  # Page-context fetch/XHR interceptor
├── gpx-parser.js                # GPX XML parser (Haversine, outputs lat/lon)
├── map-inject.js                # Content script: sidebar panel + map pins
├── map-inject.css               # Styles for injected panel
├── popup.html / popup.css / popup.js  # Standalone popup UI
└── images/                      # Icons (16, 48, 128 px)
```

## How It Works

### GPX Capture
`gpx-interceptor-injected.js` monkey-patches `fetch` and `XMLHttpRequest` in page context. When a request matching `tplannerexport` + `export=gpx` completes, it posts the GPX string to the content script via `postMessage`. The content script stores it in `chrome.storage.local` and notifies all connected popups.

### GPX Parsing
`gpx-parser.js` parses the XML with `DOMParser`, computes cumulative distances via the Haversine formula, and returns `[[distance, elevation, lat, lon], ...]` tuples.

### Climb Detection (`background.js`)
1. **Smooth** — 150 m rolling average removes GPS/DEM noise
2. **Gradients** — per-segment `(Δelev / Δdist) × 100`
3. **Identify** — sliding-window: opens at ≥ 2%, closes after 150 m of ≤ −1%
4. **Merge** — short valleys (≤ 2 km gap, ≤ 15% combined gain drop) collapse into one climb
5. **Trim** — flat tails (< 1.5%) removed from start and end
6. **Categorize** — ProCyclingStats score → HC / Cat 1–4

### Map Overlay (`map-inject.js`)
Pins are absolutely positioned over a `position:fixed` div sized to the largest `<canvas>` (the tile renderer). Lat/lon → pixel conversion uses standard Web Mercator with center and zoom read from the URL `x`/`y`/`z` params. A 150 ms `setInterval` re-renders on every pan or zoom.

### Sidebar Panel
Appended as a native child of `.route-modules` so it scrolls with the sidebar and is never clipped. A `MutationObserver` re-injects it if Mapy.cz removes it during SPA navigation.

## Climb Categorization

`difficulty = distance_km × avg_grade_pct × 100` (ProCyclingStats)

| Category | Score     |
|----------|-----------|
| HC       | ≥ 40 000  |
| Cat 1    | ≥ 16 000  |
| Cat 2    | ≥ 8 000   |
| Cat 3    | ≥ 3 000   |
| Cat 4    | < 3 000   |

## Browser Compatibility

Chrome 88+ · Edge 88+ · Brave

## ✨ Features

- **Auto-Capture GPX**: Automatically intercepts GPX exports from Mapy.cz when you click "Export Route"
- **Climb Detection**: Identifies climbs based on gradient thresholds (>3% for 500m+)
- **Professional Difficulty Scoring**: Uses ProCyclingStats formula: `distance(km) × avgGrade(%) × 100`
- **Smart Categorization**:
  - Cat 4: < 3,000
  - Cat 3: 3,000 - 8,000
  - Cat 2: 8,000 - 16,000
  - Cat 1: 16,000 - 40,000
  - HC: > 40,000
- **Gradient Visualization**: Color-coded elevation profiles
  - 🟢 Green: < 3%
  - 🟡 Yellow: 3-6%
  - 🟠 Orange: 6-9%
  - 🔴 Red: 9-12%
  - ⚫ Dark Red: > 12%

## Installation

### 1. Clone/Download the Extension

```bash
cd extension
```

### 2. Load into Chrome

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (top right toggle)
3. Click "Load unpacked"
4. Select the `extension` directory

### 3. Usage

1. Go to [Mapy.cz](https://mapy.cz/zakladni) or [Mapy.com](https://mapy.com)
2. Plan a route on the map
3. Click "Export Route" → Select "GPX" format → Export
4. Extension automatically captures the GPX
5. Click the extension icon in your toolbar
6. View detected climbs with full analysis!

## Project Structure

```
extension/
├── manifest.json                # Chrome Extension manifest (v3)
├── gpx-interceptor.js           # Content script: injects interceptor
├── gpx-interceptor-injected.js  # Page-level fetch/XHR interceptor
├── gpx-parser.js                # GPX XML parser (Haversine distances)
├── background.js                # Service worker: climb detection
├── popup.html                   # Extension popup UI
├── popup.css                    # Popup styling
├── popup.js                     # Popup logic
├── ARCHITECTURE.md             # Architecture documentation
└── images/                      # Extension icons (16, 48, 128px)
```

## How It Works

### 1. GPX Capture (gpx-interceptor.js + gpx-interceptor-injected.js)

- `gpx-interceptor.js` is injected as a content script at `document_start`
- It injects `gpx-interceptor-injected.js` into the page context
- The injected script monkey-patches `fetch()` and `XMLHttpRequest`
- When a GPX export is detected (URL contains `tplannerexport` and `export=gpx`), the response is captured and sent via `postMessage`
- The content script receives the GPX, stores it in `chrome.storage.local`, and notifies the popup

### 2. GPX Parsing (gpx-parser.js)

- Parses GPX XML using `DOMParser`
- Extracts track points with latitude, longitude, and elevation
- Calculates cumulative distances with the Haversine formula
- Returns an elevation profile as `[[distance, elevation], ...]` pairs

### 3. Climb Detection (background.js)

- Calculates gradient for each elevation segment
- Uses a sliding window algorithm to identify climb regions:
  - Climb starts when gradient ≥ 3% for 500m+
  - Climb ends when gradient < 0% for 300m+
- Trims flat sections (≤ 4%) from start and end of each climb
- Categorizes using the ProCyclingStats formula: `Score = distance(km) × grade(%) × 100`

### 4. Popup Display (popup.js)

- Reads captured GPX from `chrome.storage.local`
- Sends elevation data to background for processing
- Renders climb list with SVG elevation profiles
- Also supports manual GPX file upload

## Climb Categorization

Formula: `difficulty = distance(km) × average_grade(%) × 100` (ProCyclingStats)

| Category | Difficulty Score | Color           |
| -------- | ---------------- | --------------- |
| HC       | ≥ 40,000         | 🔴 Red          |
| Cat 1    | ≥ 16,000         | 🟠 Orange       |
| Cat 2    | ≥ 8,000          | 🟡 Yellow       |
| Cat 3    | ≥ 3,000          | 🟡 Light Yellow |
| Cat 4    | < 3,000          | ⚪ Gray         |

## Configuration

Edit `background.js` to adjust climb detection parameters:

```javascript
const CLIMB_START_GRADE = 3; // Gradient threshold to start climb (%)
const CLIMB_START_DISTANCE = 500; // Minimum climb length (meters)
const DESCENT_THRESHOLD_GRADE = 0; // Gradient threshold to end climb (%)
const DESCENT_THRESHOLD_DISTANCE = 300; // Minimum descent to end climb (meters)
```

Edit `popup.css` to customize colors:

```css
.climb-item.hc {
  border-left-color: #cc0000;
}
.climb-item.cat1 {
  border-left-color: #ff6600;
}
/* etc. */
```

## Technical Details

### Permissions (manifest.json)

- `storage`: Read/write `chrome.storage.local` for captured GPX
- Host permissions for `mapy.cz/*` and `mapy.com/*`

### Message Passing

- **Content → Background**: `GPX_CAPTURED` - notify of captured GPX
- **Popup → Background**: `PROCESS_CLIMBS` - send elevation data for analysis
- **Background → Popup**: port message `GPX_CAPTURED` - notify popup of new data

## Future Enhancements

- [ ] Full elevation profile chart with interactive tooltips
- [ ] Export climbs as GPX/strava format
- [ ] Compare with historical climbing data
- [ ] Difficulty predictions based on rider fitness level
- [ ] Integration with Strava API for performance metrics
- [ ] Settings panel for threshold customization
- [ ] Dark/light mode toggle

## Browser Compatibility

- Chrome 88+
- Edge 88+
- Brave Browser
- Other Chromium-based browsers

## Notes

- Mapy.cz API may change; monitor XHR/Fetch in DevTools if data detection fails
- Some routes may not have elevation data (flat regions, indoor)
- Gradient calculation depends on accuracy of the route elevation data
- For best results, use high-resolution route planning mode

## Debugging

1. Open Chrome DevTools (`F12`) on a Mapy.cz page
2. Console tab - look for `[GPX Interceptor]` and `[Popup]` logs
3. Go to `chrome://extensions/` → "Mapy.cz Climb Analyzer" → click **Service worker** to view background logs
4. Right-click the extension icon → **Inspect popup** to debug popup JS

## License

MIT License - Feel free to modify and distribute
