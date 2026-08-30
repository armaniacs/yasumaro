/**
 * domainUtils-redos.test.ts
 * VULN-025/026 回帰テスト: ドメインパターン検証の ReDoS 耐性とワイルドカード上限。
 * 【テスト対象】: src/utils/domainUtils.ts の isValidDomain / matchesPattern
 */

import { describe, test, expect } from 'vitest';
import { isValidDomain, matchesPattern } from '../domainUtils.js';
import { MAX_WILDCARDS_PER_PATTERN } from '../wildcardToRegex.js';

describe('domainUtils - ReDoS / wildcard cap 回帰テスト', () => {
  describe('isValidDomain', () => {
    test('先頭 *. のワイルドカードパターンは有効', () => {
      expect(isValidDomain('*.example.com')).toBe(true);
    });

    // VULN-026: ワイルドカードが多すぎるパターンは matchesPattern（wildcardToRegex 経由）で
    // 無視される。保存前の検証でも拒否し「効かないパターン」が storage に入るのを防ぐ。
    test('ワイルドカード上限を超えるパターンは無効', () => {
      const overCap = '*.'.repeat(MAX_WILDCARDS_PER_PATTERN + 1) + 'example.com';
      expect(isValidDomain(overCap)).toBe(false);
    });

    test('ワイルドカードが上限ちょうどのパターンは有効', () => {
      const atCap = '*.'.repeat(MAX_WILDCARDS_PER_PATTERN) + 'example.com';
      expect(isValidDomain(atCap)).toBe(true);
    });

    test('多数のラベルを持つ長大なドメインでも即座に判定される（ReDoS 防止）', () => {
      const many = Array.from({ length: 60 }, () => 'label').join('.') + '.example';
      const start = performance.now();
      isValidDomain(many);
      expect(performance.now() - start).toBeLessThan(50);
    });
  });

  describe('matchesPattern', () => {
    test('ワイルドカード上限を超えるパターンは（形が合っても）マッチしない', () => {
      const overCap = '*.'.repeat(MAX_WILDCARDS_PER_PATTERN + 1) + 'example.com';
      const domain = 'a.'.repeat(MAX_WILDCARDS_PER_PATTERN + 1) + 'example.com';
      expect(matchesPattern(domain, overCap)).toBe(false);
    });

    test('ワイルドカード上限ちょうどのパターンは正しくマッチする', () => {
      const atCap = '*.'.repeat(MAX_WILDCARDS_PER_PATTERN) + 'example.com';
      const domain = 'a.'.repeat(MAX_WILDCARDS_PER_PATTERN) + 'example.com';
      expect(matchesPattern(domain, atCap)).toBe(true);
    });
  });
});
