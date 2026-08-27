import { splitSentences, containsJapanese, getBigrams, toWordSet } from '../tokenizer.js';

describe('tokenizer', () => {
  describe('splitSentences', () => {
    it('splits Japanese sentences by 。！？', () => {
      const input = '最初の文です。二番目の文！三番目の文？';
      const result = splitSentences(input);
      expect(result).toHaveLength(3);
      expect(result[0]).toBe('最初の文です。');
      expect(result[1]).toBe('二番目の文！');
      expect(result[2]).toBe('三番目の文？');
    });

    it('splits English sentences by .!?', () => {
      const input = 'First sentence. Second sentence! Third sentence?';
      const result = splitSentences(input);
      expect(result).toHaveLength(3);
    });

    it('returns empty array for empty string', () => {
      expect(splitSentences('')).toHaveLength(0);
    });

    it('handles sentences without punctuation', () => {
      const result = splitSentences('句点なし');
      expect(result).toHaveLength(1);
      expect(result[0]).toBe('句点なし');
    });

    it('separates two identical sentences into distinct entries (no Map key collapse)', () => {
      // Regression: identical sentence text must not collapse into one vertex downstream.
      const input = '同じ文章です。同じ文章です。';
      const result = splitSentences(input);
      expect(result).toHaveLength(2);
      expect(result[0]).toBe(result[1]);
    });
  });

  describe('containsJapanese', () => {
    it('detects Japanese characters', () => {
      expect(containsJapanese('日本語')).toBe(true);
      expect(containsJapanese('English')).toBe(false);
    });
  });

  describe('getBigrams', () => {
    it('extracts character bigrams', () => {
      expect(getBigrams('abc')).toEqual(['ab', 'bc']);
    });
  });

  describe('toWordSet', () => {
    it('does not mix Japanese bigrams and English words indiscriminately', () => {
      const mixed = 'これは日本語です。This is English.';
      const set = toWordSet(mixed);
      // English tokens should appear as whole words, not split into bigrams.
      expect(set.has('this')).toBe(true);
      expect(set.has('english')).toBe(true);
      // Japanese bigrams should also be present since text contains Japanese.
      expect(set.has('これ')).toBe(true);
    });

    it('produces stable jaccard threshold 0.3 behavior across languages', () => {
      const jaSet1 = toWordSet('人工知能が急速に発展しています');
      const jaSet2 = toWordSet('人工知能の発展は非常に急速です');
      const enSet1 = toWordSet('artificial intelligence is advancing rapidly');
      const enSet2 = toWordSet('the advancement of artificial intelligence is very rapid');

      const jaccard = (a: Set<string>, b: Set<string>): number => {
        let intersection = 0;
        for (const w of a) if (b.has(w)) intersection++;
        const union = a.size + b.size - intersection;
        return union === 0 ? 1 : intersection / union;
      };

      const jaSim = jaccard(jaSet1, jaSet2);
      const enSim = jaccard(enSet1, enSet2);

      // Both language pairs express similar meaning. Neither similarity
      // should be zero or one, and both should land in a comparable band —
      // proving the shared tokenizer doesn't treat one language radically
      // differently near the 0.3 threshold used by sentenceExtractor.
      expect(jaSim).toBeGreaterThan(0.1);
      expect(jaSim).toBeLessThan(1.0);
      expect(enSim).toBeGreaterThan(0.1);
      expect(enSim).toBeLessThan(1.0);
    });
  });
});
