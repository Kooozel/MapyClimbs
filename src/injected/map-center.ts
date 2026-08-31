/**
 * injected/map-center.ts — Page-context map centring.
 *
 * Moving the map needs the page's own globals, which a content script cannot
 * reach, so the panel posts a CenterMap message and this listener performs the
 * call. There is no single API that works on both mapy.com builds:
 *
 *   vector (WASM)  Mapy.getComponent("wasm").wasm.setCenterZoom(lon, lat)
 *   raster         Mapy.debugGlobals().Scene._mapProvider.setCenter(coords)
 *
 * `Scene.setCenter` looks like the cross-build answer but is a no-op stub on
 * vector — only `_mapProvider` has a real implementation, and its inner map is
 * null there. Both calls are exact and instant.
 *
 * Two things then differ per build, and both are handled below:
 *
 *   1. Only vector rewrites `x`/`y` in the URL. Since the overlay projects from
 *      the URL (`viewportFromURL`), this module writes those two params itself
 *      on both builds, which keeps them on one code path.
 *   2. Only vector redraws the planned route. See `nudgeMap`.
 */

import { PageMessage } from "../constants";

/** Decimal places mapy.com itself writes for the `x`/`y` query params. */
const COORD_PRECISION = 7;

/**
 * Nudge geometry. The travel must clear SMap's click threshold, or the gesture
 * is classified as a click on whatever sits under the map centre — which, right
 * after centring on a summit, is the planned route itself.
 */
const NUDGE_PX = 12;
const NUDGE_STEPS = 4;
const NUDGE_STEP_MS = 25;
/** Hold at the origin before releasing, so no pan velocity is left to coast on. */
const NUDGE_HOLD_MS = 150;
/** Let the redrawn geometry land before telling the content script we are done. */
const NUDGE_SETTLE_MS = 150;

type MapBuild = "vector" | "raster";

interface CenterMapMessage {
  type: string;
  lat: number;
  lon: number;
  climbIndex: number;
}

export function installMapCenterListener(): void {
  window.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data as Partial<CenterMapMessage> | null;
    if (data?.type !== PageMessage.CenterMap) return;
    if (typeof data.lat !== "number" || typeof data.lon !== "number") return;

    const build = centerMap(data.lat, data.lon);
    if (!build) return;
    syncViewportURL(data.lat, data.lon);

    const settled = build === "raster" ? reviveRasterRoute(data.lat, data.lon) : Promise.resolve();
    void settled.then(() => {
      window.postMessage(
        { type: PageMessage.CenterMapDone, climbIndex: data.climbIndex },
        location.origin
      );
    });
  });
}

/**
 * Centre the map on whichever build is running, returning which one acted.
 * Null means neither API is reachable, in which case the caller leaves the URL
 * alone and the click degrades to just highlighting the climb.
 *
 * Resolved per call, not once at install time: this script runs at
 * `document_start`, long before either map has been created.
 */
function centerMap(lat: number, lon: number): MapBuild | null {
  if (centerVector(lat, lon)) return "vector";
  if (centerRaster(lat, lon)) return "raster";
  return null;
}

function centerVector(lat: number, lon: number): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wasm = (window as any).Mapy?.getComponent?.("wasm")?.wasm;
    if (typeof wasm?.setCenterZoom !== "function") return false;
    // Note the argument order: lon first, matching the engine's x/y convention.
    wasm.setCenterZoom(lon, lat);
    return true;
  } catch {
    return false;
  }
}

function centerRaster(lat: number, lon: number): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = window as any;
    const provider = win.Mapy?.debugGlobals?.().Scene?._mapProvider;
    const coords = win.SMap?.Coords;
    if (typeof provider?.setCenter !== "function" || typeof coords?.fromWGS84 !== "function")
      return false;
    // Called on `SMap.Coords`, never detached from it: `fromWGS84` is a static
    // factory that does `new this(...)`, so a bare reference throws
    // "this is not a constructor".
    provider.setCenter(coords.fromWGS84(lon, lat));
    return true;
  } catch {
    return false;
  }
}

/**
 * Bring the raster build's planned route back after the jump, then make sure the
 * centre is exactly where the URL already promises it is.
 *
 * The nudge is a synthetic gesture, so a dropped or coalesced `pointermove` —
 * seen on a busy renderer — can leave the map up to `NUDGE_PX` off. Re-asserting
 * the centre afterwards costs one call and makes the outcome exact either way.
 * The route survives it: it is on screen by then, so nothing culls it again.
 */
async function reviveRasterRoute(lat: number, lon: number): Promise<void> {
  await nudgeMap();
  centerRaster(lat, lon);
}

/**
 * Drag the raster map 12 px and straight back, ending exactly where it started.
 *
 * The raster build culls the planned route's SVG geometry once it scrolls out of
 * view and only rebuilds it from the interactive pan pipeline. So after a jump
 * back from far away the map is correct but the route stays invisible — the bug
 * this whole gesture exists to fix. Nothing else revives it: `redraw()` on the
 * provider or the scene, a `resize` event, `setCenterZoom`, and hand-fired
 * `map-redraw` / `map-pan` signals were all measured as no-ops.
 *
 * Net travel is zero, so the centre is unchanged to float precision, and because
 * the gesture exceeds the click threshold mapy.com reads it as a drag: no click,
 * no POI popup, no waypoint, no change of route alternative.
 *
 * The vector build renders the route in WASM and redraws it by itself, so it
 * never runs this.
 */
async function nudgeMap(): Promise<void> {
  const map = document.querySelector<HTMLElement>("#map");
  // The pan listener sits on an inner layer; events dispatched on `#map` itself
  // are above it and never reach it.
  const target = (map?.firstElementChild as HTMLElement | null) ?? map;
  if (!map || !target) return;

  const box = map.getBoundingClientRect();
  const x = Math.round(box.left + box.width / 2);
  const y = Math.round(box.top + box.height / 2);

  const send = (type: string, offset: number, buttons: number): void => {
    const init = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX: x + offset,
      clientY: y,
      screenX: x + offset,
      screenY: y,
      button: 0,
      buttons,
    };
    // Both families: the raster build listens for mouse events, but sending the
    // pointer pair too keeps one gesture valid if it ever moves to pointers.
    target.dispatchEvent(
      new PointerEvent(type, { ...init, pointerId: 1, pointerType: "mouse", isPrimary: true })
    );
    target.dispatchEvent(new MouseEvent(type.replace("pointer", "mouse"), init));
  };

  send("pointerdown", 0, 1);
  for (let step = 1; step <= NUDGE_STEPS; step++) {
    send("pointermove", (NUDGE_PX * step) / NUDGE_STEPS, 1);
    await wait(NUDGE_STEP_MS);
  }
  for (let step = NUDGE_STEPS - 1; step >= 0; step--) {
    send("pointermove", (NUDGE_PX * step) / NUDGE_STEPS, 1);
    await wait(NUDGE_STEP_MS);
  }
  await wait(NUDGE_HOLD_MS);
  send("pointerup", 0, 0);
  await wait(NUDGE_SETTLE_MS);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Rewrite `x`/`y` in the query string to the new centre.
 *
 * Edits the raw search string rather than round-tripping through `URLSearchParams`,
 * which would re-encode mapy.com's other params (`rc`, `mrp`, `rwp`, …) and risk
 * changing how the app reads its own route back.
 */
function syncViewportURL(lat: number, lon: number): void {
  let search = location.search;
  search = setSearchParam(search, "x", lon.toFixed(COORD_PRECISION));
  search = setSearchParam(search, "y", lat.toFixed(COORD_PRECISION));
  history.replaceState(history.state, "", location.pathname + search + location.hash);
}

function setSearchParam(search: string, key: string, value: string): string {
  const existing = new RegExp(`([?&]${key}=)[^&]*`);
  if (existing.test(search)) return search.replace(existing, `$1${value}`);
  return `${search}${search ? "&" : "?"}${key}=${value}`;
}
