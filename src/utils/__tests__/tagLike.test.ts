/**
 * tagLike.test.ts
 * PBI 2026-11-02-02 — canonical SQL-LIKE tag parity for the hoisted
 * predicate. Each case pins one documented LIKE semantic (case fold,
 * comma-as-text, %/_ wildcards) so the background post-hoc filter and the
 * report SQL cannot diverge from the same population.
 */
import { describe, it, expect } from 'vitest';
import { rowMatchesTagLike } from '../tagLike.js';

describe('tagLike', () => {
  describe('rowMatchesTagLike', () => {
    it('matches a substring of the stored tag text (report parity)', () => {
      expect(rowMatchesTagLike('rust, wasm', 'rust')).toBe(true);
      expect(rowMatchesTagLike('rustacean', 'rust')).toBe(true);
      expect(rowMatchesTagLike('trust', 'rust')).toBe(true);
      expect(rowMatchesTagLike('wasm', 'rust')).toBe(false);
    });

    it('folds ASCII case like SQL LIKE', () => {
      expect(rowMatchesTagLike('研究 AI tools', 'AI')).toBe(true);
      expect(rowMatchesTagLike('研究 ai tools', 'AI')).toBe(true);
      expect(rowMatchesTagLike('AI tools', 'ai')).toBe(true);
    });

    it('treats commas as text, not separators', () => {
      expect(rowMatchesTagLike('x, a,b, y', 'a,b')).toBe(true);
      expect(rowMatchesTagLike('大学 入試', '大学入試')).toBe(false);
      expect(rowMatchesTagLike('筑波大学の入試', '筑波大学')).toBe(true);
    });

    it('treats % and _ as SQL LIKE wildcards', () => {
      expect(rowMatchesTagLike('axxb', 'a%b')).toBe(true);
      expect(rowMatchesTagLike('a.b', 'a_b')).toBe(true);
      expect(rowMatchesTagLike('axb', 'a%b')).toBe(true);
    });

    it('escapes regex metacharacters outside the LIKE wildcards', () => {
      expect(rowMatchesTagLike('a.b', 'a.b')).toBe(true);
      expect(rowMatchesTagLike('axb', 'a.b')).toBe(false);
      expect(rowMatchesTagLike('C++入門', 'C++')).toBe(true);
    });

    it('never matches unset tags or a blank filter', () => {
      expect(rowMatchesTagLike(null, 'rust')).toBe(false);
      expect(rowMatchesTagLike(undefined, 'rust')).toBe(false);
      expect(rowMatchesTagLike('rust', '')).toBe(false);
      expect(rowMatchesTagLike('', '')).toBe(false);
    });
  });
});
