import { describe, it, expect } from 'vitest';
import { resolveCollectionQueries, mergeClauseResults } from '../collectionScopeResolver.js';

describe('collectionScopeResolver', () => {
  describe('resolveCollectionQueries', () => {
    it('expands each clause to one StorageQuery with day range', () => {
      const out = resolveCollectionQueries({
        version: 2,
        op: 'or',
        clauses: [
          { search: 'AI', tag: 'tools', date: null },
          { search: '', tag: null, date: '2026-11-01' },
        ],
        ids: [],
      });
      expect(out).toHaveLength(2);
      expect(out[0]?.text).toBe('AI');
      expect(out[0]?.tagFilter).toBe('tools');
      expect(out[1]?.dateFrom).toBeGreaterThan(0);
    });
  });
  describe('mergeClauseResults', () => {
    it('unions ids for or and intersects for and', () => {
      expect(mergeClauseResults([[1, 2], [2, 3]], 'or')).toEqual([1, 2, 3]);
      expect(mergeClauseResults([[1, 2], [2, 3]], 'and')).toEqual([2]);
    });
  });
});
