/**
 * injected/smap-capture.ts
 * Hooks into the Mapy.cz SMap constructor to capture the live map instance,
 * making it available for marker injection.
 */

import type { SMapInstance, SMapConstructorStatic } from "../smap.types";

let _smapRef: SMapConstructorStatic | null = null;
let _smapPoll: ReturnType<typeof setInterval> | null = null;

export function getSmapRef(): SMapConstructorStatic | null {
  return _smapRef;
}

function isDuckTypedSMap(v: unknown): v is SMapInstance {
  return (
    v !== null &&
    typeof v === "object" &&
    typeof (v as Record<string, unknown>)["addLayer"] === "function" &&
    typeof (v as Record<string, unknown>)["getCenter"] === "function"
  );
}

function captureInstance(inst: unknown): void {
  if (!window.__climbMap && isDuckTypedSMap(inst)) {
    window.__climbMap = inst;
    if (_smapPoll !== null) clearInterval(_smapPoll);
  }
}

export function applySMapHooks(S: SMapConstructorStatic): void {
  if (!S || S._climbHooked) return;
  S._climbHooked = true;
  _smapRef = S;

  const hookMethods = [
    "$constructor",
    "addLayer",
    "setCenter",
    "getCenter",
    "addDefaultLayer",
    "lock",
    "unlock",
    "redraw",
  ];
  const proto = S.prototype;
  hookMethods.forEach((name) => {
    if (!proto[name]) return;
    const _orig = proto[name]!;
    proto[name] = function (this: SMapInstance, ...args: unknown[]) {
      captureInstance(this);
      return _orig.apply(this, args);
    };
  });
}

export function discoverMapInstance(): SMapInstance | null {
  if (window.__climbMap) return window.__climbMap;

  for (const key of Object.keys(window)) {
    try {
      const v = (window as unknown as Record<string, unknown>)[key];
      if (isDuckTypedSMap(v)) {
        captureInstance(v);
        return window.__climbMap ?? null;
      }
    } catch {
      // skip inaccessible properties
    }
  }

  const candidates = Array.from(
    document.querySelectorAll('div[id], div[class*="map"], div[class*="Map"]')
  );
  for (const el of candidates) {
    for (const prop of Object.getOwnPropertyNames(el)) {
      try {
        const v = (el as unknown as Record<string, unknown>)[prop];
        if (isDuckTypedSMap(v)) {
          captureInstance(v);
          if (window.__climbMap) return window.__climbMap;
        }
      } catch {
        // skip inaccessible properties
      }
    }
  }

  return null;
}

export function installSmapCapture(): void {
  if (window.SMap) {
    applySMapHooks(window.SMap);
  }

  try {
    let _smapValue: SMapConstructorStatic | undefined = window.SMap;
    Object.defineProperty(window, "SMap", {
      get(): SMapConstructorStatic | undefined {
        return _smapValue;
      },
      set(val: SMapConstructorStatic | undefined): void {
        _smapValue = val;
        if (val) applySMapHooks(val);
      },
      configurable: true,
    });
  } catch {
    // defineProperty failed — fall through to polling
  }

  let _pollCount = 0;
  _smapPoll = setInterval(() => {
    if (window.__climbMap || _pollCount++ > 20) {
      clearInterval(_smapPoll!);
      return;
    }
    const S = window.SMap;
    if (S && !S._climbHooked) applySMapHooks(S);
  }, 500);
}
