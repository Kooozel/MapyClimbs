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

    v0.5 — Group Ride Planning

        [ ] Shareable link (no server required)
            Encode the full climb analysis as a base64 URL fragment.
            Anyone opening the link — even without the extension — lands on a static
            HTML page showing the route climbs. Ideal for sharing in group chats:
            "here's tomorrow's ride, check the climbs."

        [ ] Named climbs database
            Local JSON of well-known Czech/Slovak climbs (Lysá hora, Pustevny,
            Radhošť, Javorník, Slovak mountain passes, etc.).
            When a detected climb's GPS start falls within ~200 m of a known climb,
            show its name (e.g. "Lysá hora" instead of "Climb 3").
            No network calls required.

        [ ] Route alternative comparison
            Analyze two GPX files in the same session and show a side-by-side
            climb summary. Useful for planning alternative A vs alternative B
            when route-scouting with a group.

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

    Non-goals (explicitly out of scope)

        - User accounts / cloud sync (counter to the local trip-planning use case)
        - Strava segment duplication (their value is community KOMs — not replicable without community data)
        - Web app migration (the extension's interception of Mapy.cz GPX downloads
          is its core advantage; a web app would require manual exports every time)
