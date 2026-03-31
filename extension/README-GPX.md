# Mapy.cz Climb Analyzer - Chrome Extension (v0.3.0)

## 📋 Overview

A Chrome Extension that analyzes **GPX files** exported from Mapy.cz and automatically detects climbs with gradient-based categorization. Upload a GPX file and get instant climb analysis with color-coded gradient visualization.

**Version**: 0.3.0  
**Status**: ✅ Ready to Use

## ⚡ Quick Start

### 1. Load Extension

```
1. Open chrome://extensions/
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select the extension/ folder
```

### 2. Export Route from Mapy.cz

```
1. Go to https://mapy.cz or https://mapy.com
2. Plan your route on the map
3. Click "Export" or "Download" → select "GPX" format
4. Save the .gpx file
```

### 3. Analyze in Extension

```
1. Click extension icon in toolbar
2. Click "Upload GPX File" or use the file selector
3. Select your exported GPX file
4. Results appear instantly!
```

## 🎯 What You Get

For each detected climb:

- **Category**: HC, Cat 1-4 (based on difficulty score)
- **Distance**: Length of the climb in km
- **Elevation**: Total elevation gain in meters
- **Average Grade**: Steepness percentage
- **Difficulty Score**: Standard cycling formula
- **Gradient Profile**: Color-coded bars showing gradient intensity

## 📊 Gradient Colors

| Grade | Color       | Meaning            |
| ----- | ----------- | ------------------ |
| < 3%  | 🟢 Green    | Easy flats         |
| 3-6%  | 🟡 Yellow   | Easy climbing      |
| 6-9%  | 🟠 Orange   | Moderate climbing  |
| 9-12% | 🔴 Red      | Hard climbing      |
| > 12% | 🔴 Dark Red | Very hard climbing |

## 🎯 Climb Categories

Formula: `Score = Distance(km) × Grade(%) × 100` (ProCyclingStats)

| Category | Score   | Example    |
| -------- | ------- | ---------- |
| HC       | 40,000+ | 20km @ 5%  |
| Cat 1    | 16,000+ | 16km @ 4%  |
| Cat 2    | 8,000+  | 10km @ 4%  |
| Cat 3    | 3,000+  | 5km @ 3.5% |
| Cat 4    | < 3,000 | 2km @ 3.5% |

## 📁 Project Structure

```
extension/
├── manifest.json                # v3 configuration
├── background.js                # Climb detection algorithm
├── gpx-parser.js                # GPX file parsing & coordinate math
├── gpx-interceptor.js           # Content script (auto-capture)
├── gpx-interceptor-injected.js  # Page-level fetch/XHR interceptor
├── popup.html                   # UI for file upload & results
├── popup.css                    # Styling
├── popup.js                     # File handling & analysis
└── images/                      # Icons
```

## 🔧 How It Works

### Step 1: Parse GPX

- Reads GPX XML file
- Extracts track points with coordinates and elevation
- Validates data format

### Step 2: Calculate Distance

- Uses **Haversine formula** to calculate distance between coordinate pairs
- Builds cumulative distance array
- Creates elevation profile: `[[distance, elevation], ...]`

### Step 3: Detect Climbs

- **Sliding window algorithm** identifies climb regions
- Climb starts when: gradient > 3% for 500m+
- Climb ends when: gradient < 0% for 300m+
- Filters out short bumps and noise

### Step 4: Categorize

- Calculates climb score using standard formula
- Assigns category (HC, 1-4)
- Displays with gradient visualization

## 📝 GPX File Format

The extension expects standard GPX files with elevation data:

```xml
<?xml version="1.0"?>
<gpx version="1.1">
  <trk>
    <trkseg>
      <trkpt lat="49.5975698" lon="18.3341783">
        <ele>280.5</ele>
      </trkpt>
      <trkpt lat="49.5980652" lon="18.3360512">
        <ele>285.3</ele>
      </trkpt>
      <!-- More points... -->
    </trkseg>
  </trk>
</gpx>
```

Supports multiple GPX namespace versions (1.0, 1.1).

## ✨ Features

- ✅ GPX file upload
- ✅ Automatic climb detection
- ✅ Color-coded gradient visualization
- ✅ Standard climb categorization
- ✅ Route statistics (total distance, elevation range)
- ✅ Mini elevation profiles per climb
- ✅ Dark mode UI
- ✅ No external dependencies

## 🚀 Usage Examples

### Example 1: Simple Hill

**Route**: 3km, 150m elevation

```
Climb 1: Cat 4 (8,800 pts)
  Distance: 3.0 km
  Elevation: +150 m
  Avg Grade: 5.0%
  Profile: [█green █yellow █yellow █...]
```

### Example 2: Alpine Route

**Route**: 50km with multiple climbs

```
Climb 1: Cat 4 (12,000 pts)
  Distance: 2.5 km, +200m, 8.0%

Climb 2: Cat 2 (35,000 pts)
  Distance: 10 km, +550m, 5.5%

Climb 3: Cat 1 (64,500 pts)
  Distance: 18 km, +850m, 4.7%
```

## 🛠️ Customization

### Adjust Climb Thresholds

Edit `background.js`:

```javascript
const CLIMB_START_GRADE = 2; // Was 3% (easier climbs)
const CLIMB_START_DISTANCE = 300; // Was 500m (shorter climbs)
const DESCENT_THRESHOLD_DISTANCE = 200; // Was 300m
```

### Change Colors

Edit `popup.css`:

```css
.climb-item.hc {
  border-left-color: #ff0000;
}
.climb-item.cat1 {
  border-left-color: #ff6600;
}
.climb-item.cat2 {
  border-left-color: #ffaa00;
}
```

## ⚠️ Troubleshooting

### "Invalid GPX file" Error

- Ensure file is valid XML
- Check that it contains `<trkpt>` elements
- Verify elevation data (`<ele>` tags) is present
- Mapy.cz exports include elevation by default

### No climbs detected

- Route may be too flat (try a mountainous route)
- Elevation data resolution may be low
- Try adjusting thresholds in `background.js`

### File won't upload

- Must be `.gpx` extension
- File should be UTF-8 encoded
- Try opening file in text editor to verify XML format

### Incorrect climb categories

- Categories depend on accuracy of GPX elevation data
- Different GPX sources have different resolution
- Verify elevation range is reasonable (not all 1000m!)

## 📊 Technical Details

### Haversine Formula

Used to calculate great-circle distance between coordinates:

```
R = 6371000 meters (Earth radius)
a = sin²(Δφ/2) + cos φ1 × cos φ2 × sin²(Δλ/2)
c = 2 × atan2(√a, √(1−a))
distance = R × c
```

### Climb Detection Algorithm

```
for each segment in elevation profile:
  if gradient >= 3% and not in climb:
    start new climb
  else if in climb:
    if gradient < 0% for 300m+:
      end climb
    else:
      continue climb

return list of detected climbs
```

### Categorization Formula

```
difficulty = distance_km × avg_grade_percent × 100  (ProCyclingStats)

if difficulty >= 40000:
  category = "HC"
else if difficulty >= 16000:
  category = "1"
else if difficulty >= 8000:
  category = "2"
else if difficulty >= 3000:
  category = "3"
else:
  category = "4"
```

## 📈 Future Enhancements

- [ ] Save analyzed routes
- [ ] Compare multiple routes
- [ ] Export climb data as CSV
- [ ] Interactive elevation profile chart
- [ ] Rider fitness calculator
- [ ] Strava integration
- [ ] Route recommendations
- [ ] Performance statistics

## 🔐 Permissions

The extension uses minimal permissions:

- `downloads` - Monitor GPX file downloads (optional, for auto-detection)

**No data is collected or transmitted** - All processing happens locally in your browser.

## 📝 File Descriptions

| File            | Purpose                                        |
| --------------- | ---------------------------------------------- |
| `manifest.json` | Chrome Extension v3 configuration              |
| `background.js` | Climb detection algorithm (300 lines)          |
| `gpx-parser.js` | GPX parsing & distance calculation (200 lines) |
| `popup.html`    | File upload UI (50 lines)                      |
| `popup.css`     | Styling & layout (250 lines)                   |
| `popup.js`      | File handling & display logic (180 lines)      |

## 🎓 Learning Resources

- [GPX Format Spec](https://www.topografix.com/GPX/1_1/)
- [Haversine Formula](https://en.wikipedia.org/wiki/Haversine_formula)
- [Chrome Extension Docs](https://developer.chrome.com/docs/extensions/)

## 💡 Tips

1. **Export with elevation**: Mapy.cz defaults to including elevation in GPX exports
2. **Test with a simple route first**: Helps you understand the climb detection
3. **Try different thresholds**: Adjust `CLIMB_START_GRADE` for your preferences
4. **Check route difficulty**: Very flat routes won't have climbs detected
5. **Use recent GPS data**: Older routes may have low elevation precision

## 📄 License

MIT License - Free to use, modify, and distribute

---

## Getting Started

1. **Install**: Load extension in Chrome
2. **Export**: Get a GPX from Mapy.cz
3. **Analyze**: Upload to extension
4. **Explore**: Click on climbs to see details

For more info, see `SUMMARY.md` and `TECHNICAL.md`

---

**Version**: 0.2.0  
**Last Updated**: March 31, 2026  
**Status**: ✅ Fully Functional
