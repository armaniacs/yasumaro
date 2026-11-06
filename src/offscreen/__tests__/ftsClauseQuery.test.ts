import { describe, it, expect } from 'vitest';
import { buildSafeFtsClauseQuery, matchesClausesLike } from '../ftsClauseQuery.js';

describe('ftsClauseQuery', () => {
  describe('buildSafeFtsClauseQuery', () => {
    it('joins sanitized phrases with AND', () => {
      expect(buildSafeFtsClauseQuery(['AI', '要約'], 'and')).toBe('"AI" AND "要約"');
    });
    it('joins sanitized phrases with OR', () => {
      expect(buildSafeFtsClauseQuery(['AI', '要約'], 'or')).toBe('"AI" OR "要約"');
    });
    it('neutralizes operator injection in a term', () => {
      const q = buildSafeFtsClauseQuery(['" OR 1=1 --', 'AI'], 'and');
      expect(q).not.toContain('1=1');
      expect(q).toContain('AND');
    });
    it('drops empty terms instead of emitting invalid MATCH', () => {
      expect(buildSafeFtsClauseQuery(['', '  '], 'and')).toBe('');
    });
  });
  describe('matchesClausesLike', () => {
    it('matches all terms for and and any term for or', () => {
      const haystack = 'AI 要約 ツール';
      expect(matchesClausesLike(haystack, ['AI', '要約'], 'and')).toBe(true);
      expect(matchesClausesLike(haystack, ['AI', '欠落語'], 'and')).toBe(false);
      expect(matchesClausesLike(haystack, ['欠落語', '要約'], 'or')).toBe(true);
    });
    it('ignores empty terms and empty haystacks safely', () => {
      expect(matchesClausesLike('', ['AI'], 'or')).toBe(false);
      expect(matchesClausesLike('AI 要約', ['', '  '], 'or')).toBe(false);
    });
  });
});
