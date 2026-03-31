# Climb Analyzer - Technical Implementation Notes

## Architecture Overview

The extension uses a **four-layer architecture** for GPX capture and analysis:

```
Mapy.cz Page (website)
    ↓
gpx-interceptor-injected.js  (page context - intercepts fetch/XHR)
    ↓ postMessage
gpx-interceptor.js           (content script - relays GPX to storage)
    ↓ chrome.runtime.sendMessage
background.js                (service worker - climb detection)
    ↓ chrome.runtime response
popup.js                     (popup - reads storage, renders UI)
```

## Phase 1: GPX Capture

### Interception Strategy

Because content scripts run in a sandbox, they cannot intercept `window.fetch` or `XMLHttpRequest` on the page directly. Instead, `gpx-interceptor.js` injects a second script (`gpx-interceptor-injected.js`) into the page context at `document_start`.

The injected script monkey-patches both `fetch` and `XMLHttpRequest` and detects export requests by URL:

```javascript
// Detect GPX export requests
if (url.includes('tplannerexport') && url.includes('export=gpx')) {
  // Capture response as text and post to content script
  window.postMessage({ type: 'GPX_FETCHED', gpxContent: text }, '*');
}
```

The content script (`gpx-interceptor.js`) receives the message and stores the GPX in both `chrome.storage.local` and `sessionStorage`, then notifies the background worker.

## Phase 2: Climb Detection Algorithm

### Gradient Calculation

For each segment between consecutive elevation points:

$$\text{gradient} = \frac{\Delta \text{elevation}}{\Delta \text{distance}} \times 100\%$$

Example:

- Point A: [0m, 100m elevation]
- Point B: [100m distance, 110m elevation]
- Gradient = (110-100)/(100-0) × 100 = 10%

### Climb Region Detection (Sliding Window)

Algorithm in `identifyClimbs()`:

```
1. For each segment in the profile:

   2. If gradient >= CLIMB_START_GRADE (3%):
      - Start new climb if not already in one
      - Add segment to current climb
      - Update running totals

   3. If gradient < DESCENT_THRESHOLD_GRADE (0%):
      - Increment descent counter
      - If descent >= DESCENT_THRESHOLD_DISTANCE (300m):
        - End current climb
        - Save if meets minimum length (500m)
        - Reset counters
```

### Parameters (Configurable)

```javascript
CLIMB_START_GRADE = 3%           // Gradient to begin climb detection
CLIMB_START_DISTANCE = 500m      // Minimum climb length
DESCENT_THRESHOLD_GRADE = 0%     // Gradient indicator of finished climbing
DESCENT_THRESHOLD_DISTANCE = 300m // Descent needed to confirm climb end
```

### Why These Values?

- **3% start threshold**: Below 3% is generally not considered challenging
- **500m minimum**: Filters out short bumps and micro-climbs
- **0% descent**: Any downward segment can end a climb
- **300m descent requirement**: Avoids false endings from brief downhill flats

### Example Trace

Route profile: 0m → climb 2km @ 5% → flat 1km @ 0% → downhill 0.5km @ -4%

```
Segments analyzed:
[0-500m @ 5%]   → In climb, distance=500m
[500-1000m @ 5%] → In climb, distance=1000m
[1000-1500m @ 5%] → In climb, distance=1500m
[1500-2000m @ 5%] → In climb, distance=2000m
[2000-2500m @ 0%] → Still in climb, descent=0m
[2500-3000m @ 2%] → Wait, gradient > 0%, reset descent
... [climb continues mixed grades]
```

**Note**: The logic is simplified above; the actual implementation tracks separate uphill/downhill phases.

## Phase 3: Climb Categorization

### Difficulty Score Formula

```
difficulty_score = distance_km × average_grade_percent × 100
```

Where:

- `distance_km` = total climb distance in kilometers
- `average_grade_percent` = (total elevation gain / total distance) × 100

This is the ProCyclingStats formula used by professional cycling databases.

### Example:

Climb: 2 km, 200m elevation gain

- Average grade = (200m / 2000m) × 100 = 10%
- Difficulty = 2 × 10 × 100 = **2,000 points**
- **Category: Cat 4** (< 3,000)

### Category Thresholds

```
Category | Min Score | Typical Length | Typical Gradient
---------|-----------|----------------|-----------------
HC       | 40,000+   | 20+ km         | 5%+
Cat 1    | 16,000+   | 10-20 km       | 4-7%
Cat 2    | 8,000+    | 5-10 km        | 3-6%
Cat 3    | 3,000+    | 2-5 km         | 3-5%
Cat 4    | < 3,000   | < 2 km         | 3%+
```

## Phase 3: UI Components

### Popup Display (popup.js)

Fixed width 420px popup showing:

- Header with gradient legend
- Route summary stats (total distance, elevation gain, max grade)
- Climbs list with per-climb SVG elevation charts
- File upload for manual GPX analysis
```

### Gradient Visualization

The SVG elevation profile uses 5 color bands:

```
Green  (< 3%)  → easy
Yellow (3-6%)  → moderate
Orange (6-9%)  → hard
Red    (9-12%) → very hard
Dark Red(12%+) → extreme
```

Each segment is rendered as a filled trapezoid polygon with a line segment on top for a clean, readable profile.

## Data Flow Diagram

```
User clicks Export Route → GPX on Mapy.cz
         ↓
Mapy.cz makes fetch request to /api/tplannerexport?export=gpx
         ↓
gpx-interceptor-injected.js intercepts response
         ↓
Converts blob/text to GPX string, posts via window.postMessage
         ↓
gpx-interceptor.js receives message
  - Stores in chrome.storage.local
  - Stores in sessionStorage
  - Notifies background.js and popup via port
         ↓
User opens popup (or popup is already open)
         ↓
popup.js reads GPX from chrome.storage.local
  - Calls parseGPX() → elevation profile [[dist, elev], ...]
  - Sends { type: 'PROCESS_CLIMBS', elevation: [...] } to background.js
         ↓
background.js detectClimbs():
  - calculateGradients() → per-segment grade
  - identifyClimbs()     → sliding window regions
  - trimClimbEndpoints() → remove flat starts/ends
  - categorizeClimb()    → difficulty score & category
         ↓
Returns: { climbs: [{distance, elevation, avgGrade, category, segments}, ...] }
         ↓
popup.js displayClimbs():
  - Renders climb list with stats
  - Generates SVG elevation charts per climb
```

## Known Limitations & Issues

### 1. Gradient Accuracy

- Depends on elevation data resolution from Mapy.cz
- Smoothing algorithms may underestimate local variations
- GPS/altitude data may have 5-10m margin of error

### 2. API Endpoint Changes

- If Mapy.cz changes API structure, detection breaks
- Current detection looks for `/route`, `/geometry`, `/elevation`
- May need updates if API versioning changes

### 3. Route Types

- Works best for cycling/hiking routes
- May not work for:
  - Public transit routes
  - Very short distances (< 500m)
  - Routes without elevation data

### 4. Performance

- Large routes (100+ km) with high resolution can slow processing
- Dashboard updates are real-time but may lag on massive datasets
- Limit visualization to every Nth segment for performance

### 5. Browser Limitations

- Content script runs in v3 sandbox - limited access to page context
- Fetch/XHR monkey-patching happens at window level
- Cross-origin requests may be blocked

## Future Optimization Ideas

### 1. Algorithm Improvements

- Implement Viterbi algorithm for smoother climb detection
- Add elevation smoothing (moving average)
- Detect plateau sections (flat climbs)
- Identify descents (negative climbs)

### 2. Performance

- Cache elevation data locally
- Use Web Workers for heavy computation
- Implement progressive rendering for large routes

### 3. Features

- Export as GPX/TCX with climb segments
- Compare with known famous climbs (Strava, Col Hunter)
- Real-time climbing difficulty prediction
- Segment difficulty based on elevation and distance

### 4. UI/UX

- Interactive elevation profile chart (Click to see details)
- Segment-by-segment gradient breakdown
- Difficulty comparison slider
- Dark/light mode toggle
- Settings panel

### 5. Integration

- Strava API for performance metrics
- Weather data for conditions
- Historical climbing data
- Rider fitness calculations

## Debugging Helpers

### Enable Verbose Logging

In `background.js`, add `console.log()` calls inside the detection functions. All major steps already log at `[Climb Engine]` and `[Categorize]` prefixes.

### Test with Known Route

Add to `background.js`:

```javascript
// Test climb detection with known data
const testData = [
  [0, 100],
  [100, 102],
  [200, 105] /* ... 2km of climbing ... */,
];
const testClimbs = detectClimbs(testData);
console.log("Test climbs:", testClimbs);
```

### Monitor API Calls

In Chrome DevTools Network tab:

1. Filter by `other` type (API calls)
2. Look for longer response times (data loading)
3. Check response preview for elevation arrays

## Testing Checklist

- [ ] Extension loads without errors in `chrome://extensions/`
- [ ] Content script console shows `[Climb Analyzer] Content script loaded`
- [ ] Mapy.cz API calls appear in DevTools Network tab
- [ ] Elevation data successfully extracted
- [ ] Dashboard panel injects into page
- [ ] Popup displays when clicking extension icon
- [ ] Climbs correctly categorized for various route types
- [ ] Edge cases (flat routes, long climbs) handled correctly

---

**Version**: 0.1.0  
**Last Updated**: March 2025
