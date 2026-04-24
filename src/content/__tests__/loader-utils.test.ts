import { describe, it, expect } from 'vitest';
import { shouldSkipUrl, extractDomain, matchesPattern, isDomainInList } from '../urlSkipper.js';

describe('shouldSkipUrl', () => {
    it('returns true for chrome:// URLs', () => {
        expect(shouldSkipUrl('chrome://extensions/')).toBe(true);
    });

    it('returns true for chrome-extension:// URLs', () => {
        expect(shouldSkipUrl('chrome-extension://abcdef/popup.html')).toBe(true);
    });

    it('returns true for about:blank', () => {
        expect(shouldSkipUrl('about:blank')).toBe(true);
    });

    it('returns true for data: URLs', () => {
        expect(shouldSkipUrl('data:text/html,<h1>test</h1>')).toBe(true);
    });

    it('returns true for file:// URLs', () => {
        expect(shouldSkipUrl('file:///Users/test/index.html')).toBe(true);
    });

    it('returns true for empty string', () => {
        expect(shouldSkipUrl('')).toBe(true);
    });

    it('returns false for regular http URLs', () => {
        expect(shouldSkipUrl('https://example.com/article')).toBe(false);
    });

    it('returns false for https URLs', () => {
        expect(shouldSkipUrl('https://news.ycombinator.com')).toBe(false);
    });
});

describe('extractDomain', () => {
    it('extracts domain from https URL', () => {
        expect(extractDomain('https://example.com/path')).toBe('example.com');
    });

    it('strips www. prefix', () => {
        expect(extractDomain('https://www.example.com/path')).toBe('example.com');
    });

    it('handles subdomain without www', () => {
        expect(extractDomain('https://blog.example.com/post')).toBe('blog.example.com');
    });

    it('returns null for invalid URL', () => {
        expect(extractDomain('not-a-url')).toBeNull();
    });

    it('handles URL with port', () => {
        expect(extractDomain('http://localhost:3000/page')).toBe('localhost');
    });
});

describe('matchesPattern', () => {
    it('matches exact domain', () => {
        expect(matchesPattern('example.com', 'example.com')).toBe(true);
    });

    it('is case-insensitive for exact match', () => {
        expect(matchesPattern('Example.COM', 'example.com')).toBe(true);
    });

    it('returns false for non-matching domain', () => {
        expect(matchesPattern('other.com', 'example.com')).toBe(false);
    });

    it('matches wildcard pattern', () => {
        expect(matchesPattern('sub.example.com', '*.example.com')).toBe(true);
    });

    it('wildcard does not match root domain', () => {
        expect(matchesPattern('example.com', '*.example.com')).toBe(false);
    });

    it('matches broad wildcard', () => {
        expect(matchesPattern('anything.io', '*.io')).toBe(true);
    });
});

describe('isDomainInList', () => {
    it('returns false for empty list', () => {
        expect(isDomainInList('example.com', [])).toBe(false);
    });

    it('returns false for undefined list', () => {
        expect(isDomainInList('example.com', undefined)).toBe(false);
    });

    it('returns true when domain is in list', () => {
        expect(isDomainInList('example.com', ['other.com', 'example.com'])).toBe(true);
    });

    it('returns false when domain is not in list', () => {
        expect(isDomainInList('example.com', ['other.com', 'third.com'])).toBe(false);
    });

    it('matches wildcard pattern in list', () => {
        expect(isDomainInList('sub.example.com', ['*.example.com'])).toBe(true);
    });
});
