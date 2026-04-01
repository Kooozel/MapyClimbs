# Changelog — Mapy.cz Climb Analyzer

All notable changes to the Climb Analyzer extension are documented here.

## [0.5.3] — 2026-04-02 (Chart UI: The Segmented Aura)

### ✨ Features

#### Elevation Profile Chart — Segmented Aura with Smooth Bezier Curves

**Data Processing: Savitzky-Golay Smoothing**

- **Moderate Elevation Filtering**: Applies Savitzky-Golay smoothing (window 101, order 3) to elevation data
- **Preserves Real Climbs**: Removes GPS jitter and micro-stepping while keeping actual steep sections intact
- **Visual Rounding**: Peaks and valleys are visually smoothed without losing gradient accuracy

**The Path & Stroke: Smooth Bezier Curves**

- **Cubic Bezier Interpolation**: Converts jagged polyline to flowing `C` path commands for professional appearance
- **Vibrant Category Stroke**: 2px solid stroke uses the climb's category color (e.g., orange for C2, red for C1)
- **Smooth Joins**: `stroke-linejoin: round` and `stroke-linecap: round` for polished appearance
- **High Opacity**: 0.95 opacity for prominent edge visibility

**Visual Fill (The "Aura"): Segmented Vertical Zones**

- **Distinct Colored Segments**: Instead of horizontal blending, creates vertical gradient zones (Green < 3%, Orange 3-9%, Red > 9%)
- **No Horizontal Blending**: Each segment maintains its own vertical gradient that fades downward
- **Per-segment Vertical Fade**: Each zone has linear vertical gradient:
  - **Top**: Segment color at 0.9 opacity
  - **Bottom**: Segment color at 0.0 opacity (transparent)
- **Category Color Aura Overlay**: Topmost fade uses the climb's category color for additional visual emphasis
  - **Top**: Category color at 0.8 opacity
  - **Bottom**: Category color at 0.0 opacity

**Contextual Annotations: Max Grade Tag**

- **Intelligent Detection**: Identifies the steepest gradient in the climb profile
- **Precise Placement**: Positioned at the highest point of the steepest segment
- **Category-Colored Badge**: Rounded pill (rx="8") using climb's category color background
- **Display Format**: Shows grade as "X.X%" with white text, white border, 95% opacity

**Grid & Scaling: Subtle Reference Guides**

- **Soft Grid Lines**: Horizontal guides use `stroke: rgba(255,255,255,0.1)` — barely visible (10% opacity)
- **Y-Axis Scaling**: Maintained tight range (elevation−5m to elevation+10m) for maximum climb detail visibility
- **Refined Labels**: Y-axis #888, X-axis #777 for improved contrast against dark background

### 🔧 Technical Changes

- **Added `savitzkyGolay()` function** — Smooths elevation data to remove GPS artifacts
  - Window size: 101 samples
  - Polynomial order: 3
  - Preserves steep sections while removing micro-jitter

- **Updated `generateElevationChart()` function** — Now accepts climb category parameter
  - Applies smoothing before profile simplification
  - Passes category to rendering function

- **Complete rewrite of `renderElevationSVG()` function**:
  - **Cubic Bezier Path**: Generates smooth curve through all elevation points
  - **Segmented Gradients**: Creates individual vertical fade gradients for each segment (Green/Orange/Red zones)
  - **Category-Color Stroke**: Uses climb category color for vibrant 2px polyline edge
  - **Category Aura**: Overlaid category-color gradient for additional visual pop
  - **SVG Rendering Order**: Background → segment fills → category aura → grid → Bezier stroke → tag

- **Category Color Mapping**:
  - HC: #800020 (Burgundy)
  - C1: #D32F2F (Red)
  - C2: #F57C00 (Orange)
  - C3: #FBC02D (Yellow)
  - C4: #4CAF50 (Green)

### Files Modified

- `extension/map-inject.js` — Complete chart rendering refactor with Savitzky-Golay smoothing, Bezier curves, and segmented aura

### ✅ Status

- [x] Savitzky-Golay filtering implemented for elevation smoothing
- [x] Cubic Bezier curve path generation implemented
- [x] Category color extraction and mapping
- [x] Segmented vertical gradient zones (Green/Orange/Red classification)
- [x] Category color aura overlay with vertical fade
- [x] Vibrant category-colored polyline stroke
- [x] Smart max grade tag positioning and styling
- [x] Soft grid lines maintained
- [x] Complete "Segmented Aura" aesthetic achieved

---

## [0.5.2] — 2026-04-02 ("The Peak" Map Icons — Sport Style)

### ✨ Features

#### "The Peak" Map Icons — Custom SVG Markers

**Start Pin: "The Pulse"**

- Circle marker, 32×52px display size
- Fill = Category Color, Stroke = 2.2px white
- Prominent 8px radius circle with 4px drop shadow
- Label: Climb index (1, 2, 3...) centered above circle, bold sans-serif font
- Lightweight and clean, easily visible on map

**End Pin: "The Summit"**

- Alpine mountain icon (triangle pointing upward), 38×38px display size
- Fill = Category Color, Border = 1.2px white thin line
- Snow-cap feature: Sharp, pointed white triangular detail at peak apex
- Flat design (no shadows)
- Label: Category name ("HC", "C1", "C2", "C3", "C4") positioned next to icon
- Professional Alpine aesthetics

**Color Mapping (Heat Scale — High-contrast against green terrain)**

- HC: #660000 (Deep Burgundy) — Mountain Hell
- C1: #B30000 (Vibrant Red) — Very Hard
- C2: #E65100 (Deep Orange) — Hard
- C3: #FF9100 (Amber/Dark Yellow) — Moderate
- C4: #FFD600 (Electric Yellow) — Easier

### 🔧 Technical Changes

- **Replaced teardrop map pins** with custom SVG icons
- **"The Pulse" Start Pin**: 32×52px SVG with 8px circle and drop shadow
- **"The Summit" End Pin**: 38×38px mountain triangle with sharp snow-cap detail and adjacent category label
- **Visibility enhancements**: All markers feature 2px solid white stroke + black drop-shadow (0 2px 4px) for separation from green terrain
- **Flat design philosophy**: No complex filters or gradients, pure SVG simplicity
- **Heat Scale Color Palette**: Optimized high-contrast colors for terrain visibility (Deep Burgundy → Electric Yellow)
- Updated `renderPeakPins()` function to generate both pin types with enhanced sizing

### Files Modified

- `extension/map-inject.js` — Updated pin SVG rendering logic for start and end markers, enhanced sizing, sharpened geometry
- `CHANGELOG.md` — Documented v0.5.2 release with refinements

### ✅ Status

- [x] "The Pulse" start pin implemented and sized
- [x] "The Summit" end pin with sharp snow-cap detail implemented and sized
- [x] Category labels integrated with icons
- [x] Color palette updated to warm red-based palette
- [x] Pin sizes increased for better visibility
- [x] Color palette verified (HC, C1-C4 standards)
- [x] Flat design aesthetic applied (no shadows, clean rendering)

---

## [0.5.1] — 2026-04-01 (The "Action Only" & Smoothing Patch)

### ✨ Features

#### Graph Presentation & Visual Improvements

- **Point Resampling**: Eliminate micro-jitter from GPS data (merges points < 10-15m) to remove vertical "stripes" in elevation charts
- **Smart Climb Start Trimming**: Discard leading flat/shallow sections (<3% gradient) from climb profiles, focusing visual attention on the actual ascent
- **Peak Detection**: Climb profiles now end exactly at the highest elevation point, removing trailing flat/downhill sections
- **Anti-Green Splitting**: Automatically split climbs containing large flat sections (>400m < 2% gradient) to avoid visual "green voids" in the UI
- **Optional Savitzky-Golay Filter**: Available as an opt-in enhancement for even cleaner elevation curves while preserving steep ramp character
- **Gradient Capping Note**: Display layer can cap gradient visualization at 25% to prevent extreme "40% glitch" Y-axis breaks

### 🔧 Technical Changes

- Added `resamplePoints()` function — eliminates micro-jitter before gradient calculation
- Added `smartTrimClimbStart()` — removes leading <3% sections (display-focused, post-merge)
- Added `splitAntiGreenClimbs()` — splits climbs with large flat middle sections
- Added `savitzkyGolaySmooth()` — optional polynomial smoothing (currently disabled by default)
- Integrated v0.5.1 helpers into post-merge pipeline
- Updated algorithm documentation with v0.5.1 pipeline details

### ✅ Safety Guarantees

- ✅ **No merge function changes** — point resampling & trimming happen outside merge logic
- ✅ **Backward compatible** — all v0.5.0 data remains valid
- ✅ **Optional enhancements** — Savitzky-Golay can be toggled per-route in future UI
- ✅ **Display-only changes** — gradient capping is UI presentation, not mathematical

### 🐛 Improvements

- Better visual clarity for cyclists viewing climb profiles
- Eliminated visual artifacts from DEM noise
- Cleaner climb categorization (no inflated grades from jitter)
- More intuitive climb start/end points for riders

---

## [0.5.0] — 2026-04-01

### ✨ Features

#### Algorithm Improvements

- **Adaptive Smoothing Window**: Gradient-magnitude-weighted elevation smoothing (50-250m window) to preserve sharp climb ramps while filtering noise on flat terrain
- **Noise Filtering**: Automatic detection and interpolation of unrealistic elevation spikes (>12% single-segment anomalies)
- **Elevation Gain Gate**: Minimum 30m elevation gain threshold to filter micro-bumps
- **Re-entry Merge**: Intelligent merging of nearby climbs separated by small valleys using relative drop thresholds
- **Enhanced Descent Logic**: Tuned descent thresholds (150m early stop, category-aware tolerance)

#### User Interface

- **Loading Spinner**: Animated indicator during GPX analysis
- **Climb Statistics**: Display climb count and total route distance in popup
- **Retry Button**: Quick re-analysis for cases with no detected climbs
- **Persistent Stats**: Climb results cached for quick reference

#### Data & Infrastructure

- **Storage Versioning**: Automatic cache validation and migration on schema changes
- **Improved Logging**: Better console diagnostics for climb categorization

### 🔧 Technical Changes

- Updated minimum climb elevation threshold from 10m → 30m
- Descent distance threshold optimized to 150m for better climb separation
- Storage versioning system prevents stale cache issues
- Simplified popup.js to eliminate redundant storage queries

### 📚 Documentation

- Updated extension version to 0.5.0 in manifest.json
- Enhanced popup UI with v0.5 branding
- Added technical details for new smoothing algorithm

### 🐛 Fixes

- Prevents false merge of very short climbs (<500m) with high descents
- Better handling of descending-only segments in climb detection
- Improved DEM noise robustness on low-quality elevation data

---

## [0.4.1] — 2026-03-15

### ✨ Features

- Initial v0.4 climb detection algorithm
- ProCyclingStats difficulty scoring (HC, Cat 1-4)
- Real-time gradient-colored visualization
- GPX import from Mapy.cz route planner

### 🔧 Technical Changes

- Established climb detection baseline
- Implemented category thresholds

---

## Version Numbering

- **Major (0.x.0)**: Algorithm overhauls or significant feature additions
- **Minor (0.x.Y)**: Bug fixes and UI refinements
- Versions track climb detection accuracy improvements and user experience enhancements
