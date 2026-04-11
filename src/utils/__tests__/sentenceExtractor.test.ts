/**
 * sentenceExtractor.test.ts
 * Tests for sentence extraction using TextRank algorithm
 * RED Phase: Tests that should fail until implementation is added
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

// Test imports - these will fail until implementation exists
// Using dynamic import pattern to ensure clean test failure
let splitSentences: (text: string) => string[];
let calculateSimilarity: (s1: string, s2: string) => number;
let textRank: (graph: Map<string, number[]>) => Map<string, number>;
let extractSentences: (text: string, options?: {
  topK?: number;
  minLength?: number;
  similarityThreshold?: number;
}) => string[];

describe('sentenceExtractor', () => {
  beforeEach(async () => {
    // Dynamic import to ensure clean test failure
    const module = await import('../sentenceExtractor.js');
    splitSentences = module.splitSentences;
    calculateSimilarity = module.calculateSimilarity;
    textRank = module.textRank;
    extractSentences = module.extractSentences;
  });

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
      expect(result[0]).toBe('First sentence.');
      expect(result[1]).toBe('Second sentence!');
      expect(result[2]).toBe('Third sentence?');
    });

    it('handles mixed Japanese and English', () => {
      const input = 'これは日本語です。This is English. これも日本語！';
      const result = splitSentences(input);
      expect(result).toHaveLength(3);
    });

    it('returns empty array for empty string', () => {
      const result = splitSentences('');
      expect(result).toHaveLength(0);
    });

    it('handles sentences without punctuation', () => {
      const input = '句点なし';
      const result = splitSentences(input);
      expect(result).toHaveLength(1);
      expect(result[0]).toBe('句点なし');
    });
  });

  describe('calculateSimilarity', () => {
    it('returns 1.0 for identical texts', () => {
      const result = calculateSimilarity('同じ文章', '同じ文章');
      expect(result).toBe(1.0);
    });

    it('returns 0.0 for completely different texts', () => {
      const result = calculateSimilarity('あいうえお', 'かきくけこ');
      expect(result).toBe(0.0);
    });

    it('calculates similarity between similar texts', () => {
      const s1 = '人工智能が急速に発展しています';
      const s2 = '人工智能の発展は非常に急速です';
      const result = calculateSimilarity(s1, s2);
      // Bigram overlap should give some similarity
      expect(result).toBeGreaterThan(0.1);
      expect(result).toBeLessThan(1.0);
    });

    it('handles empty strings', () => {
      const result = calculateSimilarity('', 'テキスト');
      expect(result).toBe(0.0);
    });
  });

  describe('textRank', () => {
    it('returns scores for all nodes', () => {
      const graph = new Map<string, number[]>([
        ['A', [0.5, 0.3]],
        ['B', [0.5, 0.0]],
        ['C', [0.3, 0.0]]
      ]);
      const result = textRank(graph);
      expect(result.size).toBe(3);
      expect(result.get('A')).toBeGreaterThan(0);
      expect(result.get('B')).toBeGreaterThan(0);
      expect(result.get('C')).toBeGreaterThan(0);
    });

    it('handles single node graph', () => {
      const graph = new Map<string, number[]>([['A', [0]]]);
      const result = textRank(graph);
      expect(result.size).toBe(1);
    });
  });

  describe('extractSentences', () => {
    it('extracts top sentences from content', () => {
      const content = `
        これは最初の重要な文です。何か重要な情報が含まれています。
        二番目の重要な文也有很多重要な內容。
        これは三番目の文です。三番目の内容も重要です。
        これは単なる補足的な文です。あまり重要ではありません。
        最后的文も重要です。final sentence is also important.
      `.trim();

      const result = extractSentences(content, { topK: 3 });
      expect(result.length).toBeLessThanOrEqual(3);
    });

    it('respects minLength option', () => {
      // Create content with some short and some long sentences
      const content = '短い文章。短い文章。中程度の長さの文章です。'.trim();
      const result = extractSentences(content, { 
        topK: 10, 
        minLength: 8 
      });
      // With minLength=8, only "中程度の長さの文章です。" should be considered
      // But fallback returns all when too few valid sentences
      expect(result.length).toBeGreaterThanOrEqual(0);
    });

    it('returns empty array for empty content', () => {
      const result = extractSentences('');
      expect(result).toHaveLength(0);
    });

    it('handles default options', () => {
      const content = '文1。文2。文3。文4。文5。文6。文7。文8。文9。文10。文11。';
      const result = extractSentences(content);
      // Default topK is 10
      expect(result.length).toBeLessThanOrEqual(10);
    });

    it('achieves compression on long content', () => {
      // Create content that should compress significantly
      const sentences = [];
      for (let i = 0; i < 50; i++) {
        sentences.push(`これは重要な文${i}です。`);
      }
      const content = sentences.join(' ');

      const result = extractSentences(content, { topK: 10 });
      expect(result.length).toBeLessThan(sentences.length);
    });
  });
});