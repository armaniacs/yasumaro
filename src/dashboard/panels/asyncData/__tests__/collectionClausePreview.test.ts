import { describe, it, expect } from 'vitest';
import { previewClauseCounts } from '../collectionClausePreview.js';

describe('collectionClausePreview', () => {
  describe('previewClauseCounts', () => {
    it('returns per-row counts and merged totals for or', async () => {
      const result = await previewClauseCounts(
        [{ text: 'AI' }, { text: '要約' }],
        'or',
        { countForClause: async (q) => (q.text === 'AI' ? 3 : 2) },
      );
      expect(result.perRow).toEqual([3, 2]);
      expect(result.total).toBeGreaterThan(0);
    });
    it('returns zero total when every row is empty', async () => {
      const result = await previewClauseCounts([{}], 'and', {
        countForClause: async () => 5,
      });
      expect(result).toEqual({ perRow: [0], total: 0 });
    });
    it('excludes structurally empty rows from the and total', async () => {
      const result = await previewClauseCounts([{ text: 'AI' }, {}], 'and', {
        countForClause: async (q) => (q.text === 'AI' ? 3 : 99),
      });
      expect(result.perRow).toEqual([3, 0]);
      expect(result.total).toBe(3);
    });
  });
});
