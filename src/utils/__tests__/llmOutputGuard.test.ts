import { describe, it, expect } from 'vitest';
import { isDegenerateOutput } from '../llmOutputGuard.js';

describe('isDegenerateOutput', () => {
  it('detects the real "豚肉 | 豚肉 ..." x200 degenerate example as repetition', () => {
    const summary = Array.from({ length: 200 }, () => '豚肉').join(' | ');
    const result = isDegenerateOutput(summary);
    expect(result.isDegenerate).toBe(true);
    expect(result.reason).toBe('repetition');
  });

  it('passes a natural 3-sentence Japanese summary', () => {
    const summary =
      '大戸屋の期間限定メニューは、豚肉の生姜焼きが中心となっている。ご飯が進む甘辛い味付けで、多くの利用者から好評を得ている。数量限定のため、早めの来店が推奨されている。';
    const result = isDegenerateOutput(summary);
    expect(result.isDegenerate).toBe(false);
  });

  it('detects English "apple | apple ..." x100 as degenerate', () => {
    const summary = Array.from({ length: 100 }, () => 'apple').join(' | ');
    const result = isDegenerateOutput(summary);
    expect(result.isDegenerate).toBe(true);
  });

  it('does not flag a short response like "了解。" (too short to judge)', () => {
    const result = isDegenerateOutput('了解。');
    expect(result.isDegenerate).toBe(false);
  });

  it('boundary: repetition rate 29% is not degenerate', () => {
    // 29 copies of "foo" + 71 distinct filler tokens => most-frequent rate 0.29
    const tokens = [
      ...Array.from({ length: 29 }, () => 'foo'),
      ...Array.from({ length: 71 }, (_v, i) => `w${i}word`),
    ];
    const result = isDegenerateOutput(tokens.join(' '));
    expect(result.isDegenerate).toBe(false);
  });

  it('boundary: repetition rate 31% is degenerate', () => {
    const tokens = [
      ...Array.from({ length: 31 }, () => 'foo'),
      ...Array.from({ length: 69 }, (_v, i) => `w${i}word`),
    ];
    const result = isDegenerateOutput(tokens.join(' '));
    expect(result.isDegenerate).toBe(true);
    expect(result.reason).toBe('repetition');
  });

  it('boundary: unique rate 9% is degenerate (lowDiversity)', () => {
    // 9 unique short tokens spread over 100 total, each below the repetition
    // threshold; chars-per-unique-token kept under the compressibility bound.
    const alpha = 'abcdefghi'.split('');
    const tokens: string[] = [];
    for (let i = 0; i < 100; i++) tokens.push(alpha[i % 9] as string);
    const result = isDegenerateOutput(tokens.join(' '));
    expect(result.isDegenerate).toBe(true);
    expect(['lowDiversity', 'repetition', 'highlyCompressible']).toContain(result.reason);
  });

  it('boundary: unique rate 11% is not degenerate', () => {
    // 11 unique short tokens over 100 total; max frequency under 0.3 and
    // chars-per-unique-token under the compressibility bound.
    const alpha = 'abcdefghijk'.split('');
    const tokens: string[] = [];
    for (let i = 0; i < 100; i++) tokens.push(alpha[i % 11] as string);
    const result = isDegenerateOutput(tokens.join(' '));
    expect(result.isDegenerate).toBe(false);
  });

  it('does not flag a natural sentence that has a predicate but no period', () => {
    const summary =
      'この記事では新しい料理の作り方をわかりやすく説明しています。家庭でも簡単に再現できると書かれています';
    const result = isDegenerateOutput(summary);
    expect(result.isDegenerate).toBe(false);
  });

  it('treats empty / null / undefined as not degenerate', () => {
    expect(isDegenerateOutput('').isDegenerate).toBe(false);
    // @ts-expect-error testing null input
    expect(isDegenerateOutput(null).isDegenerate).toBe(false);
    // @ts-expect-error testing undefined input
    expect(isDegenerateOutput(undefined).isDegenerate).toBe(false);
  });

  it('does not flag a legit 5-tag tagSummaryMode body once tags are separated', () => {
    // Guard operates on the summary body only; a short factual body is fine.
    const body = 'この記事は5つのタグで分類されており、内容は料理レシピの紹介です。';
    const result = isDegenerateOutput(body);
    expect(result.isDegenerate).toBe(false);
  });
});
