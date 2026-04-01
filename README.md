# Mapy.cz Climb Analyzer - Chrome Extension

## 📋 Overview

A Chrome Extension that analyzes elevation data from Mapy.cz route planning and automatically detects and categorizes climbs. Each climb is color-coded by gradient intensity, displayed with interactive charts, and categorized using the standard cycling difficulty formula.

**Status**: ✅ Complete & Functional (v0.5.5)
**Latest**: Modern charts, interactive hover tooltips, and map sync for professional UX

## 🚀 Quick Start (3 Steps)

### 1. Load Extension

```powershell
# On Windows PowerShell:
cd c:\Repo\climb\extension
# Then in Chrome:
# - Go to chrome://extensions/
# - Enable "Developer mode" (top right)
# - Click "Load unpacked"
# - Select the extension/ folder
```

### 2. Create a Route

- Visit https://mapy.cz/zakladni
- Click "Plánování trasy" to start route planning
- Draw waypoints on the map to create a route

### 3. Export & Analyze

- Click "Export Route" on the Mapy.cz toolbar
- Select GPX format and confirm the export
- The extension automatically captures the GPX
- Click the extension icon in the Chrome toolbar to view detected climbs

## 📁 Project Structure

```
c:\Users\...\climb/
│
├── 📄 README.md               ← You are here
├── 📄 SUMMARY.md              ← Project overview & reference
├── 📄 SETUP.md                ← Installation & usage guide
├── 📄 TECHNICAL.md            ← Algorithm & architecture details
│
└── 📁 extension/              ← Chrome Extension
    ├── manifest.json          ← Configuration (v3)
    ├── gpx-interceptor.js     ← Content script: injects interceptor
    ├── gpx-interceptor-injected.js ← Page-level fetch/XHR interceptor
    ├── gpx-parser.js          ← GPX XML parser
    ├── background.js          ← Climb detection algorithm
    ├── popup.html/.css/.js    ← Popup UI
    ├── ARCHITECTURE.md        ← Extension architecture details
    │
    └── 📁 images/
        ├── icon-16.svg        ← Toolbar icon
        ├── icon-48.svg        ← Preferences icon
        └── icon-128.svg       ← Web store icon
```

## 📖 Documentation

| Document                                       | Purpose                                         |
| ---------------------------------------------- | ----------------------------------------------- |
| **[SUMMARY.md](SUMMARY.md)**                   | Project overview, features, categories, testing |
| **[SETUP.md](SETUP.md)**                       | Installation, usage, troubleshooting, debugging |
| **[TECHNICAL.md](TECHNICAL.md)**               | Algorithm details, architecture, implementation |
| **[extension/README.md](extension/README.md)** | Extension features, permissions, configuration  |

👉 **Start with**: Read [SETUP.md](SETUP.md) for installation instructions

## ⚡ Key Features

- ✅ **Auto-Capture GPX**: Automatically intercepts GPX exports when you click "Export Route"
- ✅ **Intelligent Climb Detection**: Sliding window algorithm identifies climb regions
- ✅ **Smart Categorization**: Uses ProCyclingStats formula (HC, Cat 1-4)
- ✅ **Gradient Visualization**: 5-tier color coding:
  - 🟢 Green (0-3%)
  - 🟡 Yellow (3-6%)
  - 🟠 Orange (6-9%)
  - 🔴 Red (9-12%)
  - 🔴 Dark Red (12%+)
- ✅ **SVG Elevation Charts**: Per-climb gradient-colored profile
- ✅ **Popup Interface**: Detailed climb stats in extension popup

## ✨ What's New in v0.5.5 — Visual Refinement & UX Polish

- **🎨 SVG Linear Gradients**: Professional area-chart style with color fades to bottom
- **📈 Bezier Curve Fitting**: Smooth cubic curves instead of jagged steps
- **📐 Vertical Auto-Scaling**: Y-axis per-climb for maximum clarity (min -5m to max +10m)
- **🔍 Hover Scanner**: Real-time interactive tooltip showing grade, distance, elevation
- **🗺️ Map Sync**: Ghost marker on Mapy.cz map syncs with chart hover
- **⏱️ Instant Updates**: Tooltip refreshes in <100ms for seamless interaction
- **🚀 Pro-Grade UI**: Transition from functional tool to SaaS-quality interface

### Previous Release (v0.5.1 — "Action Only" & Smoothing Patch)

- **📍 Point Resampling**: Eliminates micro-jitter from GPS data to remove elevation chart "stripes"
- **🏔️ Smart Climb Start**: Climbs now visually start only at >3% gradient (removes flat approach ramps)
- **🔝 Peak Detection**: Climb profiles end exactly at the summit, no trailing flat sections
- **🟢 Anti-Green Splitting**: Automatically splits climbs with large flat sections (>400m @ <2%) to avoid UI dead zones
- **🧹 Savitzky-Golay Filter**: Optional polynomial smoothing available for cleaner curves
- **📈 Gradient Capping**: Display layer can safely cap gradient extremes (prevents "40% glitch")
- **✅ Merge Safe**: All changes happen outside merge logic — 100% backward compatible

### Previous Features (v0.5.0)

- **🔧 Adaptive Smoothing**: Algorithm automatically adjusts elevation filtering (50-250m window) based on terrain steepness
- **🔊 Noise Filtering**: Detects & removes unrealistic elevation spikes (>12% anomalies) from DEM data
- **🚷 Elevation Gate**: Minimum 30m elevation gain filter prevents false climbs on flat roads
- **🔗 Smart Merge**: Nearby climbs separated by small valleys are intelligently merged
- **⏳ Loading Spinner**: Visual feedback when analyzing routes
- **🔄 Retry Button**: Re-analyze routes that detected no climbs
- **📊 Route Stats**: Climb popup now shows count & total distance
- **💾 Storage Versioning**: Graceful cache migration for future updates

## 🎯 Climb Categories

The extension uses the standard cycling categorization formula:

$$\text{Difficulty Score} = \text{Distance(km)} \times \text{Grade(\%)} \times 100$$

| Category | Score     | Typical       | Color     |
| -------- | --------- | ------------- | --------- |
| HC       | ≥ 40,000  | 20+ km @ 5%   | 🔴 Red    |
| Cat 1    | ≥ 16,000  | 16 km @ 4%    | 🟠 Orange |
| Cat 2    | ≥ 8,000   | 10 km @ 4%    | 🟡 Yellow |
| Cat 3    | ≥ 3,000   | 5 km @ 3.5%   | 🟡 Yellow |
| Cat 4    | < 3,000   | 2 km @ 3.5%   | ⚪ Gray   |

## 🛠️ Technical Stack

- **Language**: JavaScript (ES6+)
- **Platform**: Chrome Extension Manifest V3
- **APIs Used**:
  - Chrome Extension API (storage, messaging, ports)
  - Fetch/XHR interception via page-context injection
  - DOMParser for GPX XML
- **Data Format**: GPX/XML → elevation arrays
- **No external dependencies** - Pure JavaScript

## 🔧 Installation

### Requirements

- Chrome 88+ (or Chromium-based browser)
- The extension folder with all files
- Basic understand of how to load unpacked extensions

### Steps

1. **Prepare Extension**
   - All files are in `c:\Repo\climb\extension\`
   - Note: SVG icons included; convert to PNG for full compatibility

2. **Load in Chrome**

   ```
   1. Open chrome://extensions/
   2. Toggle "Developer mode" (top right)
   3. Click "Load unpacked"
   4. Select the extension/ folder
   ```

3. **Verify Installation**
   - Extension appears in toolbar
   - No errors in `chrome://extensions/`

For detailed installation guide, see [SETUP.md](SETUP.md)

## 📊 How It Works

### Phase 1: Data Interception

- Content script monkey-patches `fetch()` and `XMLHttpRequest`
- Intercepts all API calls from Mapy.cz
- Extracts elevation profile arrays

### Phase 2: Climb Detection

- Calculates gradient for each elevation segment
- Identifies climb regions using sliding window algorithm
- Filters for minimum 500m climb length with >3% average gradient

### Phase 3: Categorization

- Calculates climb score using standard formula
- Assigns category based on difficulty score
- Collects climb statistics

### Phase 4: Display

- Injects dashboard panel into Mapy.cz page
- Sends data to popup for detailed view
- Renders color-coded elevation profiles

## 🧪 Testing

### Test with a Simple Route

1. Go to https://mapy.cz/zakladni
2. Click "Plánování trasy"
3. Create a simple route with 1-2 climbs
4. Watch for:
   - Dashboard panel appears (top-right)
   - Climbs are detected and categorized
   - Gradient bars show color coding
   - Click extension icon to see popup

### Troubleshooting

**Extension doesn't load?**

- Check `chrome://extensions/` for errors
- Verify all files exist in the extension folder
- Check for JSON syntax errors in manifest.json

**No climbs detected?**

- Open DevTools (`F12`) → Console
- Look for `[Climb Analyzer]` log messages
- Create a route with obvious climbs (mountains, hills)
- Check Network tab for API calls

See [SETUP.md](SETUP.md) for detailed troubleshooting guide.

## 💻 For Developers

### How to Modify

1. **Adjust Climb Detection Thresholds**
   - Edit `background.js` line ~80-85
   - Change `CLIMB_START_GRADE`, `CLIMB_START_DISTANCE`, etc.

2. **Change Colors**
   - Edit `popup.css` `.climb-item.*` classes

3. **Add Features**
   - Extend `popup.js` for new UI elements
   - Add message types in `background.js`
   - Use Chrome Extension API docs

### Code Quality

- Fully commented (130+ inline comments)
- Clear function organization
- Separation of concerns (interception → processing → display)
- Error handling for edge cases

## 📝 Implementation Reference

For detailed technical information:

- **Algorithm Details**: See [TECHNICAL.md](TECHNICAL.md)
- **Code Comments**: See source files (heavily documented)
- **API Usage**: See Chrome Extension API sections in comments

## 🚨 Known Limitations

1. **API Compatibility**: Depends on Mapy.cz API structure (may need updates)
2. **Elevation Data**: Limited by accuracy of elevation data provided by Mapy.cz
3. **Performance**: May slow on routes with 1000+ elevation points
4. **Browser Support**: Chrome/Chromium only (Firefox/Safari compatible versions not included)

## 🎁 What Happens When You Export a Route

1. ✅ You click "Export Route" → GPX on Mapy.cz
2. ✅ Extension intercepts the GPX download
3. ✅ Click the extension icon in the toolbar
4. ✅ Climb detection runs (< 1 second)
5. ✅ Each climb shows:
   - Category (HC, 1-4)
   - Distance and elevation gain
   - Average and maximum grade
   - Difficulty score
   - SVG elevation profile

## 📦 File Descriptions

- **manifest.json** - Extension configuration and permissions
- **gpx-interceptor.js** - Content script; injects page-level interceptor
- **gpx-interceptor-injected.js** - Page-level fetch/XHR GPX interceptor
- **gpx-parser.js** - GPX XML parser with Haversine distance calculation
- **background.js** - Core climb detection algorithm
- **popup.html** - Extension popup UI structure
- **popup.css** - Styling and layout (dark mode)
- **popup.js** - Popup logic and event handling

## 🔐 Permissions

The extension requests minimal necessary permissions:

- `storage` - Read/write captured GPX in chrome.storage.local
- `host_permissions` - Access mapy.cz and mapy.com domains only

## 📞 Support

**Having issues?** Follow this order:

1. Check [SETUP.md](SETUP.md) troubleshooting section
2. Review [TECHNICAL.md](TECHNICAL.md) for algorithm details
3. Check DevTools console for error messages
4. Review source code comments

## 📈 Future Enhancements (Not Implemented)

- [ ] Interactive elevation profile chart
- [ ] Click-to-focus climb segments on map
- [ ] Export as GPX/TCX
- [ ] Settings panel for customization
- [ ] Route history & saved routes
- [ ] Compare with famous climbs
- [ ] Strava integration
- [ ] Web version / standalone app

## ✅ Completed Checklist

- [x] Route detection from Mapy.cz
- [x] Elevation data interception
- [x] Gradient calculation
- [x] Climb region identification
- [x] Climb categorization (standard formula)
- [x] Color-based gradient visualization
- [x] Dashboard injection
- [x] Popup interface
- [x] Documentation (4 guides)
- [x] Code comments
- [x] Error handling

## 📄 License

MIT License - Free to use, modify, and distribute

---

## Next Steps

1. **Install**: Follow [SETUP.md](SETUP.md)
2. **Test**: Create a route on Mapy.cz
3. **Customize**: Edit colors, thresholds in source files
4. **Extend**: Add features as needed

---

**Version**: 0.1.0  
**Last Updated**: March 2025  
**Status**: ✅ Fully Functional & Ready to Test  
**Chrome Version**: 88+

**Questions?** Refer to the comprehensive documentation in SUMMARY.md, SETUP.md, and TECHNICAL.md
