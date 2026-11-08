// @vitest-environment jsdom
/**
 * cleansingOffscreen.estimate.test.ts (review S5)
 * Two-stage size gate: small pages skip the TextEncoder allocation via the
 * O(1) upper bound; near-limit input still gets an exact byte verdict.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  handleCleansingOffscreenPayload,
  estimatedUtf8UpperBound,
  MAX_CLEANSING_HTML_BYTES,
  TOO_LARGE_ERROR_PREFIX,
} from '../cleansingOffscreen.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('handleCleansingOffscreenPayload — two-stage size gate (S5)', () => {
  it('takes the O(1) fast path for a small page (bound within budget)', () => {
    const html = '<p>hello</p>';
    // Fast-path eligibility is decided without encoding: the bound fits.
    expect(estimatedUtf8UpperBound(html.length)).toBeLessThanOrEqual(MAX_CLEANSING_HTML_BYTES);
    const res = handleCleansingOffscreenPayload({ html });
    expect(res.success).toBe(true);
  });

  it('never under-counts: the bound covers astral-heavy input', () => {
    const html = '😀'.repeat(100);
    const exact = new TextEncoder().encode(html).length;
    expect(estimatedUtf8UpperBound(html.length)).toBeGreaterThanOrEqual(exact);
  });

  it('rejects emoji-heavy input over the limit with an exact byte count', () => {
    const emojiCount = Math.floor(MAX_CLEANSING_HTML_BYTES / 4) + 1;
    const html = '😀'.repeat(emojiCount);
    const expectedBytes = new TextEncoder().encode(html).length;
    expect(expectedBytes).toBeGreaterThan(MAX_CLEANSING_HTML_BYTES);
    const res = handleCleansingOffscreenPayload({ html });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.startsWith(TOO_LARGE_ERROR_PREFIX)).toBe(true);
      expect(res.error).toContain(`${expectedBytes} bytes`);
    }
  });

  it('rejects immediately via the lower bound without encoding a huge page (S1)', () => {
    // char length alone already exceeds the byte budget (UTF-8 encodes every
    // unit to at least 1 byte), so the verdict is certain without TextEncoder.
    const encode = vi.spyOn(TextEncoder.prototype, 'encode');
    try {
      const html = 'x'.repeat(MAX_CLEANSING_HTML_BYTES + 1);
      expect(html.length).toBeGreaterThan(MAX_CLEANSING_HTML_BYTES);
      const res = handleCleansingOffscreenPayload({ html });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.startsWith(TOO_LARGE_ERROR_PREFIX)).toBe(true);
        expect(res.error).toContain('exceeds limit');
      }
      expect(encode).not.toHaveBeenCalled();
    } finally {
      encode.mockRestore();
    }
  });

  it('admits input whose exact bytes fit even when the bound exceeds the limit', () => {
    // ASCII at exactly the limit: the O(1) bound (3x) overshoots, but the
    // exact pass proves it fits — admitted, not falsely rejected.
    const html = 'x'.repeat(MAX_CLEANSING_HTML_BYTES);
    const res = handleCleansingOffscreenPayload({ html });
    expect(res.success).toBe(true);
  });
});
