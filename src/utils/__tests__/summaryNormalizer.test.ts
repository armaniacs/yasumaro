import { describe, it, expect } from '@jest/globals';
import { normalizeJapaneseSummary } from '../summaryNormalizer.js';

describe('normalizeJapaneseSummary', () => {
  it('英語テキストはそのまま返す', () => {
    const input = 'This is an English summary.';
    expect(normalizeJapaneseSummary(input)).toBe(input);
  });

  it('空文字列はそのまま返す', () => {
    expect(normalizeJapaneseSummary('')).toBe('');
  });

  it('「〜です。」を「〜だ。」に変換する', () => {
    const input = 'これは重要な発見です。研究の成果です。';
    const result = normalizeJapaneseSummary(input);
    expect(result).toBe('これは重要な発見だ。研究の成果だ。');
  });

  it('「〜でした。」を「〜だった。」に変換する', () => {
    const input = '結果は成功でした。';
    expect(normalizeJapaneseSummary(input)).toBe('結果は成功だった。');
  });

  it('「〜ています。」を「〜ている。」に変換する', () => {
    const input = '研究が進んでいます。';
    expect(normalizeJapaneseSummary(input)).toBe('研究が進んでいる。');
  });

  it('「〜ていました。」を「〜ていた。」に変換する', () => {
    const input = '以前は普及していました。';
    expect(normalizeJapaneseSummary(input)).toBe('以前は普及していた。');
  });

  it('「〜でしょう。」を「〜だろう。」に変換する', () => {
    const input = '今後も続くでしょう。';
    expect(normalizeJapaneseSummary(input)).toBe('今後も続くだろう。');
  });

  it('複数パターンが混在するテキストを正しく変換する', () => {
    const input = 'この技術は革新的です。普及が進んでいます。将来性があるでしょう。';
    const result = normalizeJapaneseSummary(input);
    expect(result).toBe('この技術は革新的だ。普及が進んでいる。将来性があるだろう。');
  });
});
