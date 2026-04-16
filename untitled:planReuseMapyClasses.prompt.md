## Plan: Reduce CSS by reusing mapy.com classes

TL;DR - Use actual Mapy component classes for the injected button and panel wrapper where stable, while keeping a small set of own CSS rules for unique extension-specific styling, layout, and overrides.

Steps
1. Inspect the host page and capture actual stable classes:
   - toolbar action button container and button element classes inside `.route-actions`
   - panel/card wrapper classes inside `.route-modules` or `.route-container`
   - any host classes used for cards, headers, rows, labels, and content sections that match the panel structure
2. Decide reuse scope:
   - button injector: adopt host button classes and remove duplicate styling from `src/map-inject.css`
   - panel container: wrap injected panel in existing host card/container classes if the styles are compatible
   - internal extension markup: preserve unique classes only for content not matching host components (route strip, climb stats, charts)
3. Refactor CSS in `src/map-inject.css`:
   - keep unique `#climb-inject-button`, `#climb-inject-panel`, `.cip-*` selectors for extension-specific layout and behavior
   - replace full component styling with targeted overrides of host selectors when using Mapy classes
   - remove unnecessary duplicate styling for buttons and panel wrapper if the host already provides it
4. Update injection code:
   - `src/content/button-injector.ts`: set button wrapper classes to the actual Mapy button class list and preserve the host button construction flow
   - `src/content/panel-template.ts`: apply host wrapper/card classes around the injected content where possible
   - optionally adjust `src/entrypoints/inject.content.ts` if the host injection target or active-state selector needs to rely on more specific Mapy classes
5. Validate and keep fallback stability:
   - ensure unique class/ID prefixes remain for extension-specific behavior and state management
   - do not override global host styles aggressively; use scoped selectors and host-specific class combos
   - if host classes appear unstable, keep the current extension class names and only use host classes for non-critical decorative styling

Relevant files
- `/home/kozel/repo/MapyClimbs/src/map-inject.css` — primary CSS to trim and refactor
- `/home/kozel/repo/MapyClimbs/src/content/button-injector.ts` — button injection and host button matching
- `/home/kozel/repo/MapyClimbs/src/content/panel-template.ts` — panel markup wrapper and optional host class reuse
- `/home/kozel/repo/MapyClimbs/src/entrypoints/inject.content.ts` — injection lifecycle and route planner detection logic

Verification
1. Confirm the actual host `mapy.com` classes for the relevant toolbar and panel nodes.
2. Apply the reduced CSS/refactor locally and test on the mapy route planner page.
3. Verify the injected button still appears in `.route-actions`, the panel still injects into `.route-modules`/`.route-container`, and no host styles are broken.
4. Check that panel open/close and layer toggle behavior remain functional.

Decisions
- Use host classes only for styling and layout that is stable and clearly matches the injected UI.
- Keep extension-specific classes for functionality, targeting, and custom visuals like the climb strip and overlay markers.
- Avoid global page-wide overrides; prefer a minimal scoped set of CSS rules.

Questions for you
- What are the exact classes on the host buttons inside `.route-actions`?
- What wrapper/card classes exist in `.route-modules` or `.route-container` on `mapy.com`?
- Does the host use CSS variables or theme classes for card backgrounds, borders, and text colors?
