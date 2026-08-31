// @vitest-environment happy-dom
/**
 * test/map-center.test.js
 *
 * Click-to-center, both halves of the postMessage hop:
 *   - `src/content/map-center.ts`  — works out which coordinate to ask for
 *   - `src/injected/map-center.ts` — performs the page-context map call
 *
 * The injected half is the fragile one: it drives two different, undocumented
 * mapy.com APIs (vector WASM vs. raster SMap) and has to stay a silent no-op
 * when neither is reachable, so both builds and the absent case are stubbed here.
 *
 * Run: npm test
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { requestMapCenter } from '../src/content/map-center.ts';
import { installMapCenterListener } from '../src/injected/map-center.ts';
import { PageMessage } from '../src/constants.ts';
import { worldSize } from '../src/map-geometry.ts';

// happy-dom's postMessage does not populate `event.source`, which both listeners
// check, so page messages are delivered as an explicit MessageEvent.
function post(data, { source = window, origin = location.origin } = {}) {
  window.dispatchEvent(new MessageEvent('message', { data, source, origin }));
}

/** `window.postMessage` is delivered on a later task, so replies need a turn. */
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Upper bound for the raster nudge, which runs its stepped gesture out and back
 * on real timers. Vector answers on the next task, so only raster gets near this.
 */
const NUDGE_BUDGET_MS = 1200;

/**
 * Collect page messages of `type` posted while `run` settles, stopping as soon
 * as one is accepted rather than burning the whole budget on every request.
 */
async function collect(type, run, settleMs = 0, accept = () => true) {
  const seen = [];
  const listener = (e) => {
    if (e.data?.type === type && accept(e.data)) seen.push(e.data);
  };
  window.addEventListener('message', listener);
  const result = run();
  for (let waited = 0; waited <= settleMs && !seen.length; waited += 10) await tick(10);
  window.removeEventListener('message', listener);
  return { result, seen };
}

/**
 * Distinct climb index per request. A raster reply only lands once its nudge has
 * run, which outlives the test that asked for it, so replies are matched by index
 * rather than by whatever happens to arrive during the window.
 */
let nextClimbIndex = 100;

function setURL(search) {
  history.replaceState({}, '', `/en/turisticka${search}`);
}

/** happy-dom reports 0x0 for every element, so stub the boxes explicitly. */
function addBox(id, { left, width }) {
  const el = document.createElement('div');
  el.id = id;
  el.getBoundingClientRect = () => ({
    left, top: 0, width, height: 865, right: left + width, bottom: 865, x: left, y: 0,
  });
  document.body.appendChild(el);
  return el;
}

describe('requestMapCenter (content half)', () => {
  beforeEach(() => {
    setURL('?x=15.6&y=50.72&z=12');
    addBox('scene', { left: 0, width: 1520 });
    addBox('layout-body', { left: 1520, width: 390 });
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  async function captureRequest(coords, index = 0) {
    const { result, seen } = await collect(PageMessage.CenterMap, () =>
      requestMapCenter(coords, index)
    );
    return { sent: result, message: seen[0] };
  }

  it('asks the page to centre on the climb, carrying the climb index through', async () => {
    const { sent, message } = await captureRequest({ lat: 50.7437, lon: 15.8052 }, 2);
    expect(sent).toBe(true);
    expect(message.type).toBe(PageMessage.CenterMap);
    expect(message.lat).toBe(50.7437);
    expect(message.climbIndex).toBe(2);
  });

  it('requests the climb coordinate unchanged while the sidebar sits beside the map', async () => {
    const { message } = await captureRequest({ lat: 50.7437, lon: 15.8052 });
    expect(message.lon).toBeCloseTo(15.8052, 12);
  });

  it('shifts the requested centre east when the sidebar covers the right of the map', async () => {
    document.body.innerHTML = '';
    addBox('scene', { left: 0, width: 1520 });
    addBox('layout-body', { left: 1240, width: 390 }); // 280 px overlap → 140 px shift
    const { message } = await captureRequest({ lat: 50.7437, lon: 15.8052 });

    // 140 px right of centre, expressed in degrees of longitude at z=12.
    expect(message.lon).toBeCloseTo(15.8052 + (140 * 360) / worldSize(12), 12);
  });

  it('does nothing for a climb with no coordinates', async () => {
    expect((await captureRequest(null)).sent).toBe(false);
  });

  it('does nothing when the URL carries no viewport', async () => {
    setURL('?planovani-trasy');
    expect((await captureRequest({ lat: 50.7437, lon: 15.8052 })).sent).toBe(false);
  });

  it('does nothing before the map container exists', async () => {
    document.body.innerHTML = '';
    expect((await captureRequest({ lat: 50.7437, lon: 15.8052 })).sent).toBe(false);
  });
});

describe('installMapCenterListener (page half)', () => {
  // Installed once: the listener has no teardown, so re-installing per test
  // would centre the map several times per request.
  beforeAll(() => installMapCenterListener());

  beforeEach(() => {
    setURL('?planovani-trasy&rc=9jUfIx1dqx&x=15.6000000&y=50.7200000&z=12&mrp=%7B%22c%22%3A121%7D');
  });

  afterEach(() => {
    delete window.Mapy;
    delete window.SMap;
  });

  /** Dispatch a centre request and return the CenterMapDone replies it drew. */
  async function request(lat, lon, climbIndex = nextClimbIndex++, postOptions, settleMs = 50) {
    const { seen } = await collect(
      PageMessage.CenterMapDone,
      () => post({ type: PageMessage.CenterMap, lat, lon, climbIndex }, postOptions),
      settleMs,
      (data) => data.climbIndex === climbIndex
    );
    return seen;
  }

  function stubVector() {
    const setCenterZoom = vi.fn();
    window.Mapy = { getComponent: (name) => (name === 'wasm' ? { wasm: { setCenterZoom } } : null) };
    return setCenterZoom;
  }

  /**
   * `SMap.Coords.fromWGS84` is a static factory that does `new this(...)`, so the
   * stub is deliberately `this`-sensitive: an arrow function would happily accept
   * a detached `const f = SMap.Coords.fromWGS84`, which throws on the real page.
   */
  function stubRaster() {
    const setCenter = vi.fn();
    window.Mapy = { debugGlobals: () => ({ Scene: { _mapProvider: { setCenter } } }) };
    function Coords(lon, lat) {
      this.lon = lon;
      this.lat = lat;
    }
    Coords.fromWGS84 = function (lon, lat) {
      return new this(lon, lat);
    };
    window.SMap = { Coords };
    return setCenter;
  }

  it('drives the vector build with lon first, matching the engine x/y convention', async () => {
    const setCenterZoom = stubVector();
    await request(50.0874, 14.4212);
    expect(setCenterZoom).toHaveBeenCalledWith(14.4212, 50.0874);
  });

  it('drives the raster build through SMap.Coords.fromWGS84', async () => {
    const setCenter = stubRaster();
    await request(50.0874, 14.4212, nextClimbIndex++, undefined, NUDGE_BUDGET_MS);
    expect(setCenter).toHaveBeenCalled();
    expect(setCenter.mock.calls[0][0]).toMatchObject({ lon: 14.4212, lat: 50.0874 });
    // Built by the real factory, i.e. called on SMap.Coords rather than detached.
    expect(setCenter.mock.calls[0][0]).toBeInstanceOf(window.SMap.Coords);
  });

  it('prefers the vector API when a page somehow exposes both', async () => {
    const setCenterZoom = vi.fn();
    const setCenter = vi.fn();
    window.Mapy = {
      getComponent: () => ({ wasm: { setCenterZoom } }),
      debugGlobals: () => ({ Scene: { _mapProvider: { setCenter } } }),
    };
    window.SMap = { Coords: { fromWGS84: (lon, lat) => ({ lon, lat }) } };
    await request(50.0874, 14.4212);
    expect(setCenterZoom).toHaveBeenCalledOnce();
    expect(setCenter).not.toHaveBeenCalled();
  });

  it('writes the new centre into the URL — the raster build never does', async () => {
    stubRaster();
    await request(50.0874, 14.4212, nextClimbIndex++, undefined, NUDGE_BUDGET_MS);
    const p = new URLSearchParams(location.search);
    expect(p.get('x')).toBe('14.4212000');
    expect(p.get('y')).toBe('50.0874000');
  });

  it('leaves the zoom and every other mapy.com param byte-identical', async () => {
    stubVector();
    const before = location.search;
    await request(50.0874, 14.4212);
    const untouched = (s) => s.replace(/[?&]x=[^&]*/, '').replace(/[?&]y=[^&]*/, '');
    expect(untouched(location.search)).toBe(untouched(before));
    expect(location.search).toContain('mrp=%7B%22c%22%3A121%7D');
    expect(location.search).toContain('z=12');
  });

  it('replaces history rather than pushing, so Back still leaves the planner', async () => {
    stubVector();
    const length = history.length;
    await request(50.0874, 14.4212);
    expect(history.length).toBe(length);
  });

  it('answers with CenterMapDone and the climb index', async () => {
    stubVector();
    expect(await request(50.0874, 14.4212, 3)).toEqual([
      { type: PageMessage.CenterMapDone, climbIndex: 3 },
    ]);
  });

  it('stays silent and leaves the URL alone when neither map API is reachable', async () => {
    const before = location.search;
    expect(await request(50.0874, 14.4212)).toEqual([]);
    expect(location.search).toBe(before);
  });

  it('survives a map API that throws', async () => {
    window.Mapy = {
      getComponent: () => {
        throw new Error('wasm not ready');
      },
    };
    const before = location.search;
    expect(await request(50.0874, 14.4212)).toEqual([]);
    expect(location.search).toBe(before);
  });

  it('ignores messages that are not a centre request', async () => {
    const setCenterZoom = stubVector();
    post({ type: 'GPX_FETCHED', lat: 50, lon: 14 });
    post({ type: PageMessage.CenterMap, lat: 'nope', lon: 14 });
    await tick();
    expect(setCenterZoom).not.toHaveBeenCalled();
  });

  it('ignores messages that did not come from this window', async () => {
    const setCenterZoom = stubVector();
    await request(50.0874, 14.4212, nextClimbIndex++, { source: null });
    expect(setCenterZoom).not.toHaveBeenCalled();
  });

  it('ignores messages from another origin', async () => {
    const setCenterZoom = stubVector();
    await request(50.0874, 14.4212, nextClimbIndex++, { origin: 'https://evil.example' });
    expect(setCenterZoom).not.toHaveBeenCalled();
  });

  describe('the raster nudge', () => {
    /**
     * The raster build culls the planned route's geometry once it scrolls out of
     * view and only rebuilds it from the interactive pan pipeline, so a jump back
     * from far away leaves the route invisible. A net-zero drag revives it.
     */
    function mapWithLayer() {
      const map = document.createElement('div');
      map.id = 'map';
      map.getBoundingClientRect = () => ({
        left: 0, top: 0, width: 1520, height: 865, right: 1520, bottom: 865, x: 0, y: 0,
      });
      const layer = document.createElement('div');
      map.appendChild(layer);
      document.body.appendChild(map);
      const events = [];
      layer.addEventListener('pointerdown', (e) => events.push(['pointerdown', e.clientX]));
      layer.addEventListener('pointermove', (e) => events.push(['pointermove', e.clientX]));
      layer.addEventListener('pointerup', (e) => events.push(['pointerup', e.clientX]));
      layer.addEventListener('mousedown', (e) => events.push(['mousedown', e.clientX]));
      layer.addEventListener('mouseup', (e) => events.push(['mouseup', e.clientX]));
      return { map, layer, events };
    }

    afterEach(() => {
      document.body.innerHTML = '';
    });

    it('drags the map out and straight back, ending exactly where it started', async () => {
      const { events } = mapWithLayer();
      stubRaster();
      await request(50.0874, 14.4212, nextClimbIndex++, undefined, NUDGE_BUDGET_MS);

      const moves = events.filter(([type]) => type === 'pointermove').map(([, x]) => x);
      const down = events.find(([type]) => type === 'pointerdown')[1];
      const up = events.find(([type]) => type === 'pointerup')[1];

      expect(moves.length).toBeGreaterThan(1);
      expect(Math.max(...moves)).toBeGreaterThan(down); // it actually travels
      expect(moves.at(-1)).toBe(down); // and comes all the way back
      expect(up).toBe(down); // released at the origin: zero net pan
    });

    it('travels far enough that mapy.com reads a drag, not a click on the route', async () => {
      const { events } = mapWithLayer();
      stubRaster();
      await request(50.0874, 14.4212, nextClimbIndex++, undefined, NUDGE_BUDGET_MS);

      const xs = events.map(([, x]) => x);
      // Under the click threshold the gesture would open whatever sits under the
      // map centre — right after centring on a summit, the planned route itself.
      expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThanOrEqual(10);
    });

    it('sends the mouse pair too, which is what the raster build listens for', async () => {
      const { events } = mapWithLayer();
      stubRaster();
      await request(50.0874, 14.4212, nextClimbIndex++, undefined, NUDGE_BUDGET_MS);
      expect(events.some(([type]) => type === 'mousedown')).toBe(true);
      expect(events.some(([type]) => type === 'mouseup')).toBe(true);
    });

    it('answers only once the nudge is finished, so the pan mute covers it', async () => {
      const { events } = mapWithLayer();
      stubRaster();
      const done = await request(50.0874, 14.4212, 7, undefined, NUDGE_BUDGET_MS);
      expect(done).toEqual([{ type: PageMessage.CenterMapDone, climbIndex: 7 }]);
      // The reply must not have raced ahead of the gesture.
      expect(events.at(-1)[0]).toBe('mouseup');
    });

    it('re-asserts the centre afterwards, in case a pointermove was dropped', async () => {
      mapWithLayer();
      const setCenter = stubRaster();
      await request(50.0874, 14.4212, nextClimbIndex++, undefined, NUDGE_BUDGET_MS);
      // Once to jump, once after the gesture — both on the same coordinate, so a
      // gesture that does not land pixel-perfect cannot leave the map off-centre.
      expect(setCenter).toHaveBeenCalledTimes(2);
      for (const [coords] of setCenter.mock.calls) {
        expect(coords).toMatchObject({ lon: 14.4212, lat: 50.0874 });
      }
    });

    it('is never run on the vector build, which redraws its route itself', async () => {
      const { events } = mapWithLayer();
      stubVector();
      await request(50.0874, 14.4212, nextClimbIndex++, undefined, NUDGE_BUDGET_MS);
      expect(events).toEqual([]);
    });

    it('still answers when the raster map has no inner layer to nudge', async () => {
      stubRaster();
      expect(await request(50.0874, 14.4212, 8, undefined, NUDGE_BUDGET_MS)).toEqual([
        { type: PageMessage.CenterMapDone, climbIndex: 8 },
      ]);
    });
  });
});
