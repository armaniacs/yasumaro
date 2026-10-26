/**
 * semanticVector.test.ts
 * PBI 2026-10-22-03: tiny local vectorizer pins.
 */
import { describe, it, expect } from 'vitest';
import {
  cosineSimilarity,
  normalizeSemanticText,
  semanticCharGrams,
  vectorizeSemanticText,
} from '../semanticVector.js';

describe('normalizeSemanticText', () => {
  it('lowercases and collapses separators', () => {
    expect(normalizeSemanticText('WASM、Embedding―Ships')).toBe('wasm embedding ships');
  });
});

describe('semanticCharGrams', () => {
  it('emits 1-3 char grams over spaceless code points', () => {
    expect(semanticCharGrams('ab')).toEqual(expect.arrayContaining(['a', 'b', 'ab']));
    expect(semanticCharGrams('')).toEqual([]);
    // Spaces are user word separators, not content: grams cross them.
    expect(semanticCharGrams('冪等 再開')).toContain('等再');
  });
});

describe('vectorizeSemanticText', () => {
  it('is deterministic and maps empty text to the empty set (fail closed)', () => {
    const a = vectorizeSemanticText('WASM embedding', 'browser runtime');
    const b = vectorizeSemanticText('WASM embedding', 'browser runtime');
    expect(a).toEqual(b);
    expect(a.size).toBeGreaterThan(0);
    expect(vectorizeSemanticText('', '   ').size).toBe(0);
  });
});

describe('cosineSimilarity', () => {
  it('scores self-similarity 1 and empty 0 (never NaN)', () => {
    const vec = vectorizeSemanticText('weekly review digest', 'automation');
    expect(cosineSimilarity(vec, vec)).toBeCloseTo(1, 6);
    expect(cosineSimilarity(vec, vectorizeSemanticText('', ''))).toBe(0);
    expect(Number.isNaN(cosineSimilarity(vec, vec))).toBe(false);
  });

  it('ranks paraphrase overlap above unrelated text', () => {
    const query = vectorizeSemanticText('WASM embedding browser', '');
    const paraphrase = vectorizeSemanticText('WebAssembly embedding runtime in the browser', '');
    const unrelated = vectorizeSemanticText('potato curry recipe', '');
    expect(cosineSimilarity(query, paraphrase)).toBeGreaterThan(cosineSimilarity(query, unrelated));
  });

  it('shares substrings across unspaced Japanese (token-exact scores 0 here)', () => {
    const query = vectorizeSemanticText('バッチ再開', '');
    const hit = vectorizeSemanticText('バッチ再開とチェックポイント', '');
    const miss = vectorizeSemanticText('potato curry recipe', '');
    expect(cosineSimilarity(query, hit)).toBeGreaterThan(0);
    expect(cosineSimilarity(query, hit)).toBeGreaterThan(cosineSimilarity(query, miss));
  });
});
