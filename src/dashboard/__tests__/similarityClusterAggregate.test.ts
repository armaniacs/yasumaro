/**
 * similarityClusterAggregate.test.ts
 * PBI 2026-10-22-03 ― 想起化 (類似クラスタの語彙土台).
 * Pins: same-news bundling across media, freshness + per-media differences,
 * the threshold boundary table, title-less/singleton 縮退, and input
 * immutability (元記録を壊さない).
 */
import { describe, it, expect } from 'vitest';
import {
  buildSimilarityClusters,
  MIN_CLUSTER_SIZE,
  SIMILARITY_THRESHOLD,
  titleSimilarity,
  tokenizeTitle,
  type SimilarityRecord,
} from '../similarityClusterAggregate.js';
import { MAX_TOKENS_PER_TITLE } from '../../utils/computeLimits.js';

function makeRecord(overrides: Partial<SimilarityRecord> = {}): SimilarityRecord {
  return {
    id: 1,
    title: 'WASM embedding ships in Chrome 140',
    url: 'https://a.example/p1',
    domain: 'a.example',
    createdAt: 1000,
    ...overrides,
  };
}

describe('tokenizeTitle + titleSimilarity (ローカル類似判定の土台)', () => {
  it('tokenizes ja/en titles and drops stopwords', () => {
    const tokens = tokenizeTitle('WASM の embedding が Chrome に来た');
    expect(tokens.has('wasm')).toBe(true);
    expect(tokens.has('の')).toBe(false);
    expect(tokenizeTitle('')).toEqual(new Set());
  });

  it('fails closed on non-string input (到達不能ガードの到達化)', () => {
    expect(tokenizeTitle(null)).toEqual(new Set());
    expect(tokenizeTitle(undefined)).toEqual(new Set());
    expect(tokenizeTitle(42)).toEqual(new Set());
  });

  it('caps the token set at MAX_TOKENS_PER_TITLE, first tokens in scan order', () => {
    expect(MAX_TOKENS_PER_TITLE).toBe(50);
    // A 500-char title (MAX_TITLE_LENGTH) tokenizes to ~250 whitespace
    // tokens; the cap keeps the first 50 so a hostile title cannot multiply
    // every pair comparison of buildSimilarityClusters by the token count.
    const hostile = Array.from({ length: 250 }, (_, i) => `tok${i}`).join(' ');
    const tokens = tokenizeTitle(hostile);
    expect(tokens.size).toBe(MAX_TOKENS_PER_TITLE);
    expect(tokens.has('tok0')).toBe(true);
    expect(tokens.has(`tok${MAX_TOKENS_PER_TITLE - 1}`)).toBe(true);
    expect(tokens.has(`tok${MAX_TOKENS_PER_TITLE}`)).toBe(false);
    // Duplicates never push the set past the cap.
    const repeated = tokenizeTitle(Array.from({ length: 100 }, () => 'same').join(' '));
    expect(repeated.size).toBe(1);
  });

  it('scores the threshold boundary (類似しきい値の境界)', () => {
    expect(SIMILARITY_THRESHOLD).toBe(0.5);
    const a = new Set(['wasm', 'chrome', 'ships']);
    const same = new Set(['wasm', 'chrome', 'ships']);
    expect(titleSimilarity(a, same)).toBe(1);
    const half = new Set(['wasm', 'chrome', 'firefox', 'ships']);
    expect(titleSimilarity(a, half)).toBeGreaterThanOrEqual(SIMILARITY_THRESHOLD);
    const other = new Set(['recipe', 'curry', 'potato']);
    expect(titleSimilarity(a, other)).toBe(0);
    // Empty pairs never produce NaN.
    expect(titleSimilarity(new Set(), a)).toBe(0);
  });
});

describe('buildSimilarityClusters (類似記事の束ね: 鮮度と差分だけが見える)', () => {
  it('bundles the same news across media with freshness and domains', () => {
    const records = [
      makeRecord({ id: 1, title: 'WASM embedding ships in Chrome 140', domain: 'a.example', createdAt: 2000 }),
      makeRecord({ id: 2, title: 'Chrome 140 ships WASM embedding support', domain: 'b.example', createdAt: 1000 }),
      makeRecord({ id: 3, title: 'Curry recipe with potatoes', domain: 'c.example', createdAt: 3000 }),
    ];
    const clusters = buildSimilarityClusters(records);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.members.map((m) => m.id)).toEqual([2, 1]);
    // 鮮度(最終更新)と多角的差分だけが見える.
    expect(clusters[0]?.freshestAt).toBe(2000);
    expect(clusters[0]?.domains).toEqual(['b.example', 'a.example']);
  });

  it('drops singletons and title-less records (少件数・空集合の縮退)', () => {
    expect(MIN_CLUSTER_SIZE).toBe(2);
    const records = [
      makeRecord({ id: 1, title: 'Solo story' }),
      makeRecord({ id: 2, title: '' }),
      makeRecord({ id: 3, title: '   ' }),
    ];
    expect(buildSimilarityClusters(records)).toEqual([]);
    expect(buildSimilarityClusters([])).toEqual([]);
  });

  it('sorts the biggest clusters first', () => {
    const records = [
      makeRecord({ id: 1, title: 'Alpha beta gamma delta', domain: 'a.example', createdAt: 1000 }),
      makeRecord({ id: 2, title: 'Alpha beta gamma delta news', domain: 'b.example', createdAt: 2000 }),
      makeRecord({ id: 3, title: 'Alpha beta gamma delta update', domain: 'c.example', createdAt: 3000 }),
      makeRecord({ id: 4, title: 'Zulu yankee xray walt', domain: 'd.example', createdAt: 1000 }),
      makeRecord({ id: 5, title: 'Zulu yankee xray walt report', domain: 'e.example', createdAt: 2000 }),
    ];
    const clusters = buildSimilarityClusters(records);
    expect(clusters[0]?.members).toHaveLength(3);
    expect(clusters[1]?.members).toHaveLength(2);
  });

  it('never mutates the input records (元記録を壊さない)', () => {
    const records = [
      makeRecord({ id: 1, title: 'Alpha beta gamma delta', createdAt: 2000 }),
      makeRecord({ id: 2, title: 'Alpha beta gamma delta news', createdAt: 1000 }),
    ];
    const snapshot = records.map((r) => ({ ...r }));
    buildSimilarityClusters(records);
    expect(records).toEqual(snapshot);
  });
});
