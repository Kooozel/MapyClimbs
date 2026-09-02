/**
 * test/storage.test.js
 *
 * Tab-scoped storage keys (`src/storage.ts`).
 *
 * The regression that motivated this file: `lastAnalysisResult:<tabId>` was used
 * both as an exact key and as a `startsWith` prefix, and without a trailing
 * separator tab 1's prefix matched tab 12's keys — so leaving the route planner
 * in tab 1 wiped the cached analyses of tabs 10-19 (issue #38). The prefix now
 * lives in its own field and always ends in ":".
 *
 * Run: npm test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getTabStorageKeys, clearTabState, saveTabGpx, stampResult } from '../src/storage.ts';

/** Minimal `chrome.storage.local` over a plain object; callbacks fire synchronously. */
function stubStorage(seed = {}) {
  const store = { ...seed };
  const local = {
    get: vi.fn((keys, cb) => {
      if (keys === null) return cb({ ...store });
      const picked = {};
      for (const key of [].concat(keys)) {
        if (key in store) picked[key] = store[key];
      }
      cb(picked);
    }),
    set: vi.fn((items, cb) => {
      Object.assign(store, items);
      cb?.();
    }),
    remove: vi.fn((keys, cb) => {
      for (const key of [].concat(keys)) delete store[key];
      cb?.();
    }),
  };
  globalThis.chrome = { storage: { local }, runtime: {} };
  return { store, local };
}

beforeEach(() => {
  delete globalThis.chrome;
});

describe('getTabStorageKeys', () => {
  it('keeps one tab\'s prefix from matching another tab\'s keys', () => {
    const tab1 = getTabStorageKeys(1);
    const tab12 = getTabStorageKeys(12, 'alt-0');

    expect(tab12.lastAnalysisResult.startsWith(tab1.lastAnalysisResultPrefix)).toBe(false);
    expect(tab1.pendingGPX).not.toBe(tab12.pendingGPX);
    expect(tab1.gpxCaptureTime).not.toBe(tab12.gpxCaptureTime);
  });

  it('matches a tab against its own results, for every route class', () => {
    const { lastAnalysisResultPrefix } = getTabStorageKeys(12);

    expect(lastAnalysisResultPrefix).toBe('lastAnalysisResult:12:');
    for (const routeClass of ['alt-0', 'alt-1', 'alt-10']) {
      const { lastAnalysisResult } = getTabStorageKeys(12, routeClass);
      expect(lastAnalysisResult).toBe(`lastAnalysisResult:12:${routeClass}`);
      expect(lastAnalysisResult.startsWith(lastAnalysisResultPrefix)).toBe(true);
    }
  });
});

describe('clearTabState', () => {
  it('removes only the given tab\'s keys', () => {
    const { store, local } = stubStorage({
      'pendingGPX:1': { gpxContent: '<gpx/>' },
      'gpxCaptureTime:1': 1000,
      'lastAnalysisResult:1:alt-0': { climbs: [] },
      'lastAnalysisResult:1:alt-1': { climbs: [] },
      'pendingGPX:12': { gpxContent: '<gpx/>' },
      'gpxCaptureTime:12': 2000,
      'lastAnalysisResult:12:alt-0': { climbs: [] },
      scoringModel: 'aso',
    });

    clearTabState(1);

    expect(local.remove).toHaveBeenCalledOnce();
    expect(local.remove.mock.calls[0][0].sort()).toEqual([
      'gpxCaptureTime:1',
      'lastAnalysisResult:1:alt-0',
      'lastAnalysisResult:1:alt-1',
      'pendingGPX:1',
    ]);
    expect(Object.keys(store).sort()).toEqual([
      'gpxCaptureTime:12',
      'lastAnalysisResult:12:alt-0',
      'pendingGPX:12',
      'scoringModel',
    ]);
  });

  it('does not call remove when the tab has nothing stored', () => {
    const { local } = stubStorage({ 'pendingGPX:12': { gpxContent: '<gpx/>' } });

    clearTabState(1);

    expect(local.remove).not.toHaveBeenCalled();
  });
});

describe('saveTabGpx', () => {
  it('writes the GPX under the tab-scoped keys, with no route-class suffix', () => {
    const { store } = stubStorage();
    const gpxInfo = { gpxContent: '<gpx/>', activeRouteClass: 'alt-1' };

    saveTabGpx(7, gpxInfo, 1234);

    expect(store).toEqual({ 'pendingGPX:7': gpxInfo, 'gpxCaptureTime:7': 1234 });
  });
});

describe('stampResult', () => {
  /** What detectClimbs returns: no clock, no route mode (#68). */
  const engineResult = {
    climbs: [],
    totalDistance: 100,
    totalElevationGain: 10,
    totalElevationLoss: 5,
  };

  it('adds the timestamp the engine deliberately does not carry', () => {
    const before = Date.now();
    const stamped = stampResult(engineResult);

    expect(stamped.timestamp).toBeGreaterThanOrEqual(before);
    expect(stamped).toMatchObject(engineResult);
  });

  it('omits routeMode entirely when there is none, rather than storing undefined', () => {
    // A stored `routeMode: undefined` reads back as a key that is present but
    // empty, which is not the same shape as a cycling route's result.
    expect('routeMode' in stampResult(engineResult)).toBe(false);
  });

  it('carries routeMode through when the capture had one', () => {
    expect(stampResult(engineResult, 'hiking').routeMode).toBe('hiking');
  });

  it('does not mutate the engine result it stamps', () => {
    stampResult(engineResult, 'hiking');
    expect(engineResult).not.toHaveProperty('timestamp');
    expect(engineResult).not.toHaveProperty('routeMode');
  });
});
