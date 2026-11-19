
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

  describe('conversion table coverage', () => {
    // Each input carries the pattern three times: two sentence-medial occurrences
    // terminated by 。 and one bare occurrence at the end of the text, so both
    // match positions of the replacement pair are exercised in a single row.
    it.each([
      ['長年勤めておりました。前の職場でも勤めておりました。今も勤めておりました', '長年勤めておる。前の職場でも勤めておる。今も勤めておる'],
      ['以前は普及していました。近年も普及していました。いまも普及していました', '以前は普及していた。近年も普及していた。いまも普及していた'],
      ['理由は単純だったんでした。背景は複雑だったんでした。結論は不明だったんでした', '理由は単純だったんでいた。背景は複雑だったんでいた。結論は不明だったんでいた'],
      ['子どもの頃は東京に住んでいました。学生時代も住んでいました。最近は郷里に住んでいました', '子どもの頃は東京に住んでとしていた。学生時代も住んでとしていた。最近は郷里に住んでとしていた'],
      ['研究は進んでいます。導入も進んでいます。いまも進んでいます', '研究は進んでいる。導入も進んでいる。いまも進んでいる'],
      ['新しい手法を試してみます。別の角度からも試してみます。後日もう一度試してみます', '新しい手法を試してみる。別の角度からも試してみる。後日もう一度試してみる'],
      ['不要なデータを消してしまいます。古い設定も消してしまいます。誤って消してしまいます', '不要なデータを消してしまう。古い設定も消してしまう。誤って消してしまう'],
      ['毎日通ってきます。成果も出てきます。さらに伸びてきます', '毎日通って来る。成果も出て来る。さらに伸びて来る'],
      ['結果は成功でした。反応も好調でした。売上も堅調でした', '結果は成功だった。反応も好調だった。売上も堅調だった'],
      ['今後も続くでしょう。需要も伸びるでしょう。普及も進むでしょう', '今後も続くだろう。需要も伸びるだろう。普及も進むだろう'],
      ['要点は明快です。結論も明快です。答えは一つです', '要点は明快だ。結論も明快だ。答えは一つだ'],
    ])('converts %s to %s', (input, expected) => {
      expect(normalizeJapaneseSummary(input)).toBe(expected);
    });
  });

  describe('sentence-final anchor behavior', () => {
    it.each([
      '長年勤めておりましたが',
      '以前は普及していましたが',
      '理由は単純だったんでしたが',
      '子どもの頃は東京に住んでいましたが',
      '今は東京に住んでいますが',
      '新しい手法を試してみますが',
      '手順を忘れてしまいますが',
      '成果も出てきますが',
      '価格は高めでしたが',
      '今後も続くでしょうが',
      '内容は充実ですが',
    ])('keeps the mid-sentence polite form in %s unchanged', (input) => {
      expect(normalizeJapaneseSummary(input)).toBe(input);
    });
  });

  describe('japanese detection and blank input', () => {
    it('converts pure-hiragana text without kanji, katakana, or punctuation', () => {
      expect(normalizeJapaneseSummary('それはそうです')).toBe('それはそうだ');
    });

    it('returns whitespace-only text unchanged', () => {
      expect(normalizeJapaneseSummary('   ')).toBe('   ');
    });

    it('throws when summary is null', () => {
      expect(() => normalizeJapaneseSummary(null as unknown as string)).toThrow();
    });

    it('throws when summary is undefined', () => {
      expect(() => normalizeJapaneseSummary(undefined as unknown as string)).toThrow();
    });
  });
});
