import { describe, test, expect } from 'vitest';
import { wildcardToRegex, matchesDomainPattern, isDomainInList } from '../wildcardToRegex.js';

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

describe('matchesDomainPattern subdomain matching (PBI 2026-09-06-06)', () => {
    test('トグルOFF（デフォルト）+ 完全一致 → マッチ', () => {
        expect(matchesDomainPattern('example.com', 'example.com')).toBe(true);
    });
    test('トグルOFF（デフォルト）+ サブドメイン → マッチしない', () => {
        expect(matchesDomainPattern('sub.example.com', 'example.com')).toBe(false);
    });
    test('トグルON + 完全一致 → マッチ', () => {
        expect(matchesDomainPattern('example.com', 'example.com', true)).toBe(true);
    });
    test('トグルON + サブドメイン → マッチ', () => {
        expect(matchesDomainPattern('sub.example.com', 'example.com', true)).toBe(true);
    });
    test('トグルON + wwwサブドメイン → マッチ', () => {
        expect(matchesDomainPattern('www.example.com', 'example.com', true)).toBe(true);
    });
    test('トグルON + 深いサブドメイン → マッチ', () => {
        expect(matchesDomainPattern('a.b.example.com', 'example.com', true)).toBe(true);
    });
    test('トグルONでも無関係ドメインはマッチしない', () => {
        expect(matchesDomainPattern('notexample.com', 'example.com', true)).toBe(false);
    });
    test('パターンが空 → マッチしない', () => {
        expect(matchesDomainPattern('example.com', '', true)).toBe(false);
    });
    test('トグルONでもワイルドカードパターンは従来どおり動く', () => {
        expect(matchesDomainPattern('sub.example.com', '*.example.com', true)).toBe(true);
        expect(matchesDomainPattern('example.com', '*.example.com', true)).toBe(false);
    });
    test('isDomainInList にトグルを渡せる', () => {
        expect(isDomainInList('sub.example.com', ['example.com'])).toBe(false);
        expect(isDomainInList('sub.example.com', ['example.com'], true)).toBe(true);
    });
});
