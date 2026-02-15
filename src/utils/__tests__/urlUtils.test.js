/**
 * urlUtils.test.js
 * Tests for urlUtils.js
 */

import { normalizeUrl } from '../urlUtils.ts';

describe('normalizeUrl', () => {
    test('末尾のスラッシュを削除する', () => {
        expect(normalizeUrl('https://example.com/')).toBe('https://example.com');
        expect(normalizeUrl('https://example.com/path/')).toBe('https://example.com/path');
    });

    test('プロトコルを小文字に正規化する', () => {
        expect(normalizeUrl('HTTPS://example.com')).toBe('https://example.com');
        expect(normalizeUrl('HTTP://example.com')).toBe('http://example.com');
    });

    test('無効なURLの場合はそのまま返す', () => {
        expect(normalizeUrl('not-a-url')).toBe('not-a-url');
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
