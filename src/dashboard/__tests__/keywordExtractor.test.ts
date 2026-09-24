import { describe, it, expect } from 'vitest';
import {
  extractKeywords,
  splitTextWithoutSegmenter,
  DEFAULT_MIN_KEYWORD_LENGTH,
  MAX_KEYWORD_LENGTH,
} from '../keywordExtractor.js';
import { MAX_TAGS_PER_RECORD } from '../../utils/computeLimits.js';

describe('keywordExtractor — EN segmentation and filters', () => {
  it('extracts lowercased keywords from plain English text', () => {
    const keywords = extractKeywords('Machine learning is fun');
    expect(keywords).toContain('machine');
    expect(keywords).toContain('learning');
    expect(keywords).toContain('fun');
  });

  it('normalizes case for Latin tokens', () => {
    const keywords = extractKeywords('TensorFlow and PyTorch');
    expect(keywords).toContain('tensorflow');
    expect(keywords).toContain('pytorch');
  });

  it('drops punctuation-only segments', () => {
    expect(extractKeywords('Hello, world! (test) ...')).toEqual(['hello', 'world', 'test']);
  });

  it('excludes stopwords', () => {
    expect(extractKeywords('The quick brown fox and the lazy dog')).not.toContain('the');
    expect(extractKeywords('The quick brown fox and the lazy dog')).not.toContain('and');
    expect(extractKeywords('This is a test of the system')).toEqual(['test', 'system']);
  });

  it('excludes numeric-only tokens but keeps alphanumeric ones', () => {
    const keywords = extractKeywords('2026 42abc abc42 release');
    expect(keywords).not.toContain('2026');
    expect(keywords).toContain('abc42');
    expect(keywords).toContain('42abc');
  });

  it('excludes tokens below the minimum length (single letters, single CJK chars)', () => {
    expect(extractKeywords('a I 私 見')).toEqual([]);
    expect(extractKeywords('ab AI 見る')).toEqual(['ab', 'ai', '見る']);
  });

  it('honors a custom minLength', () => {
    expect(extractKeywords('ab abc abcd', { minLength: 3 })).toEqual(['abc', 'abcd']);
    expect(DEFAULT_MIN_KEYWORD_LENGTH).toBe(2);
  });
});

describe('keywordExtractor — JA segmentation and filters', () => {
  it('extracts multi-char JA words and drops 1-char kana particles', () => {
    const keywords = extractKeywords('私は機械学習について書いた');
    // The exact segmentation may vary across ICU versions; assert properties.
    for (const keyword of keywords) {
      expect(Array.from(keyword).length).toBeGreaterThanOrEqual(DEFAULT_MIN_KEYWORD_LENGTH);
    }
    expect(keywords).not.toContain('は');
    expect(keywords).not.toContain('私');
  });

  it('keeps JA content keywords from mixed JA/EN text', () => {
    const keywords = extractKeywords('機械学習の論文を読んだ Machine learning papers');
    expect(keywords).toContain('machine');
    expect(keywords).toContain('learning');
    // 機械学習 segments into JA words (1+ tokens); all must survive the filters.
    const jaKeywords = keywords.filter((k) => !/[a-z]/.test(k));
    expect(jaKeywords.length).toBeGreaterThan(0);
    for (const keyword of jaKeywords) {
      expect(keyword).toMatch(/^[\p{L}\p{N}]+$/u);
    }
  });

  it('excludes multi-char JA connective stopwords', () => {
    // について is a listed stopword; でも/しかし too.
    const keywords = extractKeywords('戦略についてでも厳しいしかし成果');
    expect(keywords).not.toContain('について');
  });
});

describe('keywordExtractor — caps and determinism', () => {
  it('caps output at MAX_TAGS_PER_RECORD (50) keeping first N in scan order', () => {
    const words = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
    const keywords = extractKeywords(words);
    expect(keywords).toHaveLength(MAX_TAGS_PER_RECORD);
    expect(keywords[0]).toBe('word0');
    expect(keywords[49]).toBe('word49');
  });

  it('dedupes repeated tokens keeping the first occurrence order', () => {
    expect(extractKeywords('rust rust RUST cargo cargo')).toEqual(['rust', 'cargo']);
  });

  it('is deterministic for the same input', () => {
    const text = '機械学習と自然言語処理 Machine learning and natural language processing 2026';
    expect(extractKeywords(text)).toEqual(extractKeywords(text));
  });

  it('honors a custom maxKeywords below the default cap', () => {
    const words = Array.from({ length: 10 }, (_, i) => `word${i}`).join(' ');
    expect(extractKeywords(words, { maxKeywords: 3 })).toEqual(['word0', 'word1', 'word2']);
  });
});

describe('keywordExtractor — input safety and fallback', () => {
  it('returns [] for empty input', () => {
    expect(extractKeywords('')).toEqual([]);
  });

  it('never emits tokens that would break the #kw pseudo-tag pipeline', () => {
    const keywords = extractKeywords('C++ is great, state-of-the-art don\'t node.js "quoted" a|b');
    for (const keyword of keywords) {
      expect(keyword).toMatch(/^[\p{L}\p{N}]+$/u);
      expect(keyword).not.toContain('#');
      expect(keyword).not.toContain('|');
      expect(keyword).not.toMatch(/\s/);
    }
  });

  it('rejects glued or oversized tokens via the max-length guard (fallback path)', () => {
    expect(MAX_KEYWORD_LENGTH).toBeGreaterThan(0);
    const glued = 'あ'.repeat(40);
    // With the real segmenter the JA dictionary may split the run into short
    // words; the oversized-token guard only applies to undivided tokens.
    expect(splitTextWithoutSegmenter(glued)).toEqual([glued]);
    expect(extractKeywords(glued, { segment: splitTextWithoutSegmenter })).toEqual([]);
  });

  it('fallback splitter produces whitespace/punctuation-free letter-digit tokens', () => {
    expect(splitTextWithoutSegmenter('Hello, world! 機械学習 2026')).toEqual([
      'Hello',
      'world',
      '機械学習',
      '2026',
    ]);
    expect(splitTextWithoutSegmenter('   ')).toEqual([]);
  });

  it('uses the fallback splitter when no Intl.Segmenter is available', () => {
    const keywords = extractKeywords('Alpha beta gamma', { segment: splitTextWithoutSegmenter });
    expect(keywords).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('routes through the segment override (fallback behavior parity)', () => {
    const keywords = extractKeywords('Stop words gone content kept', {
      segment: (text) => text.split(/\s+/),
    });
    expect(keywords).toEqual(['stop', 'words', 'gone', 'content', 'kept']);
  });
});
