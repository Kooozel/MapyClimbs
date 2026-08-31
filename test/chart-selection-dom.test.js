// @vitest-environment happy-dom
/**
 * test/chart-selection-dom.test.js
 *
 * Interaction tests for `attachChartSelection` — the stateful half of
 * `src/content/chart-selection.ts`, driven with synthetic pointer events.
 *
 * These exist because the gesture bugs live in the state machine, not the
 * maths: whether a press counts as a drag, whether the trailing click reaches
 * the card (which centres the map), and whether one card's selection clears
 * another's. None of that is reachable from the pure unit tests.
 *
 * Run: npm test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { generateElevationChart } from '../src/content/chart.ts';
import { attachChartSelection } from '../src/content/chart-selection.ts';

// ── Harness ──────────────────────────────────────────────────────────────────

/** The rendered chart box, in the CSS pixels the pointer maths reads back. */
const SVG_RECT = { left: 100, top: 50, right: 540, bottom: 170, width: 440, height: 120 };
/** Plot area spans viewBox x 42..428, which at width 440 is CSS x 142..528. */
const PLOT_LEFT = SVG_RECT.left + 42;
const PLOT_RIGHT = SVG_RECT.left + 428;

const TOTAL = 1000;
const PROFILE = [
  { distance: 0, elevation: 200, gradient: 0 },
  { distance: 500, elevation: 220, gradient: 4 },
  { distance: 1000, elevation: 300, gradient: 16 },
];

/** clientX for a fraction along the climb. */
function xAt(fraction) {
  return PLOT_LEFT + fraction * (PLOT_RIGHT - PLOT_LEFT);
}

/**
 * Builds a card that mirrors what buildClimbCard ships: the chart markup plus
 * a click handler standing in for the map-centring one.
 */
function makeCard() {
  const card = document.createElement('div');
  card.className = 'climb-item';
  card.innerHTML = generateElevationChart(PROFILE, TOTAL);
  document.body.appendChild(card);

  const svg = card.querySelector('.profile-svg');
  svg.getBoundingClientRect = () => SVG_RECT;
  // happy-dom has no pointer capture; the module only needs these to be safe.
  svg.setPointerCapture = () => {};
  svg.releasePointerCapture = () => {};
  svg.hasPointerCapture = () => false;

  const cardClicks = [];
  card.addEventListener('click', () => cardClicks.push(1));

  attachChartSelection(card, PROFILE, TOTAL);

  return {
    card,
    svg,
    cardClicks,
    legend: card.querySelector('.climb-legend'),
    readout: card.querySelector('.climb-selection'),
    selGroup: card.querySelector('.chart-sel'),
    get selected() {
      return !card.querySelector('.climb-selection').hidden;
    },
    get text() {
      return card.querySelector('.climb-selection').textContent.trim();
    },
  };
}

/** Dispatches one pointer event at clientX on the chart. */
function pointer(svg, type, clientX) {
  const event = new window.Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { clientX, clientY: 110, button: 0, pointerId: 1 });
  svg.dispatchEvent(event);
}

/** A full press-move-release gesture between two fractions of the climb. */
function drag(harness, fromFraction, toFraction) {
  pointer(harness.svg, 'pointerdown', xAt(fromFraction));
  pointer(harness.svg, 'pointermove', xAt(toFraction));
  pointer(harness.svg, 'pointerup', xAt(toFraction));
  // The browser follows a gesture with a click on the card.
  harness.card.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));
}

/** A press and release with no travel — a plain click. */
function click(harness, fraction) {
  pointer(harness.svg, 'pointerdown', xAt(fraction));
  pointer(harness.svg, 'pointermove', xAt(fraction));
  pointer(harness.svg, 'pointerup', xAt(fraction));
  harness.card.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));
}

beforeEach(() => {
  document.body.innerHTML = '';
  globalThis.chrome = { i18n: { getMessage: (key) => key } };
});

// ── Gestures ─────────────────────────────────────────────────────────────────

describe('attachChartSelection', () => {
  it('shows a selection after a drag, swapping out the legend', () => {
    const h = makeCard();
    expect(h.selected).toBe(false);
    expect(h.legend.hidden).toBe(false);

    drag(h, 0.2, 0.7);

    expect(h.selected).toBe(true);
    expect(h.legend.hidden).toBe(true);
    // 20%–70% of a 1000 m climb = 500 m.
    expect(h.text).toContain('500 m');
  });

  it('swallows the click that follows a drag, so the map does not re-centre', () => {
    const h = makeCard();
    drag(h, 0.2, 0.7);
    expect(h.cardClicks).toHaveLength(0);
  });

  it('lets a plain click through to the card', () => {
    const h = makeCard();
    click(h, 0.5);
    expect(h.cardClicks).toHaveLength(1);
    expect(h.selected).toBe(false);
  });

  it('ignores a press that travels less than the drag threshold', () => {
    const h = makeCard();
    pointer(h.svg, 'pointerdown', 300);
    pointer(h.svg, 'pointermove', 302);
    pointer(h.svg, 'pointerup', 302);
    h.card.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));

    expect(h.selected).toBe(false);
    expect(h.cardClicks).toHaveLength(1);
  });

  // Regression: `hasSelection` once doubled as "this gesture passed the drag
  // threshold", so a click on a chart that already had a selection was read as
  // a drag — it replaced the range with a zero-length one and ate the click.
  it('clears the selection on a plain click and still reaches the card', () => {
    const h = makeCard();
    drag(h, 0.2, 0.7);
    expect(h.selected).toBe(true);

    click(h, 0.5);

    expect(h.selected).toBe(false);
    expect(h.legend.hidden).toBe(false);
    expect(h.text).toBe('');
    expect(h.cardClicks).toHaveLength(1);
  });

  it('measures a fresh range when dragging over an existing selection', () => {
    const h = makeCard();
    drag(h, 0.1, 0.9);
    expect(h.text).toContain('800 m');

    drag(h, 0.4, 0.6);
    expect(h.text).toContain('200 m');
  });

  it('reports the same range whichever way the drag runs', () => {
    const a = makeCard();
    drag(a, 0.25, 0.75);
    const forwards = a.text;

    document.body.innerHTML = '';
    const b = makeCard();
    drag(b, 0.75, 0.25);

    expect(b.text).toBe(forwards);
  });

  // ── Clearing ───────────────────────────────────────────────────────────────

  it('clears on Escape', () => {
    const h = makeCard();
    drag(h, 0.2, 0.7);

    document.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );

    expect(h.selected).toBe(false);
    expect(h.legend.hidden).toBe(false);
  });

  it('clears from the readout button without reaching the card', () => {
    const h = makeCard();
    drag(h, 0.2, 0.7);

    h.readout.querySelector('.csel-clear').dispatchEvent(
      new window.Event('click', { bubbles: true, cancelable: true })
    );

    expect(h.selected).toBe(false);
    expect(h.cardClicks).toHaveLength(0);
  });

  it('keeps only one selection across cards', () => {
    const first = makeCard();
    const second = makeCard();

    drag(first, 0.2, 0.7);
    expect(first.selected).toBe(true);

    drag(second, 0.3, 0.6);

    expect(second.selected).toBe(true);
    expect(first.selected).toBe(false);
    expect(first.legend.hidden).toBe(false);
  });

  it('does nothing on a card whose chart could not be rendered', () => {
    const card = document.createElement('div');
    card.innerHTML = '<div class="climb-stats"></div>';
    expect(() => attachChartSelection(card, PROFILE, TOTAL)).not.toThrow();
  });
});
