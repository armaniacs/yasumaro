/**
 * selectionText-batch-d.test.ts — PBI 2026-11-08-17 (item 7) pins.
 *
 * The cap counts Unicode code points, so a cut never splits a surrogate
 * pair into a lone surrogate. Pinned with an emoji (astral plane) straddling
 * the 10000 boundary: the result holds exactly SELECTION_MAX_CHARS
 * characters and contains no unmatched surrogates.
 */
import { describe, it, expect } from 'vitest';
import { SELECTION_MAX_CHARS, normalizeSelectionText } from '../selectionText.js';

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe('normalizeSelectionText surrogate safety (PBI 2026-11-08-17 item 7)', () => {
  it('never splits a surrogate pair at the cap boundary', () => {
    // 9999 BMP chars + emoji (one code point, two UTF-16 units) + filler:
    // a UTF-16 slice(0, 10000) would keep the lead surrogate and drop the
    // trail surrogate; the code-point slice keeps or drops the whole emoji.
    const raw = `${'a'.repeat(SELECTION_MAX_CHARS - 1)}😀${'b'.repeat(100)}`;
    const result = normalizeSelectionText(raw);
    expect([...result]).toHaveLength(SELECTION_MAX_CHARS);
    expect(result).not.toMatch(LONE_SURROGATE);
  });

  it('keeps astral characters intact below the cap', () => {
    const raw = `hello 😀 world 🎉`;
    expect(normalizeSelectionText(raw)).toBe(raw);
  });

  it('still caps BMP text at exactly SELECTION_MAX_CHARS characters', () => {
    const raw = 'x'.repeat(SELECTION_MAX_CHARS + 5000);
    const result = normalizeSelectionText(raw);
    expect([...result]).toHaveLength(SELECTION_MAX_CHARS);
    expect(result).toHaveLength(SELECTION_MAX_CHARS);
  });
});
