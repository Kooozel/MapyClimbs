# Mapy.cz Climb Analyzer - Setup & Installation Guide

## Quick Start

### Step 1: Prepare the Extension

The extension is in the `extension/` directory with all necessary files:

```
extension/
├── manifest.json                # Extension configuration (Chrome v3)
├── gpx-interceptor.js           # Content script: injects the interceptor
├── gpx-interceptor-injected.js  # Page-level fetch/XHR interceptor
├── gpx-parser.js                # GPX XML parser
├── background.js                # Service worker: processes climbs
├── popup.html                   # Extension popup interface
├── popup.css                    # Popup styling
├── popup.js                     # Popup logic
├── ARCHITECTURE.md              # Technical architecture details
└── images/                      # Extension icons (SVG format)
    ├── icon-16.svg
    ├── icon-48.svg
    └── icon-128.svg
```

### Step 2: Add Extension to Chrome

1. Open Chrome and navigate to `chrome://extensions/`
2. Toggle **"Developer mode"** (top right corner)
3. Click **"Load unpacked"**
4. Select the `extension/` folder
5. The extension should now appear in your Chrome extensions list

### Step 3: Export a Route from Mapy.cz

1. Visit https://mapy.cz or https://mapy.com
2. Plan a cycling route using the route planner
3. Click **"Export Route"** in the toolbar
4. Select the **GPX** format and confirm the export
5. The extension automatically captures the GPX file

### Step 4: View Results

**In Extension Popup:**

- Click the extension icon in the Chrome toolbar
- Detected climbs are listed automatically
- Each climb shows:
  - Category (HC, 1-4)
  - Distance (km)
  - Elevation gain (m)
  - Average and maximum grade (%)
  - Difficulty score
  - SVG elevation profile with gradient color-coding

## Icon Setup

The extension uses SVG icons which are already configured in `manifest.json`. Chrome may display a warning about SVG icons but the extension will work correctly. To eliminate the warning, convert the SVG files in `images/` to PNG using any image converter.

## How to Use

### Creating a Route on Mapy.cz

1. Go to https://mapy.cz/zakladni
2. Enable route planning:
   - Click the route icon in the toolbar, or
   - Search for "mapy.cz/zakladni?planovani-trasy" in the URL
3. Click on the map to add waypoints
4. The route will be created and elevation data loaded
5. The extension automatically analyzes and displays climbs

### Understanding the Results

**Climb Categories** (ProCyclingStats formula: `distance(km) × avgGrade(%) × 100`):

| Category | Score   | Typical Use                  |
| -------- | ------- | ---------------------------- |
| HC       | 40,000+ | Long, brutal mountain climbs |
| Cat 1    | 16,000+ | Major climbing sections      |
| Cat 2    | 8,000+  | Significant climbs           |
| Cat 3    | 3,000+  | Moderate climbs              |
| Cat 4    | < 3,000 | Minor climbs                 |

**Gradient Colors**:

```
🟢 Green:   0-3%    Easy
🟡 Yellow:  3-6%    Moderate
🟠 Orange:  6-9%    Hard
🔴 Red:     9-12%   Very Hard
🔴 Dark Red: 12%+   Extreme
```

### Troubleshooting

#### Extension doesn't capture GPX

1. **Check console for errors:**
   - Open DevTools (F12) on the Mapy.cz page
   - Go to Console tab
   - Look for `[GPX Interceptor]` messages
   - Check for red error messages

2. **Verify content script is running:**
   - Open Chrome DevTools
   - Go to Application → Extensions
   - Find "Mapy.cz Climb Analyzer"
   - Check if content script is active

3. **Check GPX export interception:**
   - Open Network tab in DevTools
   - Click "Export Route" → GPX on Mapy.cz
   - Look for a request to `/api/tplannerexport?...export=gpx`
   - The extension intercepts this response

4. **Reload extension:**
   - Go to `chrome://extensions/`
   - Find "Mapy.cz Climb Analyzer"
   - Click the reload icon
   - Refresh the Mapy.cz page

#### No climbs detected

1. **Flat routes:** Not all routes have climbs (e.g., flat city routes)
2. **Data format:** Mapy.cz API response format may differ
3. **Thresholds:** Climb detection thresholds may need adjustment

   Edit `background.js` to lower thresholds:

   ```javascript
   const CLIMB_START_GRADE = 2; // Lower from 3%
   const CLIMB_START_DISTANCE = 300; // Lower from 500m
   ```

#### Dashboard doesn't appear on page

1. Refresh the Mapy.cz page
2. Check if route data is being intercepted (Network tab)
3. Look for JavaScript errors in DevTools Console
4. Try creating a new route from scratch

## Development & Debugging

### View Extension Logs

**Content Script Logs:**

- Open DevTools (F12) on Mapy.cz page
- Check Console tab for `[GPX Interceptor]` messages

**Background Service Worker Logs:**

1. Go to `chrome://extensions/`
2. Find "Mapy.cz Climb Analyzer"
3. Click "Service Worker" link
4. View logs in the opened DevTools

**Popup Logs:**

- Right-click extension icon → "Inspect popup"
- Check Console in the popup DevTools window

### Modifying the Extension

After making changes:

1. Go to `chrome://extensions/`
2. Click the reload ♻️ icon for "Mapy.cz Climb Analyzer"
3. Refresh the Mapy.cz page to test

### Testing with a Local GPX File

You can test without exporting from Mapy.cz by using the file upload in the popup:

1. Click the extension icon
2. Use the file upload input to select any `.gpx` file
3. The extension will parse and analyze it directly

## File Descriptions

### manifest.json

Chrome Extension configuration. Defines extension metadata, permissions, content scripts, background service worker, popup, and icons.

### gpx-interceptor.js (Content script)

- Injected into Mapy.cz pages at document start
- Injects `gpx-interceptor-injected.js` into the page context
- Listens for GPX data via `postMessage`
- Stores GPX in `chrome.storage.local` and notifies background worker

### gpx-interceptor-injected.js (Page-level interceptor)

- Runs in page context (not extension sandbox)
- Monkey-patches `fetch()` and `XMLHttpRequest`
- Detects GPX export requests to `/api/tplannerexport`
- Posts captured GPX content to the content script

### gpx-parser.js (GPX parser)

- Parses GPX XML format
- Extracts track points with elevation
- Calculates distances using the Haversine formula
- Returns `[distance, elevation]` pairs

### background.js (Climb detection algorithm)

- Receives elevation data from popup
- Calculates gradients between points
- Detects climb regions using sliding window algorithm
- Categorizes climbs by ProCyclingStats difficulty score
- Returns results to popup

### popup.html / popup.css / popup.js

- Extension popup UI shown when clicking extension icon
- Displays detected climbs with stats and SVG elevation charts
- Supports both auto-captured GPX and manual file upload

## Next Steps

1. **Add custom styling**: Modify `popup.css` climb-item color definitions
2. **Implement full chart**: Integrate Chart.js for interactive profiles
3. **Add settings**: Create options page for threshold customization
4. **Extend features**: Add search, filtering, export functionality
5. **Optimize performance**: Cache elevation data, improve algorithms
6. **Add animations**: Smooth transitions and loading indicators

## Support & Issues

If the extension isn't working:

1. Check the troubleshooting section above
2. Review console logs in DevTools
3. Verify Mapy.cz hasn't changed its GPX export URL structure
4. Check Network tab for requests to `tplannerexport` with `export=gpx`

---

**Last Updated**: March 2026  
**Version**: 0.3.0  
**Chrome Version Required**: 88+
