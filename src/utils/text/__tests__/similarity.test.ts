import { jaccardSimilarity } from '../similarity.js';
import { toWordSet } from '../tokenizer.js';

describe('similarity', () => {
  describe('jaccardSimilarity', () => {
    it('returns 1 for two empty sets', () => {
      expect(jaccardSimilarity(new Set(), new Set())).toBe(1);
    });

    it('returns 0 when one set is empty', () => {
      expect(jaccardSimilarity(new Set(['a']), new Set())).toBe(0);
    });

    it('returns 1.0 for identical texts', () => {
      const a = toWordSet('同じ文章');
      const b = toWordSet('同じ文章');
      expect(jaccardSimilarity(a, b)).toBe(1.0);
    });

    it('returns 0.0 for completely different texts', () => {
      const a = toWordSet('あいうえお');
      const b = toWordSet('かきくけこ');
      expect(jaccardSimilarity(a, b)).toBe(0.0);
    });

    it('computes partial overlap', () => {
      const a = new Set(['x', 'y']);
      const b = new Set(['y', 'z']);
      // intersection=1, union=3
      expect(jaccardSimilarity(a, b)).toBeCloseTo(1 / 3);
    });
  });
});
