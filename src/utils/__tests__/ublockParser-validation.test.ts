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
    test('有効な文字列はtrueを返す', () => {
      expect(isValidString('test')).toBe(true);
      expect(isValidString('||example.com^')).toBe(true);
    });

    test('nullはfalseを返す', () => {
      expect(isValidString(null as never)).toBe(false);
    });

    test('undefinedはfalseを返す', () => {
      expect(isValidString(undefined as never)).toBe(false);
    });

    test('空文字列はfalseを返す', () => {
      expect(isValidString('')).toBe(false);
    });
  });

  // ============================================================================
  // validateDomain
  // ============================================================================

  describe('validateDomain', () => {
    test('有効なドメインはtrueを返す', () => {
      expect(validateDomain('example.com')).toBe(true);
      expect(validateDomain('sub.example.com')).toBe(true);
      expect(validateDomain('*.example.com')).toBe(true);
    });

    test('無効なドメインはfalseを返す', () => {
      expect(validateDomain('')).toBe(false);
      expect(validateDomain('..example.com')).toBe(false);
      expect(validateDomain('example..com')).toBe(false);
    });

    test('null/undefinedはfalseを返す', () => {
      expect(validateDomain(null as never)).toBe(false);
      expect(validateDomain(undefined as never)).toBe(false);
    });

    // VULN-025: 悪意あるフィルタ行による指数バックトラック（ReDoS）を防ぐ。
    // 現行 regex `/^(\*\.)?[a-z0-9._-]+(\.[a-z0-9._-]+)*$/i` は入力長に対し指数的に遅くなる
    // （実測 22 ドット→253ms、26 ドット→1.2秒、30 ドット→8秒超）。
    // 24 ドット程度でも現行実装なら数百 ms かかり、この閾値を超える。
    test('指数入力でも線形時間で完了する（ReDoS 防止）', () => {
      const malicious = 'a' + '.a'.repeat(24) + '!';
      const start = performance.now();
      const result = validateDomain(malicious);
      const elapsed = performance.now() - start;

      expect(result).toBe(false);
      expect(elapsed).toBeLessThan(50);
    }, 5000);

    test('長大な正当ドメインも線形時間で受理される', () => {
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
    test('行先頭が!はコメント行と判定', () => {
      expect(isCommentLine('! This is a comment')).toBe(true);
      expect(isCommentLine('!')).toBe(true);
      expect(isCommentLine('!!')).toBe(true);
    });

    test('行先頭が!でない場合はコメント行でない', () => {
      expect(isCommentLine('||example.com^')).toBe(false);
      expect(isCommentLine(' example.com')).toBe(false);
    });

    test('行先頭が!の場合はコメント行', () => {
      expect(isCommentLine('!example.com^')).toBe(true);
      expect(isCommentLine('! This is a comment')).toBe(true);
    });

    test('空文字列はfalseを返す', () => {
      expect(isCommentLine('')).toBe(false);
      expect(isCommentLine(' ')).toBe(false);
    });

    test('null/undefinedはfalseを返す', () => {
      expect(isCommentLine(null as never)).toBe(false);
      expect(isCommentLine(undefined as never)).toBe(false);
    });
  });

  // ============================================================================
  // isEmptyLine
  // ============================================================================

  describe('isEmptyLine', () => {
    test('空文字列は空行と判定', () => {
      expect(isEmptyLine('')).toBe(true);
    });

    test('空白のみは空行と判定', () => {
      expect(isEmptyLine('   ')).toBe(true);
      expect(isEmptyLine('\t')).toBe(true);
      expect(isEmptyLine('\n')).toBe(true);
      expect(isEmptyLine(' \t\n ')).toBe(true);
    });

    test('文字を含む行は空行でない', () => {
      expect(isEmptyLine('||example.com^')).toBe(false);
      expect(isEmptyLine(' a')).toBe(false);
    });

    test('null/undefinedはtrueを返す', () => {
      expect(isEmptyLine(null as never)).toBe(true);
      expect(isEmptyLine(undefined as never)).toBe(true);
    });
  });

  // ============================================================================
  // isValidRulePattern
  // ============================================================================

  describe('isValidRulePattern', () => {
    test('||プレフィックスあり、^サフィックスありは有効', () => {
      expect(isValidRulePattern('||example.com^')).toBe(true);
      expect(isValidRulePattern('||*.example.com^')).toBe(true);
      expect(isValidRulePattern('||sub.example.com^')).toBe(true);
    });

    test('||プレフィックスがない場合は無効', () => {
      expect(isValidRulePattern('example.com^')).toBe(false);
      expect(isValidRulePattern('example.com')).toBe(false);
    });

    test('^サフィックスがない場合は無効', () => {
      expect(isValidRulePattern('||example.com')).toBe(false);
      expect(isValidRulePattern('||')).toBe(false);
    });

    test('空パターンは無効', () => {
      expect(isValidRulePattern('||^')).toBe(false);
      expect(isValidRulePattern('')).toBe(false);
    });

    test('null/undefinedはfalseを返す', () => {
      expect(isValidRulePattern(null as never)).toBe(false);
      expect(isValidRulePattern(undefined as never)).toBe(false);
    });
  });
});