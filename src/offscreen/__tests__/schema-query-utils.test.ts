/**
 * schema-query-utils.test.ts
 * M16: sanitizeFtsTerm was duplicated verbatim across sqlite.ts and
 * opfsWorker.ts. It's extracted here as the common, backend-agnostic part
 * of the CRUD logic (M16 findings note that full Strategy-pattern
 * unification isn't practical since the two backends use different async
 * execution models, and their ALLOWED_ORDER_COLUMNS lists actually differ
 * — sqlite.ts allows more columns — so that list stays backend-local).
 */
import { describe, it, expect } from 'vitest';
import { sanitizeFtsTerm } from '../schema.js';

describe('sanitizeFtsTerm', () => {
  it('returns empty string for falsy input', () => {
    expect(sanitizeFtsTerm('')).toBe('');
  });

  it('strips FTS5 operator keywords and special characters', () => {
    expect(sanitizeFtsTerm('foo* OR "bar"~2')).toBe('foo OR bar 2');
  });

  it('preserves alphanumeric and CJK characters', () => {
    expect(sanitizeFtsTerm('javascript 日本語 テスト')).toBe('javascript 日本語 テスト');
  });

  it('truncates input longer than the max length', () => {
    const longInput = 'a'.repeat(300);
    const result = sanitizeFtsTerm(longInput);
    expect(result.length).toBeLessThanOrEqual(200);
  });

  it('collapses repeated whitespace and trims', () => {
    expect(sanitizeFtsTerm('  foo   bar  ')).toBe('foo bar');
  });
});
