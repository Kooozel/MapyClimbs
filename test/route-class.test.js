// @vitest-environment happy-dom
/**
 * test/route-class.test.js
 *
 * Unit tests for the alternative-route class helpers in `src/constants.ts`.
 *
 * These exist because the class was once read positionally (`className.split(" ")[0]`)
 * in the page-context interceptor, which is correct only while mapy.com happens to
 * emit `class="alt-1 active"` in that order. Every producer now goes through these
 * helpers, so the order test below is the regression guard for all of them.
 *
 * Run: npm test
 */

import { describe, it, expect } from 'vitest';
import { DEFAULT_ROUTE_CLASS, routeClassOf, routeClassOrDefault } from '../src/constants.ts';

/** An <h3> route heading carrying `classes`. */
function heading(classes) {
  const el = document.createElement('h3');
  el.className = classes;
  return el;
}

describe('routeClassOf', () => {
  it('finds the alt- class whatever its position', () => {
    expect(routeClassOf(heading('alt-1 active'))).toBe('alt-1');
    expect(routeClassOf(heading('active alt-1'))).toBe('alt-1');
    expect(routeClassOf(heading('active alt-2 highlighted'))).toBe('alt-2');
  });

  it('finds the class when it is the only one', () => {
    expect(routeClassOf(heading('alt-0'))).toBe('alt-0');
  });

  it('returns null when no class starts with alt-', () => {
    expect(routeClassOf(heading('active'))).toBeNull();
    expect(routeClassOf(heading(''))).toBeNull();
  });

  it('returns null for a missing element', () => {
    // The two call sites that branch on "not a route heading" depend on this.
    expect(routeClassOf(null)).toBeNull();
    expect(routeClassOf(undefined)).toBeNull();
  });
});

describe('routeClassOrDefault', () => {
  it('returns the real class when there is one', () => {
    expect(routeClassOrDefault(heading('active alt-3'))).toBe('alt-3');
  });

  it('falls back to alt-0 rather than to undefined', () => {
    // GpxInfo.activeRouteClass is a non-optional string; a producer must never
    // post undefined across the postMessage boundary.
    expect(routeClassOrDefault(heading('active'))).toBe(DEFAULT_ROUTE_CLASS);
    expect(routeClassOrDefault(null)).toBe(DEFAULT_ROUTE_CLASS);
    expect(routeClassOrDefault(undefined)).toBe(DEFAULT_ROUTE_CLASS);
  });
});
