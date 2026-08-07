import { describe, test, expect } from 'vitest';
import { wildcardToRegex } from '../wildcardToRegex.js';

describe('wildcardToRegex', () => {
    test('ワイルドカードなしの場合は完全一致の正規表現を返す', () => {
        const re = wildcardToRegex('example.com');
        expect(re?.test('example.com')).toBe(true);
        expect(re?.test('other.com')).toBe(false);
    });
    test('ワイルドカードを .* に変換する', () => {
        const re = wildcardToRegex('*.example.com');
        expect(re?.test('sub.example.com')).toBe(true);
        expect(re?.test('example.com')).toBe(false);
    });
    test('大文字小文字を区別しない', () => {
        const re = wildcardToRegex('Example.COM');
        expect(re?.test('example.com')).toBe(true);
    });
    test('ワイルドカード数が上限を超える場合はnullを返す', () => {
        const re = wildcardToRegex('*.*.*.*.*.*.com');
        expect(re).toBeNull();
    });
    test('空文字列の場合はnullを返す', () => {
        expect(wildcardToRegex('')).toBeNull();
    });
});
