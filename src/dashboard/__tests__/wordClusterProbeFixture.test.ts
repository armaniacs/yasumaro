// STEP 0 quality probe (PBI 2026-09-24-07) — synthetic stand-in.
//
// The PBI's STEP 0 asks for a manual probe of Japanese keyword-extraction
// quality against the USER'S REAL DB. This repo cannot access that DB, so
// this fixture runs the extraction + adapter pipeline over a deterministic
// synthetic mixed JA/EN corpus and asserts the sanity properties instead:
// no stopwords, no 1-char CJK tokens, no pipeline-breaking characters, and
// byte-identical output across runs.
//
// The REAL-DATA MANUAL PROBE REMAINS AN OPEN USER VERIFICATION STEP: it must
// be run against the user's own browsing DB (dashboard → Word Cluster panel)
// to tune the stopword list and the min-length threshold. It is NOT done by
// this test.

import { describe, it, expect } from 'vitest';
import { extractKeywords } from '../keywordExtractor.js';
import { buildWordClusterRows } from '../wordClusterAdapter.js';
import { parseTagsForDisplay } from '../../utils/tagUtils.js';

/**
 * Deterministic synthetic corpus: diary-style JA summaries, EN technical
 * summaries, mixed-language texts, plus the failure rows the adapter must
 * handle (null / fallback-literal summaries).
 */
const PROBE_CORPUS: Array<{ title: string | null; summary: string | null }> = [
  {
    title: 'Rust の所有権とライフタイムを整理する',
    summary: '所有権システムによってデータ競合をコンパイル時に防げることを、ムーブセマンティクスと借用チェッカーの例で確認した。Rust ownership and lifetimes explained.',
  },
  {
    title: 'Machine learning study notes',
    summary: 'Gradient descent and backpropagation intuition. Overfitting を防ぐ正則化についても整理した。',
  },
  {
    title: 'TypeScript の型推論まとめ',
    summary: 'conditional types と template literal types を使うとライブラリの型定義がすっきりする。',
  },
  {
    title: ' SQLite パフォーマンスチューニング',
    summary: null,
  },
  {
    title: '定例ミーティング議事録',
    summary: 'Summary not available.',
  },
  {
    title: '朝のランニング記録',
    summary: '5キロを28分で走破。ペース配分を変えたら後半が楽だった。',
  },
  {
    title: 'React のレンダリング最適化',
    summary: 'memo と useCallback の過剰な適用は逆効果になるケースがあった。プロファイラで計測してから手を入れる。',
  },
  {
    title: '英会話フレーズノート',
    summary: 'Would you mind と Could you のニュアンスの違いを例文で比較した。',
  },
  {
    title: '読書メモ:システム設計',
    summary: 'スケーラビリティとトレードオフの章。キャッシュ戦略の比較表が有用だった。',
  },
  {
    title: null,
    summary: 'Summary not available.',
  },
  {
    title: '   ',
    summary: null,
  },
];

const SPOT_CHECK_JA_STOPWORDS = ['こと', 'もの', 'ため', 'これ', 'それ', 'する', 'なる'];

describe('STEP 0 probe fixture — synthetic mixed JA/EN corpus sanity', () => {
  const adapterResult = buildWordClusterRows(PROBE_CORPUS);
  const allKeywords = adapterResult.rows.flatMap((r) => parseTagsForDisplay(r.tags));

  it('extracts keywords from both languages', () => {
    const latin = allKeywords.filter((k) => /^[a-z]+$/.test(k));
    const nonLatin = allKeywords.filter((k) => !/^[a-z]+$/.test(k));
    expect(latin.length).toBeGreaterThan(0);
    expect(nonLatin.length).toBeGreaterThan(0);
  });

  it('never emits stopwords (spot-checked EN and JA entries)', () => {
    const enSpotCheck = ['the', 'and', 'is', 'was', 'about', 'with', 'this', 'that'];
    const jaSpotCheck = ['こと', 'もの', 'ため', 'これ', 'それ', 'する', 'なる', 'について', 'でも', 'しかし'];
    for (const keyword of allKeywords) {
      expect(enSpotCheck).not.toContain(keyword);
      expect(jaSpotCheck).not.toContain(keyword);
    }
  });

  it('never emits 1-char CJK tokens (min-length filter)', () => {
    for (const keyword of allKeywords) {
      expect(Array.from(keyword).length).toBeGreaterThanOrEqual(2);
    }
  });

  it('never emits numeric-only or pipeline-breaking keywords', () => {
    for (const keyword of allKeywords) {
      expect(keyword).toMatch(/^[\p{L}\p{N}]+$/u);
      expect(keyword).not.toMatch(/^\p{N}+$/u);
      expect(keyword).not.toContain('#');
      expect(keyword).not.toContain('|');
    }
  });

  it('round-trips every keyword through the tag parser', () => {
    for (const r of adapterResult.rows) {
      const tags = parseTagsForDisplay(r.tags);
      expect(tags.length).toBeGreaterThan(0);
      for (const tag of tags) {
        expect(r.tags).toContain(`#${tag}`);
      }
    }
  });

  it('reports the expected exclusion counts for the failure rows', () => {
    // Unusable summaries: SQLite (null), 議事録 (fallback), and the last two
    // rows (fallback / null) — 4 of 11. Fully skipped rows (no usable title
    // either): the last two — 2 of 11.
    expect(adapterResult.summaryExcludedCount).toBe(4);
    expect(adapterResult.skippedRows).toBe(2);
    expect(adapterResult.rows.length).toBe(PROBE_CORPUS.length - adapterResult.skippedRows);
  });

  it('is byte-identical across repeated runs', () => {
    const second = buildWordClusterRows(PROBE_CORPUS);
    expect(second).toEqual(adapterResult);
    for (const r of adapterResult.rows) {
      expect(extractKeywords(r.tags)).toEqual(extractKeywords(r.tags));
    }
  });
});
