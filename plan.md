Plan: Mapy.cz Climb Analyzer Extension

1. Goal

Create a browser extension that analyzes GPX route files exported from Mapy.cz and displays a "ClimbPro-style" dashboard. This dashboard will identify specific climbs, categorize them (Cat 1-4, HC), and show color-coded gradient segments.

2.  Technical Strategy

    Data Source: GPX files exported from Mapy.cz route planning

    Data Extraction:
    Primary: Monitor downloads/file handling for GPX files from mapy.cz
    Parse GPX XML to extract elevation data from `<trkpt>` elements with `<ele>` tags
    Convert coordinates and elevation to distance/elevation array format

    Frontend: Display a popup/panel showing climb analysis from uploaded/exported GPX files

    Logic: Process the elevation array using a sliding window algorithm to calculate local gradients and group them into climbs.

3.  Implementation Steps

    Phase 1: GPX File Detection & Parsing

        [x] Create content script that monitors GPX file downloads from Mapy.cz
        [x] Parse XML to extract trackpoints with elevation data
        [x] Calculate distance between points (haversine formula or cumulative)
        [x] Build elevation profile array: [[distance, elevation], ...]

    Phase 2: Core Algorithm (The "Climb Engine")

        [x] Implement gradient calculation: grade = (Δelevation / Δdistance) × 100
        [x] Define climb detection logic:
            - Start: Gradient > 3% for more than 500m
            - End: Gradient falls below 0% (downhill) for more than 300m
        [x] Implement categorization (formula: distance(km) × grade(%) × 2):
            - Cat 4: > 8,000 pts
            - Cat 3: > 16,000 pts
            - Cat 2: > 32,000 pts
            - Cat 1: > 64,000 pts
            - HC: > 80,000 pts

    Phase 3: UI Development

        [x] Design popup interface for climb analysis
        [x] Color mapping by gradient:
            - < 3%: Light Green
            - 3-6%: Yellow
            - 6-9%: Orange
            - 9-12%: Red
            - > 12%: Dark Red/Maroon
        [x] Render elevation profiles with color-coded gradient bars

    Phase 4: Integration

        [x] Add download listener for GPX files from Mapy.cz
        [x] Trigger analysis automatically when GPX is downloaded
        [x] Add UI to manually upload GPX files
        [x] Display results in popup/dashboard

4.  User Workflow

    **Automatic Mode (Recommended)**
    1. User creates/plans route on Mapy.cz
    2. User clicks "Export" → selects GPX format
    3. Extension intercepts the export API call
    4. GPX content captured automatically
    5. Analysis triggers instantly in popup
    6. Results show climbs with elevations, gradients, and categories

    **Manual Mode (Fallback)**
    1. User exports route as GPX file to disk
    2. Opens extension popup
    3. Uploads GPX file manually
    4. Analysis runs and results display

5.  Prompt for the AI Agent

    "Update the Chrome Extension to instead of trying to intercept Mapy.cz's binary protocol requests, analyze GPX files. When a user exports a route from Mapy.cz as a GPX file, the extension should detect it, parse the elevation data, analyze climbs, and display a dashboard with gradient-colored segments."

6.  Version Roadmap

    Current version: v0.3

    v0.4 — Mapy.cz Native Integration

        Goal: inject climb analysis directly into the Mapy.cz page so the user never
        needs to open the extension popup while planning a route.

        Confirmed preconditions (verified on live site):
          - window.SMap is available with SMap.Marker, SMap.Coords, SMap.Layer
          - SMap.prototype.$constructor can be hooked to capture the map instance
          - Right sidebar has "Výškový profil" section and "Exportovat" button row
          - Route planning mode is detectable via URL param: planovani-trasy
          - Route URL encodes waypoints as rc=, rs=, ri= params

        Features:

        [ ] Map marker injection
            Add numbered SVG pins to the map at each climb's start GPS coordinate,
            colored by category (HC=red, Cat1=orange, Cat2=yellow, Cat3=lime, Cat4=gray).
            Uses the SMap.Marker API — native to Mapy.cz, not a floating CSS overlay.
            Markers are placed on a dedicated extension layer so they can be cleaned up.

        [ ] Sidebar climb panel
            Inject a collapsible "Climbs" section directly below the "Výškový profil"
            section in the right panel. Shows the same data as the popup (category badge,
            distance, elevation gain, avg grade, estimated time) but inline in the page.
            Auto-populates when GPX is captured; collapses cleanly if no route is active.

        [ ] "Analyze" button in action bar
            Inject a "🏔 Analyze" button alongside the Exportovat/Sdílet/Uložit buttons.
            Triggers re-analysis on demand (useful if the user modifies the route and
            exports a new GPX without reloading the page).

        Architecture:

            gpx-interceptor-injected.js (page context)
              |-- hooks SMap.prototype.$constructor → stores instance as window.__climbMap
              |-- listens for INJECT_MARKERS postMessage
              └-- creates SMap.Layer.Marker, adds SMap.Marker pins, then adds layer to map

            map-inject.js (NEW — content script)
              |-- MutationObserver: watches for "Výškový profil" → inject climb panel
              |-- MutationObserver: watches for Exportovat button row → inject Analyze button
              |-- polls chrome.storage.local for pendingGPX (same cadence as popup)
              |-- sends PROCESS_CLIMBS to background → receives climb array back
              |-- renders sidebar panel HTML
              └-- posts INJECT_MARKERS to page via window.postMessage

            map-inject.css (NEW)
              └-- styles for injected panel, matching Mapy.cz dark sidebar aesthetic

            background.js (minor change)
              └-- existing PROCESS_CLIMBS handler already works; no logic change needed

            manifest.json (update)
              |-- add map-inject.js as content_script (document_idle, all mapy urls)
              └-- add map-inject.css as content_script css

        Implementation notes:

          SMap instance capture (timing consideration):
            Our injected script runs BEFORE Mapy.cz's own scripts load, so
            window.SMap does not exist yet when our code executes. Simple prototype
            patching won't work. Instead, intercept the moment SMap is defined:

              let _smapDef;
              Object.defineProperty(window, 'SMap', {
                get() { return _smapDef; },
                set(val) {
                  _smapDef = val;
                  const _orig = val.prototype.$constructor;
                  val.prototype.$constructor = function(...args) {
                    _orig.apply(this, args);
                    window.__climbMap = this; // capture instance
                  };
                },
                configurable: true
              });

            This fires the moment window.SMap = ... is executed by Mapy.cz,
            patching the prototype before the map is ever instantiated.

          Sidebar injection selector strategy:
            Use text-content matching ("Výškový profil") rather than class names,
            since Mapy.cz minifies/hashes its class names and they change with deploys.
            MutationObserver on document.body with subtree:true catches dynamic rendering.

          Marker cleanup:
            Store layer reference in window.__climbMarkerLayer.
            On "Analyze" button re-click or route change, call layer.removeAll() before
            adding new markers. Detect route change by comparing location.href on
            popstate / hashchange events.

          Coordinate source:
            gpx-parser.js already reads lat/lon from each <trkpt> but currently
            discards them — output is [[distance, elevation], ...].
            Change: extend each entry to [[distance, elevation, lat, lon], ...].
            This is backward-compatible; all existing consumers only read indices 0 and 1.
            background.js already receives the profile and can correlate a climb's
            startDistance to the nearest profile entry to find the marker lat/lon.
            The climb result will gain a markerCoords: {lat, lon} field.

          Marker appearance:
            SVG data URI embedded in SMap.Marker options:
              <svg> circle + text (climb number) + colored stroke by category
            Size: 28×28 px so they're readable but don't clutter the map.

        Files to create/modify:
          [x] NEW  extension/map-inject.js       Content script — sidebar + button injection
          [x] NEW  extension/map-inject.css      Styles for injected panel
          [x] MOD  extension/gpx-interceptor-injected.js   Add SMap hook + marker injection
          [x] MOD  extension/gpx-parser.js       Return lat/lon alongside distance/elevation
          [x] MOD  extension/manifest.json       Register new content script + css
          [x] MOD  extension/background.js       Minor: also store climb result in storage
                                                  so map-inject.js can read it without
                                                  a round-trip message

    v0.5 — Climb Detection Polish & Flow Improvements

        Goal: make the climb engine more accurate and the overall extension flow
        more robust before adding new features.

        Climb detection algorithm (background.js)

        [x] Adaptive smoothing window
            Current fixed 150 m rolling average over-smooths short sharp ramps
            (e.g. 8% for 400 m) and under-smooths noisy flat sections.
            Switch to a gradient-magnitude-weighted window: narrow (50 m) on steep
            terrain, wide (250 m) on flat/rolling so noise is removed without
            erasing real punch climbs.

        [x] Implement "Noise Filtering" to fix unrealistic spikes (e.g., the 40% grade glitch).

        [x] Minimum elevation gain gate
            Add a hard floor of 30 m total elevation gain as a secondary filter
            after score categorisation. Avoids Cat 4 detections on flat urban
            roads that technically average >3% over a short distance.

        [x] Descent tolerance tuning
            The current 150 m / −1% descent closer can prematurely split climbs
            separated by a false flat or a bridge dip. Raise tolerance to 300 m
            for climbs already over Cat 3 score; keep 150 m for Cat 4 only.

        [x] Re-entry merge
            If two climbs within 500 m of each other share the same category,
            merge them unconditionally — Mapy.cz DEM sometimes introduces a
            noisy descent blip mid-ramp.

        UI / flow improvements

        [x] "Analyzing…" spinner state
            Show a subtle loading indicator in the sidebar while
            PROCESS_CLIMBS is in-flight so the user knows something is happening.

        [x] Retry button
            If no climbs are detected (empty result), show a "Re-analyse" button
            so the user can trigger another capture without reloading the page.

        [x] Popup last-capture link
            In `popup.js`, if `pendingGPX` exists also show the total distance
            and number of detected climbs from `lastClimbResult` alongside the
            timestamp, so the toolbar icon gives instant route context.

        [x] Storage versioning
            Add a `storageVersion` key so future schema changes can migrate or
            discard incompatible cached results gracefully instead of the current
            coordinate-presence heuristic.

    v0.5.1 — The "Action Only" & Smoothing Patch

        Goal: Fix graph presentation and mathematical engine to remove "dead weight"
        (flat sections) from climb profiles. Improves visual clarity for cyclists.

        Smart Climb Trimming (The Competitive Edge):

        [x] Dynamic Start (Discard Leading Flat)
            A climb profile must visually start only when gradient hits >3%.
            All leading flat/shallow sections (<3%) are discarded from the chart.
            Focuses on the actual ascent, not approach ramps.
            NOTE: Does NOT affect merge detection (happens after merge).

        [x] Peak Detection (True Summit)
            Climb must end exactly at the highest elevation point (The Peak).
            Any subsequent flat or downhill sections are cut off.
            Currently trimClimbEndpoints() uses <1.5% threshold — may need tuning.

        [x] Anti-Green Splitting (Avoid Large Green Voids)
            If a detected climb contains a section longer than 400m with grade <2%,
            split it into two separate climbs to avoid large "green voids" in UI.
            Happens AFTER merge as a post-processing step.
            Does NOT affect merge logic (merge already works on gradients).

        Data Resampling & Smoothing (Display + Detection):

        [x] Point Resampling (Eliminate Micro-Jitter)
            Merge GPS points closer than 10-15m to eliminate micro-jitter that causes
            vertical "stripes" in the elevation chart. Happens BEFORE gradient calc.
            Improves visual smoothness without affecting climb detection.

        [x] Savitzky-Golay Smoothing (Preserve Character)
            Apply sliding window filter (100-150m) to smooth elevation line while
            preserving the "character" of steep ramps. Better than current rolling avg.
            Can optionally be used in smoothElevationProfile() for better results.

        [x] Gradient Capping (Display Safety)
            Hard-cap max displayed grade at 25% to prevent "40% glitches" from
            breaking Y-axis scale. Capping is purely cosmetic (display layer only),
            does NOT affect detection or categorization logic.

        Safety Notes:
        ✅ These changes do NOT break merge functions
           - Point resampling happens before gradient calc → merge sees same logic
           - Smart trimming happens after merge → merge unaffected
           - Anti-green splitting is post-merge → merge unaffected
           - Gradient capping is display-only → no math changes
        ✅ Backward compatible with v0.5.0 data
        ✅ Optional enhancements can be rolled out gradually

    v0.5.2 — "The Peak" Map Icons (Sport Style)

        Goal: Replace default map teardrops with custom, lightweight SVG markers.
        Implement professional sport-style icons for climb start and end points.

        Map Pin Icons:

        [x] "The Pulse" Start Pin
            Shape: Simple circle, 12px diameter
            Style: Fill = Category Color, Stroke = 2px white
            Shadow: 4px blur ambient drop-shadow (subtle depth)
            Label: Display climb index (1, 2, 3...) as floating text 15px above
            Font: Bold sans-serif (system-ui, sans-serif)
            UX: Instantly recognizable as climb start marker

        [x] "The Summit" End Pin
            Shape: Minimalist mountain icon (triangle pointing up, Alpine style)
            Fill: Category Color
            Border: 1.2px white thin line
            Snow-cap Detail: Small white triangular cutout at triangle peak top
            Style: Flat design, no shadows, clean geometry
            Label: Category name ("HC", "C1", "C2", "C3", "C4") positioned adjacent
            UX: Professional, evokes climbing/mountaineering

        [x] Color Mapping (Sport Style Palette)
            HC: #800020 (Burgundy) — Mountain Hell
            C1: #D32F2F (Red) — Very Hard
            C2: #F57C00 (Orange) — Hard
            C3: #FBC02D (Yellow) — Moderate
            C4: #4CAF50 (Green) — Easier

        Files modified/created:

        [x] MOD  extension/map-inject.js     Updated renderPeakPins() for custom SVG markers,
                                             "The Pulse" circle pin, "The Summit" mountain pin

    v0.5.5 — Visual Refinement & UX Polish ("The Peak Style")

        Goal: Transition from a "functional tool" to a "pro-grade UI" with modern
        aesthetics and professional map pins. Implement professional design language.

        Modern Chart Aesthetics:

        [x] SVG Linear Gradients
            Replace flat solid colors in climb profile charts with gradients that fade
            towards the bottom (Area Chart style). Gives professional SaaS feel.
            - Steep sections: Gradient from red → light red/pink
            - Moderate: Gradient from orange → light orange
            - Easy: Gradient from yellow → light yellow/white
            - Flat: Gradient from green → very light green
            Creates visual depth and makes profiles more engaging to scan.

        [x] Bezier Curve Fitting
            Use cubic bezier interpolation for the top edge of the climb profile
            to make it look smooth and professional, not jagged/pixelated.
            - Input: Raw segment line (steps between points)
            - Output: Smooth cubic bezier curve connecting all points
            - SVG path data generated from segment endpoints
            Dramatically improves perceived quality without changing data.

        [x] Vertical Auto-Scaling
            The Y-axis (elevation) must start at min_climb_elevation - 5m
            (not at 0m or min of entire route) to maximize vertical resolution
            and clearly show the climb shape. Gives "tall, impressive" appearance.
            - Recalculate Y-axis range per-climb, not globally
            - Preserves scale accuracy while optimizing visual clarity

        **Professional Map Pins ("The Peak Style"):**

        [x] Start Pin: "The Pulse"
            Lightweight vector circle with glow effect and climb number.
            - Structure: Glow circle (filter blur 2px, category color, 0.3 opacity)
            - Base: 12px diameter circle, category color fill, 2px white stroke
            - Label: Climb index (1, 2, 3...) centered, white bold text with black outline
            - Effect: Clean, professional appearance at all zoom levels
            - Color Palette (v0.5.5): HC=#800020, C1=#D32F2F, C2=#F57C00, C3=#FBC02D, C4=#4CAF50

        [x] End Pin: "The Summit"
            Minimalist triangle peak with snow-cap notch and category label
            - Body: Isosceles triangle (height 24px), category color fill
            - Snow-cap: White horizontal line at top 30%, evoking snow-covered peak
            - Label: Category (HC, C1, C2, C3, C4) positioned to right of peak in category color
            - Effect: Elegant, memorable design - instantly recognizable as a climb endpoint
            - Strokes: None (only category color + white for snow-cap)

        Interaction Design:

        [x] Hover Scanner (Interactive Tooltip)
            A smooth vertical line follows the mouse over the chart, displaying
            real-time tooltip with exact grade and distance at that point.
            - On mousemove: detect nearest segment under cursor
            - Draw vertical line from X-axis to top of elevation curve
            - Show tooltip: "Grade: 7.5% | Distance: 2.3 km from start"
            - Tooltip smoothly updates as mouse moves across profile
            - Disappears when mouse leaves chart area
            Lets cyclists "zoom in" mentally on specific climb sections.

        [x] Map Sync (Ghost Marker)
            Ensure the "ghost marker" on the Mapy.cz map moves perfectly in sync
            with the chart hover. When cyclist hovers a point in the popup chart,
            a semi-transparent marker appears on the map at that exact GPS coordinate.
            - Use existing markerCoords interpolation to find GPS at hovered distance
            - Fade in/out the ghost marker smoothly (opacity 0.5)
            - Sync updates in < 100ms (feel instant)
            - Remove marker when hover ends
            Connects pop-up analysis back to route visualization on map.

        Files modified/created:

        [x] MOD  extension/map-inject.js     Peak Style pins, color palette update
        [x] MOD  extension/popup.js          Hover scanner logic + tooltip rendering
        [x] MOD  extension/popup.css         Styles for hover line, tooltip, gradient fills
        [x] NEW  extension/chart-utils.js    SVG bezier curve generation, gradient definitions
        [x] MOD  extension/gpx-parser.js     Return segment endpoint data for bezier calcs
        [x] MOD  extension/background.js     Ensure all climbs include cached GPS points
                                             for hover marker sync

    v0.5.5 — Hybrid High-Def Data Processing (CURRENT PHASE)

        Goal: Implement surgical GPS noise reduction and professional chart rendering.
        Philosophy: "Resample, don't Smooth" — Remove digital artifacts while preserving
        real gradient changes. Zero data loss and honest representation of terrain.

        Data Processing Pipeline:

        [x] Douglas-Peucker RSP Algorithm (Epsilon=3.0m)
            Recursively remove unnecessary GPS points within 3.0m perpendicular distance
            of the connecting line. Eliminates micro-jitter and staircase stepping effect
            while preserving real, related climbing sections together.
            - Perpendicular distance calculation for precision
            - Epsilon=3.0m (relaxed threshold for better climb continuity)
            - Reduces fragmentation of single climbs into multiple segments
            - Integrates after distance-threshold merging (12m minimum)

        [x] Aggressive Climb Trimming (Start 2%, End at Peak)
            Enhanced smartTrimClimbStart() with peak detection:
            - Start: First segment with gradient >= 2% (captures rolling terrain)
            - End: Exactly at segment with MAX elevation (peak detection)
            - Peak Detection: Loop through all segments, find highest elevation index
            - Recalculation: Distance, elevation gain, avgGrade all recomputed on trim
            - Safety: Returns null if entire climb < 2% or invalid after trim

        [x] Distance-Mapped LinearGradient
            Create <linearGradient> in SVG <defs> with color stops based on cumulative
            distance and segment gradient severity:
            - 0-3% gradient: Green (#4CAF50)
            - 3-6% gradient: Yellow (#FBC02D)
            - 6-9% gradient: Orange (#F57C00)
            - 9-12% gradient: Red (#D32F2F)
            - 12%+ gradient: Burgundy (#800020)
            - Smooth transition across distance with individual stop per segment

        [x] Vertical Opacity Gradient Overlay
            Secondary <linearGradient> for professional fade effect:
            - Direction: Vertical (y1=0%, y2=100%)
            - Top: opacity 0.8 (opaque)
            - Bottom: opacity 0.0 (transparent)
            - Applied to fill layer for SaaS appearance

        [x] Max Grade Marker Pill Badge
            Display highest gradient segment with floating pill badge above chart:
            - Detection: Loop through all segments, track max gradient value
            - Position: Middle of max gradient segment, 12px above top edge
            - Styling: Rounded pill rect, category color background, white bold text
            - Format: "12.0%" (1 decimal place)

        [x] Chart Header UI Refinement
            Removed Score field (difficulty metric), added Peak elevation:
            - Removed: `<span class="climb-score">Score 5000</span>`
            - Added: `<span class="climb-summit">🏔️ Peak 744 m</span>`
            - Styling: White text, burgundy background (0.3 opacity), rounded corners
            - Benefit: Peak elevation more directly relevant than abstract score

        [x] CSS Improvements
            - Vertical padding: climbs-profile-container uses `overflow: hidden`
            - Dynamic Y-axis: Labels generated per-climb (minElev-5 to maxElev+5)
            - Remove hardcoded values: All elevation ranges calculated per-climb

        [x] Testing & Complete Verification
            - All 8 tasks implemented and integrated
            - No syntax errors in background.js or map-inject.js
            - RDP algorithm verified with epsilon=3.0m threshold (relaxed for continuity)
            - Peak detection tested with gradient >= 2% start trimming
            - Distance-mapped gradients rendering in SVG with improved color banding
            - Max grade pill badge positioned correctly with white background
            - Header UI refined with peak elevation display
            - Chart visual improved: Green → Cyan → Orange → Red → Burgundy gradient

        Files modified/created:

        [x] MOD  extension/background.js     Added douglasPeuckerSimplify(points, epsilon),
                                             perpendicularDistance() helper, enhanced
                                             resamplePoints() with RDP pipeline,
                                             enhanced smartTrimClimbStart() with peak detection
        [x] MOD  extension/map-inject.js     Updated renderElevationSVG() with:
                                             - Distance-mapped LinearGradient generation
                                             - Vertical opacity gradient overlay
                                             - Max grade pill badge rendering
                                             - Updated climb header to show peak elevation
                                             - 2px solid stroke top edge
        [x] MOD  extension/map-inject.css    Added .climb-summit styling (peak display),
                                             verified overflow:hidden on containers
        [x] DOC  plan.md                     Updated v0.5.5 section with Hybrid High-Def specs
        [x] DOC  CHANGELOG.md                Added Hybrid High-Def release notes

    v0.6 — Route Intelligence

        [ ] Natural regrouping points
            Detect flat/descending sections of 2+ km between climbs and mark them
            on the map overlay as suggested regrouping stops — useful for mixed-ability groups.

        [ ] Export enhanced GPX
            Re-export the GPX with climb waypoints embedded as <wpt> tags so the
            route loaded into a Garmin/bike computer already shows climb markers.

        [ ] Segment difficulty trend
            Show whether a route "front-loads" or "back-loads" the hard climbing —
            a single-line fatigue indicator (e.g. "hardest climb is at 73% of route").

        [ ] Shareable link (no server required)
            Encode the full climb analysis as a base64 URL fragment.
            Anyone opening the link — even without the extension — lands on a static
            HTML page showing the route climbs. Ideal for sharing in group chats:
            "here's tomorrow's ride, check the climbs."

        [ ] Gradient histogram per climb
            Add a gradient distribution breakdown to each climb result:
            { pct_below3, pct_3to6, pct_6to9, pct_9to12, pct_above12 }
            Drives a richer sidebar bar chart and better informs the cyclist
            about where within the climb the hard sections are.

    v0.7.0 — Named Climbs Database & Mountain Recognition

        [ ] Named climbs micro-database (Czech / Slovak / Carpathian)
            Curated JSON database of well-known climbs and mountain passes:
            - High Tatras (Vysoké Tatry) passes and summits
            - Low Tatras (Nízke Tatry) passes
            - Carpathian peaks and famous routes
            - Bohemian Forest (Šumava) climbs
            - Czech mountains & Moravian-Silesian ranges
            
            When a detected climb's start falls within ~2 km of a known entry,
            display the climb's name in the card header and map pin tooltip.
            Zero network calls — purely local lookup with Haversine distance.

        [ ] Mountain pass detection
            Identify when a climb crosses a named mountain pass.
            Highlight premium peaks and iconic routes in the result cards.

        [ ] Custom climb naming UI
            Allow users to add/edit custom climb names locally.
            Store in chrome.storage.sync for cross-device sync (if user signs in).

    Non-goals (explicitly out of scope)

        - User accounts / cloud sync (counter to the local trip-planning use case)
        - Strava segment duplication (their value is community KOMs — not replicable without community data)
        - Web app migration (the extension's interception of Mapy.cz GPX downloads
          is its core advantage; a web app would require manual exports every time)
