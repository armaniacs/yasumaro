
import { normalizeJapaneseSummary } from '../summaryNormalizer.js';

describe('normalizeJapaneseSummary', () => {
  it('returns English text unchanged', () => {
    const input = 'This is an English summary.';
    expect(normalizeJapaneseSummary(input)).toBe(input);
  });

  it('returns an empty string unchanged', () => {
    expect(normalizeJapaneseSummary('')).toBe('');
  });

  it('converts polite -desu endings to plain -da endings', () => {
    const input = 'これは重要な発見です。研究の成果です。';
    const result = normalizeJapaneseSummary(input);
    expect(result).toBe('これは重要な発見だ。研究の成果だ。');
  });

  it('converts polite -deshita endings to plain -datta endings', () => {
    const input = '結果は成功でした。';
    expect(normalizeJapaneseSummary(input)).toBe('結果は成功だった。');
  });

  it('converts polite -teimasu endings to plain -teiru endings', () => {
    const input = '研究が進んでいます。';
    expect(normalizeJapaneseSummary(input)).toBe('研究が進んでいる。');
  });

  it('converts polite -teimashita endings to plain -teita endings', () => {
    const input = '以前は普及していました。';
    expect(normalizeJapaneseSummary(input)).toBe('以前は普及していた。');
  });

  it('converts polite -deshou endings to plain -darou endings', () => {
    const input = '今後も続くでしょう。';
    expect(normalizeJapaneseSummary(input)).toBe('今後も続くだろう。');
  });

  it('converts text mixing multiple polite patterns correctly', () => {
    const input = 'この技術は革新的です。普及が進んでいます。将来性があるでしょう。';
    const result = normalizeJapaneseSummary(input);
    expect(result).toBe('この技術は革新的だ。普及が進んでいる。将来性があるだろう。');
  });
});
