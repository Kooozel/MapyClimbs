# Architecture - Mapy.cz Climb Analyzer

## System Overview

The extension uses a **three-layer architecture** for GPX capture and analysis:

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
│  - Reads GPX from storage               │
│  - Requests climb detection             │
│  - Renders UI with climbs               │
└─────────────────────────────────────────┘
```

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
Stores in sessionStorage
Sends message to background.js
Notifies popup via port
         ↓
Extension icon shows notification (optional)
```

### 2. Analysis Flow

```
Popup.js reads from chrome.storage.local
         ↓
Calls parseGPX() from gpx-parser.js
         ↓
Generates elevation profile [distance, elevation] pairs
         ↓
Sends message to background.js: { type: 'PROCESS_CLIMBS', elevation: [...] }
         ↓
background.js detectClimbs()
  ├─ calculateGradients() - compute % grade per segment
  ├─ identifyClimbs() - sliding window for >3% grade regions
  ├─ trimClimbEndpoints() - remove flat starts/ends
  └─ categorizeClimb() - apply difficulty formula
         ↓
Returns array of climb objects
         ↓
popup.js displayClimbs()
  ├─ Renders climb list
  ├─ Generates SVG elevation charts
  └─ Displays all statistics
```

## File Responsibilities

### `manifest.json`

- Defines extension metadata and permissions
- Declares service worker (background.js)
- Declares content scripts (gpx-interceptor.js)
- Declares web-accessible resources (gpx-interceptor-injected.js)
- Specifies host permissions for mapy.cz/\*

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
- Stores in sessionStorage as fallback
- Sends chrome.runtime.sendMessage to background.js
- Maintains persistent port connection to popup

### `background.js`

**Context**: Service worker (always running)
**Responsibilities**:

- Receives GPX_CAPTURED messages from content script
- Receives PROCESS_CLIMBS messages from popup
- Implements climb detection algorithm:
  - `detectClimbs()` - main entry
  - `calculateGradients()` - per-segment grade calculation
  - `identifyClimbs()` - sliding window algorithm
  - `trimClimbEndpoints()` - remove flat sections
  - `categorizeClimb()` - difficulty scoring
- Sends climb data back to popup/content script
- Manages connected popup ports for notifications

### `gpx-parser.js`

**Context**: Shared library (loaded by popup, background, popup)
**Responsibilities**:

- Parse GPX XML format
- Extract track/waypoints
- Calculate distances using Haversine formula
- Build elevation profile arrays
- Handle various GPX XML namespace formats

### `popup.html`

- UI structure for extension popup
- File upload input
- Status/results display areas
- Button controls
- Legend for gradient colors

### `popup.css`

- Popup window styling (width: 600px, height: 600px)
- Climb item card styles
- Gradient color definitions
- Chart sizing and layout
- Category-based border colors

### `popup.js`

**Context**: Popup window script (runs when popup opened)
**Responsibilities**:

- Establish port connection to background.js
- Load GPX from storage (chrome.storage.local or sessionStorage)
- Parse GPX file content
- Send PROCESS_CLIMBS to background worker
- Render climb list UI
- Generate SVG elevation charts
- Display route statistics
- Handle file uploads and analysis

## Key Design Decisions

### 1. Two-Layer Injection

**Why**: Content scripts run in a sandbox, can't access page's fetch/XHR directly
**Solution**: Inject a second script that runs in page context
**Trade-off**: More complex, but guaranteed to intercept all network calls

### 2. Multiple Storage Fallbacks

**Why**: GPX capture must survive extension reload/popup close
**Solution**: Store in both chrome.storage.local (persistent) and sessionStorage (fast)
**Benefit**: Fast access during same session, persistent across sessions

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

1. **Marker Positioning**: Abandoned due to no access to Mapy.com's coordinate system
2. **Spike Detection**: Can't filter spikes shorter than 150m flat threshold
3. **Real-time Updates**: No live tracking, analysis only on GPX export
4. **Multi-tab**: Each tab's GPX overwrites previous (design choice for simplicity)
