// @vitest-environment happy-dom
/**
 * test/panel.test.js
 *
 * The sidebar panel's two terminal states (`src/content/panel.ts`).
 *
 * The regression that motivated this file: a `detectClimbs` throw came back as
 * a valid-but-empty result, so a crash rendered as "No climbs detected" — a
 * confident, wrong statement about the user's route (issue #60). The failure
 * state is now its own builder, and these tests pin the two halves of the
 * decision made there: the failure is *visible* as such, and the exception
 * string behind it is *discoverable* (tooltip, console) without being rendered.
 *
 * Run: npm test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildPanel, buildErrorPanel } from '../src/content/panel.ts';

/** i18n returns the key itself, so assertions read as the key they check. */
function stubChrome() {
  globalThis.chrome = {
    i18n: { getMessage: vi.fn((key) => key) },
    runtime: { getURL: vi.fn((path) => `chrome-extension://test/${path}`) },
    storage: { local: { get: vi.fn((_keys, cb) => cb({})), set: vi.fn() } },
  };
}

const FLAT_RESULT = {
  climbs: [],
  totalDistance: 12000,
  totalElevationGain: 40,
  totalElevationLoss: 40,
  timestamp: 0,
};

describe('buildErrorPanel', () => {
  beforeEach(() => {
    stubChrome();
    vi.spyOn(console, 'error').mockImplementation(() => {}).mockClear();
  });

  it('announces a failure, not an absence of climbs', () => {
    const panel = buildErrorPanel('boom', () => {});

    expect(panel.textContent).toContain('panelErrorTitle');
    expect(panel.textContent).not.toContain('panelNoClimbs');
  });

  it('keeps the exception discoverable without displaying it', () => {
    const panel = buildErrorPanel('boom', () => {});

    // Both halves belong together: either alone would let the design drift into
    // hiding the message entirely, or into printing it in the sidebar.
    expect(panel.querySelector('.cip-error').title).toBe('boom');
    expect(panel.textContent).not.toContain('boom');
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.error.mock.calls[0].join(' ')).toContain('boom');
  });

  it('never lets the exception reach the DOM as markup', () => {
    const panel = buildErrorPanel('<img src=x onerror=1>', () => {});

    // Pins the property-assignment path against a future template interpolation.
    expect(panel.querySelector('img[src="x"]')).toBeNull();
    expect(panel.querySelector('.cip-error').title).toBe('<img src=x onerror=1>');
  });

  it('wires the retry button to the callback', () => {
    const onRetry = vi.fn();
    const panel = buildErrorPanel('boom', onRetry);

    panel.querySelector('.cip-retry').click();

    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('buildPanel', () => {
  beforeEach(stubChrome);

  it('still reports a genuinely flat route as such', () => {
    const panel = buildPanel(FLAT_RESULT);

    expect(panel.textContent).toContain('panelNoClimbs');
    expect(panel.querySelector('.cip-error')).toBeNull();
  });
});
