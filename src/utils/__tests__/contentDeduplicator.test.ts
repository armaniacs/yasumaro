import { describe, it, expect } from '@jest/globals';
import { deduplicateContent } from '../contentDeduplicator.js';

describe('deduplicateContent', () => {
  it('重複のないテキストはそのまま返す', () => {
    const input = 'Aについて説明する。Bは異なる概念だ。Cも全く別の話題である。';
    const result = deduplicateContent(input);
    expect(result).toBe(input);
  });

  it('ほぼ同一のセンテンスを除去する', () => {
    const input = 'この製品は高品質です。この製品は高品質で優れています。全く異なる内容のセンテンス。';
    const result = deduplicateContent(input, { threshold: 0.4 });
    // 2文目が1文目と類似しているので除去される
    expect(result).not.toContain('高品質で優れています');
    expect(result).toContain('高品質です');
    expect(result).toContain('全く異なる内容');
  });

  it('空文字列を返すとき空文字列を返す', () => {
    expect(deduplicateContent('')).toBe('');
  });

  it('単一センテンスはそのまま返す', () => {
    const input = 'これは一つのセンテンスです。';
    expect(deduplicateContent(input)).toBe(input);
  });

  it('threshold=0のとき何も除去しない', () => {
    const input = '同じ文章です。同じ文章です。';
    const result = deduplicateContent(input, { threshold: 0 });
    expect(result).toContain('同じ文章です。同じ文章です。');
  });

  it('threshold=1のとき完全一致のみ除去する', () => {
    const a = '同じ文章です。';
    const b = '同じ文章です。';
    const input = a + b;
    const result = deduplicateContent(input, { threshold: 1.0, minLength: 5 });
    // 完全一致なので2文目が除去される
    const count = (result.match(/同じ文章です/g) || []).length;
    expect(count).toBe(1);
  });
});
