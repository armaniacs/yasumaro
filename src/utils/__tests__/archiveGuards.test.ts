import { describe, it, expect } from 'vitest';
import {
  cutoffMsFromLocalDate,
  assertCutoffPair,
  CutoffMismatchError,
  decodeStagingName,
  isHttpUrl,
  isValidStagingName,
  ARCHIVE_STAGING_NAME_RE,
  MAX_ARCHIVE_FILE_BYTES,
  ARCHIVE_FORMAT_VERSION,
} from '../archiveGuards.js';

describe('cutoffMsFromLocalDate', () => {
  it('returns end-of-day (23:59:59.999) in UTC ms for a local date', () => {
    const ms = cutoffMsFromLocalDate('2026-03-31');
    const d = new Date(ms);
    expect(d.getHours()).toBe(23);
    expect(d.getMinutes()).toBe(59);
    expect(d.getSeconds()).toBe(59);
    expect(d.getMilliseconds()).toBe(999);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(2);
    expect(d.getDate()).toBe(31);
  });

  it('rejects non-YYYY-MM-DD formats', () => {
    expect(() => cutoffMsFromLocalDate('2026/03/31')).toThrow();
    expect(() => cutoffMsFromLocalDate('2026-3-31')).toThrow();
    expect(() => cutoffMsFromLocalDate('')).toThrow();
    expect(() => cutoffMsFromLocalDate('9999-99-99')).toThrow();
  });

  it('rejects non-existent calendar dates without Date normalization', () => {
    // "2026-02-30" must NOT normalize to 2026-03-02
    expect(() => cutoffMsFromLocalDate('2026-02-30')).toThrow();
    expect(() => cutoffMsFromLocalDate('2026-13-01')).toThrow();
    expect(() => cutoffMsFromLocalDate('2026-00-10')).toThrow();
  });

  it('rejects dates outside the allowed range (2000-01-01 ~ execution day + 1)', () => {
    expect(() => cutoffMsFromLocalDate('1999-12-31')).toThrow();
    const farFuture = new Date();
    farFuture.setFullYear(farFuture.getFullYear() + 5);
    const y = String(farFuture.getFullYear()).padStart(4, '0');
    expect(() => cutoffMsFromLocalDate(`${y}-01-01`)).toThrow();
  });

  it('accepts today and yesterday (range edges are inclusive-ish)', () => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    expect(() => cutoffMsFromLocalDate(`${y}-${m}-${d}`)).not.toThrow();
  });
});

describe('assertCutoffPair (PBI 2026-09-07-21 seam)', () => {
  it('returns the derived ms for a matching pair', () => {
    const date = '2026-03-31';
    const expected = cutoffMsFromLocalDate(date);
    expect(assertCutoffPair(date, expected)).toBe(expected);
  });

  it('throws CutoffMismatchError with the expectation for a forged pair', () => {
    const date = '2026-09-01';
    const expected = cutoffMsFromLocalDate(date);
    const forged = cutoffMsFromLocalDate('2026-08-31');
    expect(forged).not.toBe(expected);
    try {
      assertCutoffPair(date, forged);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(CutoffMismatchError);
      expect((e as Error).message).toContain('does not match cutoffDate');
      // BDD: the message embeds cutoffMsFromLocalDate(cutoffDate)
      expect((e as Error).message).toContain(String(expected));
      expect((e as CutoffMismatchError).expectedMs).toBe(expected);
    }
  });

  it('accepts tomorrow (future tolerance boundary) and rejects far-future dates', () => {
    const fmt = (d: Date): string =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const tomorrowStr = fmt(tomorrow);
    expect(assertCutoffPair(tomorrowStr, cutoffMsFromLocalDate(tomorrowStr))).toBe(
      cutoffMsFromLocalDate(tomorrowStr),
    );
    const farFuture = new Date();
    farFuture.setFullYear(farFuture.getFullYear() + 5);
    const farStr = `${farFuture.getFullYear()}-01-01`;
    expect(() => assertCutoffPair(farStr, Date.now())).toThrow(/out of range/);
  });

  it('accepts past dates within range', () => {
    const date = '2026-03-31';
    expect(() => assertCutoffPair(date, cutoffMsFromLocalDate(date))).not.toThrow();
    expect(() => assertCutoffPair('1999-12-31', 0)).toThrow(/out of range/);
  });

  it('rejects empty / malformed date strings with the derivation error', () => {
    expect(() => assertCutoffPair('', 0)).toThrow(/Invalid archive cutoff date/);
    expect(() => assertCutoffPair('2026-02-30', 0)).toThrow(/Invalid archive cutoff date/);
    expect(() => assertCutoffPair(undefined, 0)).toThrow(/Invalid archive cutoff date/);
  });

  it('rejects non-finite cutoffMs before derivation', () => {
    const date = '2026-03-31';
    expect(() => assertCutoffPair(date, NaN)).toThrow(/finite number/);
    expect(() => assertCutoffPair(date, Infinity)).toThrow(/finite number/);
    expect(() => assertCutoffPair(date, 'x')).toThrow(/finite number/);
    expect(() => assertCutoffPair(date, undefined)).toThrow(/finite number/);
  });
});

describe('decodeStagingName (StagingName brand boundary)', () => {
  const valid = 'archive_outgoing_3f2504e0-4f89-41d3-9a0c-0305e82c3301.db';

  it('decodes a registry-shaped name to the branded type', () => {
    const decoded = decodeStagingName(valid);
    expect(decoded).toBe(valid);
    // Brand is type-level: the value remains a plain string on the wire
    expect(typeof decoded).toBe('string');
  });

  it('throws for yasumaro.db, traversal, empty, and non-string input', () => {
    expect(() => decodeStagingName('yasumaro.db')).toThrow(/Invalid staging name/);
    expect(() => decodeStagingName('../yasumaro.db')).toThrow(/Invalid staging name/);
    expect(() => decodeStagingName('')).toThrow(/Invalid staging name/);
    expect(() => decodeStagingName(undefined)).toThrow(/Invalid staging name/);
    expect(() => decodeStagingName(42)).toThrow(/Invalid staging name/);
  });
});

describe('isHttpUrl', () => {
  it('accepts http and https URLs', () => {
    expect(isHttpUrl('https://example.com/page')).toBe(true);
    expect(isHttpUrl('http://example.com/')).toBe(true);
  });

  it('rejects javascript:, data:, and other schemes', () => {
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpUrl('data:text/html,<script>')).toBe(false);
    expect(isHttpUrl('file:///etc/passwd')).toBe(false);
    expect(isHttpUrl('chrome-extension://abc/panel.html')).toBe(false);
  });

  it('rejects malformed URLs and non-strings', () => {
    expect(isHttpUrl('not a url')).toBe(false);
    expect(isHttpUrl('')).toBe(false);
    expect(isHttpUrl(undefined as unknown as string)).toBe(false);
    expect(isHttpUrl(null as unknown as string)).toBe(false);
  });
});

describe('staging name validation', () => {
  it('accepts offscreen-issued names (36-char nonce)', () => {
    const name = 'archive_outgoing_3f2504e0-4f89-41d3-9a0c-0305e82c3301.db';
    expect(ARCHIVE_STAGING_NAME_RE.test(name)).toBe(true);
    expect(isValidStagingName(name)).toBe(true);
    expect(isValidStagingName('archive_incoming_3f2504e0-4f89-41d3-9a0c-0305e82c3301.db')).toBe(true);
  });

  it('rejects traversal, wrong prefix, and malformed names', () => {
    expect(isValidStagingName('yasumaro.db')).toBe(false);
    expect(isValidStagingName('../yasumaro.db')).toBe(false);
    expect(isValidStagingName('archive_outgoing_short.db')).toBe(false);
    expect(isValidStagingName('archive_malicious_3f2504e0-4f89-41d3-9a0c-0305e82c3301.db')).toBe(false);
    expect(isValidStagingName('')).toBe(false);
  });

  it('exposes the size limit constant (200MB)', () => {
    expect(MAX_ARCHIVE_FILE_BYTES).toBe(200 * 1024 * 1024);
  });

  it('exposes archive format version 1', () => {
    expect(ARCHIVE_FORMAT_VERSION).toBe(1);
  });
});
