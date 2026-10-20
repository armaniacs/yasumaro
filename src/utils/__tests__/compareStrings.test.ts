/**
 * compareStrings.test.ts — shared ascending comparator (dashboard aggregation
 * modules import it for Array.prototype.sort).
 *
 * Pins the contract: code-point order (locale-independent), total ordering via
 * -1 / 0 / 1, and sort-safe ascending behaviour. Lightweight unit tests — no
 * golden fixtures.
 */

import { describe, it, expect } from 'vitest';
import { compareStrings } from '../compareStrings.js';

describe('compareStrings — shared ascending comparator', () => {
  it.each([
    ['a', 'b', -1],
    ['b', 'a', 1],
    ['a', 'a', 0],
    ['', '', 0],
    ['', 'a', -1],
    ['a', '', 1],
    ['abc', 'abd', -1],
  ])('compares %o vs %o as %i', (a, b, expected) => {
    expect(compareStrings(a, b)).toBe(expected);
  });

  it('orders by code point, not locale collation', () => {
    // U+005A 'Z' < U+0061 'a' in code points. Locale-aware collation returns
    // the opposite for several locales, so the seam must not depend on one
    // (see the header comment: locale-independent code-point order).
    expect(compareStrings('Z', 'a')).toBe(-1);
    expect(compareStrings('a', 'Z')).toBe(1);
    expect(compareStrings('z', 'あ')).toBe(-1);
  });

  it('sorts an array ascending with equal keys kept adjacent', () => {
    const sorted = ['b', 'A', 'a', '', 'c', 'A'].sort(compareStrings);
    expect(sorted).toEqual(['', 'A', 'A', 'a', 'b', 'c']);
  });

  it('is symmetric: swapping the arguments flips the sign', () => {
    const pairs: Array<[string, string]> = [['alpha', 'beta'], ['b', 'a'], ['x', 'x']];
    for (const [a, b] of pairs) {
      // Plain comparison: Object.is distinguishes +0 from -0, which the
      // comparator must not (equal keys return +0 either way).
      expect(Math.sign(compareStrings(a, b)) === -Math.sign(compareStrings(b, a))).toBe(true);
    }
  });
});
