/**
 * ublockParser-validation.test.js
 * uBlock Parser - Validationモジュールのユニットテスト
 */

import {
  isValidString,
  validateDomain,
  isCommentLine,
  isEmptyLine,
  isValidRulePattern
} from '../ublockParser.ts';

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
      expect(isValidString(null)).toBe(false);
    });

    test('undefinedはfalseを返す', () => {
      expect(isValidString(undefined)).toBe(false);
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
      expect(validateDomain(null)).toBe(false);
      expect(validateDomain(undefined)).toBe(false);
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
      expect(isCommentLine(null)).toBe(false);
      expect(isCommentLine(undefined)).toBe(false);
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
      expect(isEmptyLine(null)).toBe(true);
      expect(isEmptyLine(undefined)).toBe(true);
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
      expect(isValidRulePattern(null)).toBe(false);
      expect(isValidRulePattern(undefined)).toBe(false);
    });
  });
});