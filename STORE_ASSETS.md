# Chrome Web Store — Submission Assets

> **Extension:** MapyClimbs v1.0.0  
> **Manifest Version:** 3  
> **Prepared:** 2026-04-02

---

## 1. Store Listing Metadata

### Extension Name _(max 45 characters)_

```
MapyClimbs: GPX Climb Analyzer
```

_(32 characters)_

---

### Short Description _(max 150 characters)_

```
Auto-detect every climb on your route — elevation charts, category grades, VAM, and live map pins injected right into the sidebar.
```

_(139 characters)_

---

### Long Description _(Chrome Web Store "Detailed description" field)_

```
MapyClimbs turns Mapy.com into a full cycling-climb analyzer. The moment you export a GPX route, the extension automatically captures it, detects every significant ascent using a 7-step algorithm, and injects a native-looking analysis panel directly into the Mapy.com sidebar — no copy-pasting, no external websites, no extra clicks.

─────────────────────────────────────
WHAT YOU GET
─────────────────────────────────────

• Automatic GPX capture — intercepts the Mapy.com GPX export in the background; nothing to upload manually.
• Climb cards in the sidebar — every detected climb appears as a card (category badge, distance, elevation gain, avg and max grade) scrollable alongside your route.
• Live map pins — numbered start pins and mountain-icon end pins are drawn directly on the Mapy.com map and track every pan and zoom.
• Per-climb elevation charts — expandable SVG profiles with Catmull-Rom curves, grade-coloured gradient fills, and distance markers so you can gauge where the hard sections are.
• Full climb metrics — VAM (vertical ascent metres/hour), estimated climb time, Fiéts index, ProCyclingStats difficulty score, and HC / Cat 1–4 categorisation.
• Route overview — total distance, total elevation gain, maximum grade, and a proportional climb strip at the top.
• SPA-aware — a MutationObserver re-injects the panel automatically when Mapy.com navigates without a full page reload.
• Czech & English — full localisation for both languages, following your browser's locale setting.

─────────────────────────────────────
HOW IT WORKS
─────────────────────────────────────

1. You plan a route in Mapy.com and click the MapyClimbs "Analyze" button in the sidebar.
2. A lightweight page-context interceptor silently captures the GPX export that Mapy.com generates in the background.
3. The GPX is processed locally by a 7-step pipeline: point resampling → adaptive elevation smoothing → DEM spike filtering → gradient computation → climb identification → valley merging → flat-tail trimming and anti-flat splitting.
4. Results are written to chrome.storage.local (your device only) and the sidebar panel, elevation charts, and map pins are rendered instantly inside the Mapy.com tab.

No account, no sign-up, no external server. Everything runs in your browser.

─────────────────────────────────────
CLIMB CATEGORISATION
─────────────────────────────────────

Score = distance (km) × average grade (%) × 100   [ProCyclingStats formula]

  HC     ≥ 40 000
  Cat 1  ≥ 16 000
  Cat 2  ≥  8 000
  Cat 3  ≥  3 000
  Cat 4  <  3 000

─────────────────────────────────────
PRIVACY-FIRST COMMITMENT
─────────────────────────────────────

• Zero data collection — MapyClimbs collects no personal data, no location data, and no route data.
• Fully local processing — GPX analysis runs entirely in your browser using the Chrome extensions API. Nothing is transmitted to any server.
• Minimal permissions — only "storage" (to cache results on your device) and host access to mapy.com (to inject the panel). No other sites, tabs, or resources are touched.
• Open source — the full source code is publicly available for inspection.

─────────────────────────────────────
COMPATIBILITY
─────────────────────────────────────

Works on Chrome 88+, Microsoft Edge 88+, and Brave.
Designed exclusively for mapy.com.

─────────────────────────────────────
SUPPORT THE DEVELOPER
─────────────────────────────────────

MapyClimbs is free and open source. If it saves you time on your next ride, consider buying me a coffee:
☕ https://buymeacoffee.com/frantisek.sikula
```

---

## 2. Permission Justifications _(for Google Reviewer)_

These statements are intended for the "Permission justification" fields in the Chrome Web Store Developer Dashboard, and/or for a Reviewer Notes document uploaded at submission.

---

### `storage`

> **Justification:**
>
> The `chrome.storage.local` API is used solely to cache the most recently captured GPX payload and the corresponding computed climb results on the user's local device. This persistence is necessary so that the sidebar panel and popup can both display the current analysis across multiple popup opens and tab navigations without re-processing the GPX on every load.
>
> No data is written to `chrome.storage.sync`; nothing is transmitted off-device. The stored value is a plain JSON object containing elevation/coordinate arrays derived from the Mapy.com GPX export and is automatically overwritten the next time the user analyzes a route.

---

### `host_permissions`: `https://mapy.cz/*`, `https://*.mapy.cz/*`, `https://mapy.com/*`, `https://*.mapy.com/*`

> **Justification:**
>
> This extension functions exclusively on the mapy.com route-planning interface. Host access to these four origins is required for two technically distinct, inseparable reasons:
>
> **1. Content script injection (sidebar panel & map pins):**
> Two content scripts (`interceptor.js` and `content/inject.js`) must execute inside the Mapy.com tab to (a) inject a small page-context script that intercepts the GPX export response and (b) build and maintain the climb analysis panel inside the Mapy.com sidebar DOM. Without host permission, Chrome will not permit content script execution on this origin.
>
> **2. `web_accessible_resources` bridge (`gpx-interceptor-injected.js`):**
> The GPX export is made by Mapy.com's own JavaScript via `fetch` / `XMLHttpRequest`. The only reliable, non-brittle way to observe this response is to monkey-patch `window.fetch` and `XMLHttpRequest` in the page's own JavaScript context. This requires injecting a bundled script (`gpx-interceptor-injected.js`) as a `web_accessible_resources` entry via a `<script>` tag. The resulting `window.postMessage` channel to the content script is scoped strictly to the same Mapy.com origin, and no cross-origin communication occurs.
>
> The extension does not request, read, or modify any content on any other origin. The four entries (`mapy.cz`, `*.mapy.cz`, `mapy.com`, `*.mapy.com`) cover the different subdomain variants (e.g., `en.mapy.cz`, `en.mapy.com`) used by the mapping service for localised interfaces.

---

## 3. Privacy Policy

---

```
PRIVACY POLICY — MapyClimbs Chrome Extension
Last updated: 2026-04-02

1. DATA COLLECTED
   MapyClimbs does not collect, transmit, store remotely, or share any personal data,
   route data, location data, or usage data. There are no analytics, no telemetry,
   and no third-party SDKs.

2. LOCAL STORAGE
   The extension caches the most recently processed GPX file and the resulting climb
   analysis in chrome.storage.local on the user's own device. This data never leaves
   the device and is overwritten each time the user analyzes a new route.

3. NETWORK REQUESTS
   MapyClimbs makes no outbound network requests of its own. The only network
   activity the extension observes is Mapy.com's own GPX export endpoint
   (/tplannerexport?export=gpx), and only to read the route data the user has
   already requested from Mapy.com.

4. HOST PERMISSIONS
   The extension operates exclusively on mapy.com. It does not access
   any other website, API, or service.

5. PERMISSIONS SUMMARY
   - storage: cache analysis results locally on your device.
   - host_permissions (mapy.com): inject the sidebar panel and capture
     GPX data within the Mapy.com tab.
   No other permissions are requested.

6. CHILDREN
   This extension does not target children and does not collect data from any user.

7. CHANGES
   If the privacy practices change in a future version, this policy will be updated
   and users will be notified via the extension's changelog.

8. CONTACT
   For questions, open an issue at: https://github.com/Kooozel/MapyClimbs.git
```

---

## 4. Legal Disclaimer

_Append this to the end of the Long Description, or link to it from the store listing._

```
DISCLAIMER

MapyClimbs is an independent, open-source project and is not affiliated with,
endorsed by, or officially connected to Seznam.cz a.s. or the Mapy.com
services in any way. The Mapy.com name and logo are the property of its respective owner.

This extension is provided "as is", without warranty of any kind. The developer
accepts no liability for inaccuracies in climb detection, map rendering, or any
consequences arising from use of the extension. Climb analysis is intended for
informational and planning purposes only.
```

---

## 5. Graphic Asset Briefs

### Promotional Tile — 440 × 280 px (required)

**Concept: "The Climb Card"**

- **Background:** Dark slate (#1a1a2e or a deep cycling-jersey blue) with a subtle blurred elevation profile silhouette spanning the full width.
- **Centre-left:** A single "Cat 1" climb card at ~60% scale — showing the mountain badge, distance (e.g. "12.4 km"), avg grade ("6.2%"), and a small coloured elevation chart strip.
- **Centre-right:** The MapyClimbs icon (mountain + magnifying glass or chart) at 80 px, with the extension name in a bold sans-serif.
- **Bottom strip:** A grade-coloured horizontal bar (green → yellow → orange → red) representing a climb's gradient profile — acts as an instantly recognisable "brand mark".
- **Text:** Only the tagline: _"Every climb. Instantly."_ — white, 18 px.
- **Avoid:** Screenshots of actual map content (licencing risk). Use abstract/stylised representations only.

---

### Screenshot 1 — 1280 × 800 px _(most important)_

**"The sidebar in action"**

- Full-width Mapy.com tab in Chrome, light mode.
- A mountain route visible on the map (e.g. Alps or Šumava).
- The MapyClimbs sidebar panel open on the left, showing 3–4 climb cards with category badges (HC, Cat 1, Cat 2) and one expanded elevation chart with the grade-coloured gradient fill visible.
- Two or three numbered map pins visible on the route.
- **Annotation overlay (optional):** Callout arrows pointing to: "Auto-detected climbs", "Grade-coloured chart", "Live map pin".

---

### Screenshot 2 — 1280 × 800 px

**"Route overview strip"**

- Zoom in on the top of the sidebar panel showing the route overview: total distance, total climbing, max grade, and the proportional climb strip.
- The climb strip should be clearly visible — a colour-coded horizontal bar with coloured segments representing where climbs fall along the route.
- **Caption:** _"See the full route at a glance before you ride."_

---

### Screenshot 3 — 1280 × 800 px

**"Climb metrics deep-dive"**

- A single climb card expanded full-width, showing all metrics: distance, elevation gain, avg grade, max grade, VAM, estimated time, Fiéts index, difficulty score, and the category badge.
- The elevation chart below it, fully visible, with the Catmull-Rom curve and grade-colour gradient fill.
- **Caption:** _"VAM, grade, Fiéts index — every metric a cyclist needs."_

---

### Screenshot 4 — 1280 × 800 px _(optional, localization story)_

**"Works in Czech and English"**

- Side-by-side: the panel in English (left) and Czech (right).
- Shows bilingual support as a trust signal for the Czech/Slovak primary audience.

---

## 6. Support the Developer — Template

_Paste at the very end of the Long Description, after the Disclaimer._

```
─────────────────────────────────────
☕ SUPPORT THIS PROJECT
─────────────────────────────────────

MapyClimbs is free, open source, and ad-free. If it makes your ride planning better,
consider supporting continued development:

  👉 https://buymeacoffee.com/frantisek.sikula

Source code and issue tracker:
  👉 https://github.com/Kooozel/MapyClimbs.git

Thank you for riding with MapyClimbs.
```

---

## 7. Reviewer Notes (upload as a separate PDF or text file)

_This is submitted in the "Notes for reviewer" field or as an attached document._

```
NOTES FOR THE GOOGLE REVIEW TEAM
Extension: MapyClimbs v1.0.0

WHAT DOES THIS EXTENSION DO?
MapyClimbs analyzes cycling route data (GPX files) exported by the Mapy.com
route-planning service and renders a climb analysis panel directly inside the
Mapy.com tab. It does not alter, redirect, or interfere with any Mapy.com
functionality; it only adds a read-only sidebar overlay.

HOW TO REPRODUCE THE CORE FUNCTIONALITY FOR REVIEW:
1. Install the extension (unpacked or from the store).
2. Navigate to https://mapy.com and open the route planner (the bicycle/hiking icon).
3. Plan any route of at least 10 km with elevation change (e.g. search "Lysá hora").
4. Click the blue "Analyze with MapyClimbs" button that appears in the sidebar.
5. The extension will capture the GPX, analyze it, and inject climb cards and
   map pins within 1–2 seconds.

PERMISSION JUSTIFICATION SUMMARY:
- storage: local-only caching of GPX and analysis results (no sync, no remote write).
- host_permissions (mapy.com): required to inject content scripts and
  intercept the page's own GPX export XHR/fetch calls. Full details in section 2
  of this document (STORE_ASSETS.md).

REMOTE CODE:
The extension executes no remotely hosted code. All logic is bundled at build time
via Vite. The content_security_policy in manifest.json enforces script-src 'self'.

DATA HANDLING:
No user data, personal data, or route data is transmitted outside the browser.
chrome.storage.local is the only storage mechanism used.
```

---

_End of STORE_ASSETS.md_
