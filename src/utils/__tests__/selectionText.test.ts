/**
 * selectionText.test.ts
 * Pins for the selection-text normalization + cap (PBI 2026-10-31-03).
 *
 * Why pinned here: the selection becomes a record's `content`, so it must go
 * through the same one-line sanitize every Markdown output already uses
 * (markdownFormatter.normalizeSingleLine — U+2028/U+2029/U+0085 line
 * separators + run-of-spaces compression) instead of a private copy, and the
 * 10,000-char cap must hold before the text reaches the pipeline.
 */
import {
  SELECTION_MAX_CHARS,
  SELECTION_CONTENT_ORIGIN,
  normalizeSelectionText,
} from '../selectionText.js';

describe('normalizeSelectionText', () => {
  it('returns short plain text unchanged', () => {
    expect(normalizeSelectionText('これは選択した段落です。')).toBe('これは選択した段落です。');
  });

  it('returns an empty string unchanged', () => {
    expect(normalizeSelectionText('')).toBe('');
  });

  it('collapses runs of spaces into a single space (the canonical sanitize: tabs pass through)', () => {
    // markdownFormatter.normalizeSingleLine compresses U+0020 runs only —
    // that IS the existing sanitize the PBI pins, so tabs survive verbatim.
    expect(normalizeSelectionText('a    b\t\tc   d')).toBe('a b\t\tc d');
  });

  it('replaces U+2028 / U+2029 / U+0085 line separators with a single space', () => {
    expect(normalizeSelectionText('a\u2028b\u2029c\u0085d')).toBe('a b c d');
  });

  it('collapses CR/LF runs together with the Unicode separators', () => {
    expect(normalizeSelectionText('a\r\n\u2028\n\nb')).toBe('a b');
  });

  it('trims leading and trailing whitespace', () => {
    expect(normalizeSelectionText('  leading and trailing  ')).toBe('leading and trailing');
  });

  it(`caps the normalized text at ${SELECTION_MAX_CHARS} characters`, () => {
    const raw = 'x'.repeat(SELECTION_MAX_CHARS + 5000);
    const result = normalizeSelectionText(raw);
    expect(result).toHaveLength(SELECTION_MAX_CHARS);
  });

  it('keeps exactly 10000 characters when the cap is reached', () => {
    const raw = 'あ'.repeat(10001);
    expect(normalizeSelectionText(raw)).toHaveLength(10000);
  });

  it('normalizes before capping so separator runs do not survive the cut', () => {
    // 9999 spaces + a U+2029 + filler: an implementation that slices first
    // would keep separator characters inside the capped result.
    const raw = `${' '.repeat(9999)}\u2029${'y'.repeat(SELECTION_MAX_CHARS)}`;
    const result = normalizeSelectionText(raw);
    expect(result).toHaveLength(SELECTION_MAX_CHARS);
    expect(result).not.toContain('\u2029');
  });
});

describe('SELECTION_MAX_CHARS', () => {
  it('is 10000 (the PBI cap)', () => {
    expect(SELECTION_MAX_CHARS).toBe(10000);
  });
});

describe('SELECTION_CONTENT_ORIGIN', () => {
  it("is 'selection' (the saved-row marker value)", () => {
    expect(SELECTION_CONTENT_ORIGIN).toBe('selection');
  });
});
