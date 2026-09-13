import { describe, test, expect } from 'vitest';
import { wildcardToRegex, matchesDomainPattern, isDomainInList } from '../wildcardToRegex.js';

describe('wildcardToRegex', () => {
    test('returns an exact-match regex when there is no wildcard', () => {
        const re = wildcardToRegex('example.com');
        expect(re?.test('example.com')).toBe(true);
        expect(re?.test('other.com')).toBe(false);
    });
    test('converts a wildcard to .*', () => {
        const re = wildcardToRegex('*.example.com');
        expect(re?.test('sub.example.com')).toBe(true);
        expect(re?.test('example.com')).toBe(false);
    });
    test('matches case-insensitively', () => {
        const re = wildcardToRegex('Example.COM');
        expect(re?.test('example.com')).toBe(true);
    });
    test('returns null when wildcard count exceeds the limit', () => {
        const re = wildcardToRegex('*.*.*.*.*.*.com');
        expect(re).toBeNull();
    });
    test('returns null for an empty string', () => {
        expect(wildcardToRegex('')).toBeNull();
    });
});

describe('matchesDomainPattern subdomain matching (PBI 2026-09-06-06)', () => {
    test('matches an exact domain with subdomain toggle OFF (default)', () => {
        expect(matchesDomainPattern('example.com', 'example.com')).toBe(true);
    });
    test('does not match a subdomain with subdomain toggle OFF (default)', () => {
        expect(matchesDomainPattern('sub.example.com', 'example.com')).toBe(false);
    });
    test('matches an exact domain with subdomain toggle ON', () => {
        expect(matchesDomainPattern('example.com', 'example.com', true)).toBe(true);
    });
    test('matches a subdomain with subdomain toggle ON', () => {
        expect(matchesDomainPattern('sub.example.com', 'example.com', true)).toBe(true);
    });
    test('matches a www subdomain with subdomain toggle ON', () => {
        expect(matchesDomainPattern('www.example.com', 'example.com', true)).toBe(true);
    });
    test('matches a deep subdomain with subdomain toggle ON', () => {
        expect(matchesDomainPattern('a.b.example.com', 'example.com', true)).toBe(true);
    });
    test('does not match an unrelated domain even with subdomain toggle ON', () => {
        expect(matchesDomainPattern('notexample.com', 'example.com', true)).toBe(false);
    });
    test('does not match when the pattern is empty', () => {
        expect(matchesDomainPattern('example.com', '', true)).toBe(false);
    });
    test('keeps wildcard patterns working as before with subdomain toggle ON', () => {
        expect(matchesDomainPattern('sub.example.com', '*.example.com', true)).toBe(true);
        expect(matchesDomainPattern('example.com', '*.example.com', true)).toBe(false);
    });
    test('passes the toggle through to isDomainInList', () => {
        expect(isDomainInList('sub.example.com', ['example.com'])).toBe(false);
        expect(isDomainInList('sub.example.com', ['example.com'], true)).toBe(true);
    });
});
