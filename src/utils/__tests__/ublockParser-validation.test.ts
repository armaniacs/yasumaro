/**
 * ublockParser-validation.test.ts
 * uBlock Parser - Validationモジュールのユニットテスト
 */

import {
  isValidString,
  validateDomain,
  isCommentLine,
  isEmptyLine,
  isValidRulePattern
} from '../ublockParser/index.js';

describe('ublockParser - Validation Module', () => {
  // ============================================================================
  // isValidString
  // ============================================================================

  describe('isValidString', () => {
    test('returns true for a valid string', () => {
      expect(isValidString('test')).toBe(true);
      expect(isValidString('||example.com^')).toBe(true);
    });

    test('returns false for null', () => {
      expect(isValidString(null as never)).toBe(false);
    });

    test('returns false for undefined', () => {
      expect(isValidString(undefined as never)).toBe(false);
    });

    test('returns false for an empty string', () => {
      expect(isValidString('')).toBe(false);
    });
  });

  // ============================================================================
  // validateDomain
  // ============================================================================

  describe('validateDomain', () => {
    test('returns true for a valid domain', () => {
      expect(validateDomain('example.com')).toBe(true);
      expect(validateDomain('sub.example.com')).toBe(true);
      expect(validateDomain('*.example.com')).toBe(true);
    });

    test('returns false for an invalid domain', () => {
      expect(validateDomain('')).toBe(false);
      expect(validateDomain('..example.com')).toBe(false);
      expect(validateDomain('example..com')).toBe(false);
    });

    test('returns false for null/undefined', () => {
      expect(validateDomain(null as never)).toBe(false);
      expect(validateDomain(undefined as never)).toBe(false);
    });

    // VULN-025: 悪意あるフィルタ行による指数バックトラック（ReDoS）を防ぐ。
    // 現行 regex `/^(\*\.)?[a-z0-9._-]+(\.[a-z0-9._-]+)*$/i` は入力長に対し指数的に遅くなる
    // （実測 22 ドット→253ms、26 ドット→1.2秒、30 ドット→8秒超）。
    // 24 ドット程度でも現行実装なら数百 ms かかり、この閾値を超える。
    test('completes in linear time on adversarial input (ReDoS protection)', () => {
      const malicious = 'a' + '.a'.repeat(24) + '!';
      const start = performance.now();
      const result = validateDomain(malicious);
      const elapsed = performance.now() - start;

      expect(result).toBe(false);
      expect(elapsed).toBeLessThan(50);
    }, 5000);

    test('accepts a very long valid domain in linear time', () => {
      const longDomain = Array.from({ length: 50 }, () => 'label').join('.') + '.com';
      const start = performance.now();
      const result = validateDomain(longDomain);
      const elapsed = performance.now() - start;

      expect(result).toBe(true);
      expect(elapsed).toBeLessThan(50);
    });
  });

  // ============================================================================
  // isCommentLine
  // ============================================================================

  describe('isCommentLine', () => {
    test('treats a line starting with ! as a comment', () => {
      expect(isCommentLine('! This is a comment')).toBe(true);
      expect(isCommentLine('!')).toBe(true);
      expect(isCommentLine('!!')).toBe(true);
    });

    test('treats a line not starting with ! as not a comment', () => {
      expect(isCommentLine('||example.com^')).toBe(false);
      expect(isCommentLine(' example.com')).toBe(false);
    });

    test('recognizes a line starting with ! as a comment', () => {
      expect(isCommentLine('!example.com^')).toBe(true);
      expect(isCommentLine('! This is a comment')).toBe(true);
    });

    test('returns false for an empty string', () => {
      expect(isCommentLine('')).toBe(false);
      expect(isCommentLine(' ')).toBe(false);
    });

    test('returns false for null/undefined', () => {
      expect(isCommentLine(null as never)).toBe(false);
      expect(isCommentLine(undefined as never)).toBe(false);
    });
  });

  // ============================================================================
  // isEmptyLine
  // ============================================================================

  describe('isEmptyLine', () => {
    test('treats an empty string as an empty line', () => {
      expect(isEmptyLine('')).toBe(true);
    });

    test('treats whitespace-only input as an empty line', () => {
      expect(isEmptyLine('   ')).toBe(true);
      expect(isEmptyLine('\t')).toBe(true);
      expect(isEmptyLine('\n')).toBe(true);
      expect(isEmptyLine(' \t\n ')).toBe(true);
    });

    test('treats a line with characters as non-empty', () => {
      expect(isEmptyLine('||example.com^')).toBe(false);
      expect(isEmptyLine(' a')).toBe(false);
    });

    test('returns true for null/undefined', () => {
      expect(isEmptyLine(null as never)).toBe(true);
      expect(isEmptyLine(undefined as never)).toBe(true);
    });
  });

  // ============================================================================
  // isValidRulePattern
  // ============================================================================

  describe('isValidRulePattern', () => {
    test('accepts a pattern with || prefix and ^ suffix', () => {
      expect(isValidRulePattern('||example.com^')).toBe(true);
      expect(isValidRulePattern('||*.example.com^')).toBe(true);
      expect(isValidRulePattern('||sub.example.com^')).toBe(true);
    });

    test('rejects a pattern without the || prefix', () => {
      expect(isValidRulePattern('example.com^')).toBe(false);
      expect(isValidRulePattern('example.com')).toBe(false);
    });

    test('rejects a pattern without the ^ suffix', () => {
      expect(isValidRulePattern('||example.com')).toBe(false);
      expect(isValidRulePattern('||')).toBe(false);
    });

    test('rejects an empty pattern', () => {
      expect(isValidRulePattern('||^')).toBe(false);
      expect(isValidRulePattern('')).toBe(false);
    });

    test('returns false for null/undefined', () => {
      expect(isValidRulePattern(null as never)).toBe(false);
      expect(isValidRulePattern(undefined as never)).toBe(false);
    });
  });
});