/**
 * ublockImport-validation.test.js
 * uBlock Import - Validationモジュールのユニットテスト
 */

import {
  isValidUrl
} from '../ublockImport.ts';

describe('ublockImport - Validation Module', () => {
  // ============================================================================
  // isValidUrl
  // ============================================================================

  describe('isValidUrl', () => {
    test('有効なHTTPS URLはtrueを返す', () => {
      expect(isValidUrl('https://example.com')).toBe(true);
      expect(isValidUrl('https://example.com/filters.txt')).toBe(true);
      expect(isValidUrl('https://sub.example.com/path/to/filters.txt')).toBe(true);
    });

    test('有効なHTTP URLはtrueを返す', () => {
      expect(isValidUrl('http://example.com')).toBe(true);
      expect(isValidUrl('http://example.com/filters.txt')).toBe(true);
    });

    test('有効なFTP URLはtrueを返す', () => {
      expect(isValidUrl('ftp://example.com')).toBe(true);
      expect(isValidUrl('ftp://example.com/filters.txt')).toBe(true);
    });

    test('javascript: URLはfalseを返す（XSS対策）', () => {
      expect(isValidUrl('javascript:alert(1)')).toBe(false);
      expect(isValidUrl('javascript:void(0)')).toBe(false);
    });

    test('data: URLはfalseを返す（XSS対策）', () => {
      expect(isValidUrl('data:text/plain,hello')).toBe(false);
    });

    test('vbscript: URLはfalseを返す（XSS対策）', () => {
      expect(isValidUrl('vbscript:alert(1)')).toBe(false);
    });

    test('file: URLはfalseを返す', () => {
      expect(isValidUrl('file:///path/to/file.txt')).toBe(false);
    });

    test('nullはfalseを返す', () => {
      expect(isValidUrl(null)).toBe(false);
    });

    test('undefinedはfalseを返す', () => {
      expect(isValidUrl(undefined)).toBe(false);
    });

    test('空文字列はfalseを返す', () => {
      expect(isValidUrl('')).toBe(false);
    });

    test('プロトコルなしはfalseを返す', () => {
      expect(isValidUrl('example.com')).toBe(false);
      expect(isValidUrl('www.example.com')).toBe(false);
    });

    test('http:のみでパスなしはfalseを返す', () => {
      expect(isValidUrl('http:example.com')).toBe(false);
    });

    test('前後余白をトリムして評価', () => {
      expect(isValidUrl('  https://example.com  ')).toBe(true);
    });

    test('大文字小文字を区別せずプロトコルを評価', () => {
      expect(isValidUrl('HTTPS://example.com')).toBe(true);
      expect(isValidUrl('HTTP://example.com')).toBe(true);
      expect(isValidUrl('FTP://example.com')).toBe(true);
    });

    test('ポート番号付きURLを許可', () => {
      expect(isValidUrl('https://example.com:8080/filters.txt')).toBe(true);
      expect(isValidUrl('http://example.com:80/filters.txt')).toBe(true);
    });

    test('クエリパラメータ付きURLを許可', () => {
      expect(isValidUrl('https://example.com/filters.txt?v=1')).toBe(true);
    });

    test('フラグメント付きURLを許可', () => {
      expect(isValidUrl('https://example.com/filters.txt#section')).toBe(true);
    });
  });

  // ============================================================================
  // エッジケースとセキュリティ
  // ============================================================================

  describe('Security Edge Cases', () => {
    test('混合ケースのプロトコル検証', () => {
      expect(isValidUrl('HtTpS://example.com')).toBe(true);
    });

    test('特殊文字の含むURLパスを許可', () => {
      expect(isValidUrl('https://example.com/filters_v1.2.3.txt')).toBe(true);
      expect(isValidUrl('https://example.com/path_with_underscores.txt')).toBe(true);
    });

    test('非常に長いURLを処理', () => {
      const longPath = 'a'.repeat(1000);
      expect(isValidUrl(`https://example.com/${longPath}.txt`)).toBe(true);
    });
  });
});