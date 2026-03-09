/**
 * urlUtils.test.ts
 * Tests for urlUtils.ts
 */

import { normalizeUrl, isSecureUrl, sanitizeUrlForLogging, urlWithoutPath } from '../urlUtils.js';

describe('isSecureUrl', () => {
    test('http URLは安全と判定', () => {
        expect(isSecureUrl('http://example.com')).toBe(true);
        expect(isSecureUrl('http://localhost:8080')).toBe(true);
    });

    test('https URLは安全と判定', () => {
        expect(isSecureUrl('https://example.com')).toBe(true);
        expect(isSecureUrl('https://example.com/path')).toBe(true);
    });

    test('chrome:// URLは安全でないと判定', () => {
        expect(isSecureUrl('chrome://extensions')).toBe(false);
        expect(isSecureUrl('chrome://settings')).toBe(false);
    });

    test('data: URLは安全でないと判定', () => {
        expect(isSecureUrl('data:text/plain,hello')).toBe(false);
    });

    test('file: URLは安全でないと判定', () => {
        expect(isSecureUrl('file:///path/to/file.txt')).toBe(false);
    });

    test('無効なURLは安全でないと判定', () => {
        expect(isSecureUrl('not-a-url')).toBe(false);
        expect(isSecureUrl('')).toBe(false);
    });

    test('ftp: URLは安全でないと判定', () => {
        expect(isSecureUrl('ftp://example.com/file.txt')).toBe(false);
    });
});

describe('sanitizeUrlForLogging', () => {
    test('ドメインのみを抽出', () => {
        expect(sanitizeUrlForLogging('https://example.com/path')).toBe('example.com');
        expect(sanitizeUrlForLogging('http://user:pass@example.com:8080/sensitive?q=secret')).toBe('example.com');
    });

    test('無効なURLを処理', () => {
        expect(sanitizeUrlForLogging('not-a-url')).toBe('[INVALID_URL]');
        expect(sanitizeUrlForLogging('')).toBe('[INVALID_URL]');
    });

    test('ロングパスもドメインのみ', () => {
        expect(sanitizeUrlForLogging('https://api.service.com/v1/users/123/profile?id=456')).toBe('api.service.com');
    });
});

describe('urlWithoutPath', () => {
    test('プロトコルとドメインとポートのみを抽出', () => {
        expect(urlWithoutPath('https://example.com/path')).toBe('https://example.com');
        expect(urlWithoutPath('http://example.com:8080/path')).toBe('http://example.com:8080');
    });

    test('無効なURLを処理', () => {
        expect(urlWithoutPath('not-a-url')).toBe('[INVALID_URL]');
    });

    test('ポート番号なし', () => {
        expect(urlWithoutPath('https://service.com/api/v1')).toBe('https://service.com');
    });
});

describe('normalizeUrl', () => {
    test('末尾のスラッシュを削除する', () => {
        expect(normalizeUrl('https://example.com/')).toBe('https://example.com');
        expect(normalizeUrl('https://example.com/path/')).toBe('https://example.com/path');
    });

    test('プロトコルを小文字に正規化する', () => {
        expect(normalizeUrl('HTTPS://example.com')).toBe('https://example.com');
        expect(normalizeUrl('HTTP://example.com')).toBe('http://example.com');
    });

    test('無効なURLの場合はエラーを投げる', () => {
        expect(() => normalizeUrl('not-a-url')).toThrow();
    });

    test('既に正規化されているURLはそのまま返す', () => {
        expect(normalizeUrl('https://example.com')).toBe('https://example.com');
        expect(normalizeUrl('http://localhost:8080')).toBe('http://localhost:8080');
    });

    test('クエリパラメータとフラグメントを保持する', () => {
        expect(normalizeUrl('https://example.com/path?query=value')).toBe('https://example.com/path?query=value');
        expect(normalizeUrl('https://example.com/path#fragment')).toBe('https://example.com/path#fragment');
    });
});