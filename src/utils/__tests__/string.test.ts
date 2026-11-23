/**
 * string.test.ts
 * Unit tests for src/utils/string.ts (escapeRegExp, moved from cspSettings.ts
 * during PBI-23's static-facade deepening).
 */
import { escapeRegExp, parseIntOr } from '../string.js';

describe('parseIntOr', () => {
  test('parses a valid numeric string', () => {
    expect(parseIntOr('70', 30)).toBe(70);
  });

  test('returns fallback for an empty string', () => {
    expect(parseIntOr('', 30)).toBe(30);
  });

  test('returns fallback for null and undefined', () => {
    expect(parseIntOr(null, 5)).toBe(5);
    expect(parseIntOr(undefined, 5)).toBe(5);
  });

  test('returns fallback for a non-numeric string', () => {
    expect(parseIntOr('abc', 100)).toBe(100);
  });

  test('keeps negative numbers and truncates decimal strings', () => {
    expect(parseIntOr('-12', 1)).toBe(-12);
    expect(parseIntOr('3.9', 1)).toBe(3);
  });

  test('keeps zero instead of falling back', () => {
    expect(parseIntOr('0', 9)).toBe(0);
  });
});

describe('escapeRegExp', () => {
  test('escapes regex special characters', () => {
    expect(escapeRegExp('a.b*c+d?e^f$g{h}i(j)k|l[m]n\\o')).toBe('a\\.b\\*c\\+d\\?e\\^f\\$g\\{h\\}i\\(j\\)k\\|l\\[m\\]n\\\\o');
  });

  test('returns string unchanged when no special characters', () => {
    expect(escapeRegExp('hello-world_123')).toBe('hello-world_123');
  });

  test('handles empty string', () => {
    expect(escapeRegExp('')).toBe('');
  });
});
