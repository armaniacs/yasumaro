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
    test('treats a leading *. wildcard pattern as valid', () => {
      expect(isValidDomain('*.example.com')).toBe(true);
    });

    // VULN-026: ワイルドカードが多すぎるパターンは matchesPattern（wildcardToRegex 経由）で
    // 無視される。保存前の検証でも拒否し「効かないパターン」が storage に入るのを防ぐ。
    test('treats patterns exceeding the wildcard limit as invalid', () => {
      const overCap = '*.'.repeat(MAX_WILDCARDS_PER_PATTERN + 1) + 'example.com';
      expect(isValidDomain(overCap)).toBe(false);
    });

    test('treats a pattern at exactly the wildcard limit as valid', () => {
      const atCap = '*.'.repeat(MAX_WILDCARDS_PER_PATTERN) + 'example.com';
      expect(isValidDomain(atCap)).toBe(true);
    });

    test('resolves very long multi-label domains immediately (ReDoS prevention)', () => {
      const many = Array.from({ length: 60 }, () => 'label').join('.') + '.example';
      const start = performance.now();
      isValidDomain(many);
      expect(performance.now() - start).toBeLessThan(50);
    });
  });

  describe('matchesPattern', () => {
    test('does not match patterns exceeding the wildcard limit (even when the shape matches)', () => {
      const overCap = '*.'.repeat(MAX_WILDCARDS_PER_PATTERN + 1) + 'example.com';
      const domain = 'a.'.repeat(MAX_WILDCARDS_PER_PATTERN + 1) + 'example.com';
      expect(matchesPattern(domain, overCap)).toBe(false);
    });

    test('matches a pattern at exactly the wildcard limit correctly', () => {
      const atCap = '*.'.repeat(MAX_WILDCARDS_PER_PATTERN) + 'example.com';
      const domain = 'a.'.repeat(MAX_WILDCARDS_PER_PATTERN) + 'example.com';
      expect(matchesPattern(domain, atCap)).toBe(true);
    });
  });
});
