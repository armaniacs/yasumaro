/**
 * urlUtils.test.ts
 * Tests for urlUtils.ts
 */

import { normalizeUrl, isSecureUrl, sanitizeUrlForLogging, urlWithoutPath } from '../urlUtils.js';

describe('isSecureUrl', () => {
    test('treats an http URL as secure', () => {
        expect(isSecureUrl('http://example.com')).toBe(true);
        expect(isSecureUrl('http://localhost:8080')).toBe(true);
    });

    test('treats an https URL as secure', () => {
        expect(isSecureUrl('https://example.com')).toBe(true);
        expect(isSecureUrl('https://example.com/path')).toBe(true);
    });

    test('treats a chrome:// URL as insecure', () => {
        expect(isSecureUrl('chrome://extensions')).toBe(false);
        expect(isSecureUrl('chrome://settings')).toBe(false);
    });

    test('treats a data: URL as insecure', () => {
        expect(isSecureUrl('data:text/plain,hello')).toBe(false);
    });

    test('treats a file: URL as insecure', () => {
        expect(isSecureUrl('file:///path/to/file.txt')).toBe(false);
    });

    test('treats an invalid URL as insecure', () => {
        expect(isSecureUrl('not-a-url')).toBe(false);
        expect(isSecureUrl('')).toBe(false);
    });

    test('treats an ftp: URL as insecure', () => {
        expect(isSecureUrl('ftp://example.com/file.txt')).toBe(false);
    });
});

describe('sanitizeUrlForLogging', () => {
    test('extracts only the domain', () => {
        expect(sanitizeUrlForLogging('https://example.com/path')).toBe('example.com');
        expect(sanitizeUrlForLogging('http://user:pass@example.com:8080/sensitive?q=secret')).toBe('example.com');
    });

    test('handles an invalid URL', () => {
        expect(sanitizeUrlForLogging('not-a-url')).toBe('[INVALID_URL]');
        expect(sanitizeUrlForLogging('')).toBe('[INVALID_URL]');
    });

    test('extracts only the domain from a long path', () => {
        expect(sanitizeUrlForLogging('https://api.service.com/v1/users/123/profile?id=456')).toBe('api.service.com');
    });

    test('returns [INVALID_URL] for a URL with an empty hostname', () => {
        expect(sanitizeUrlForLogging('file:///tmp/file.txt')).toBe('[INVALID_URL]');
        expect(sanitizeUrlForLogging('data:text/plain,hello')).toBe('[INVALID_URL]');
        expect(sanitizeUrlForLogging('blob:https://example.com/uuid')).toBe('[INVALID_URL]');
    });
});

describe('urlWithoutPath', () => {
    test('extracts only protocol, domain, and port', () => {
        expect(urlWithoutPath('https://example.com/path')).toBe('https://example.com');
        expect(urlWithoutPath('http://example.com:8080/path')).toBe('http://example.com:8080');
    });

    test('handles an invalid URL', () => {
        expect(urlWithoutPath('not-a-url')).toBe('[INVALID_URL]');
    });

    test('handles a URL without a port', () => {
        expect(urlWithoutPath('https://service.com/api/v1')).toBe('https://service.com');
    });
});

describe('normalizeUrl', () => {
    test('removes a trailing slash', () => {
        expect(normalizeUrl('https://example.com/')).toBe('https://example.com');
        expect(normalizeUrl('https://example.com/path/')).toBe('https://example.com/path');
    });

    test('lowercases the protocol', () => {
        expect(normalizeUrl('HTTPS://example.com')).toBe('https://example.com');
        expect(normalizeUrl('HTTP://example.com')).toBe('http://example.com');
    });

    test('removes the trailing slash of an http URL', () => {
        expect(normalizeUrl('http://example.com/')).toBe('http://example.com');
        expect(normalizeUrl('HTTP://example.com/')).toBe('http://example.com');
    });

    test('throws for an invalid URL', () => {
        expect(() => normalizeUrl('not-a-url')).toThrow();
    });

    test('returns an already-normalized URL unchanged', () => {
        expect(normalizeUrl('https://example.com')).toBe('https://example.com');
        expect(normalizeUrl('http://localhost:8080')).toBe('http://localhost:8080');
    });

    test('preserves query parameters and fragments', () => {
        expect(normalizeUrl('https://example.com/path?query=value')).toBe('https://example.com/path?query=value');
        expect(normalizeUrl('https://example.com/path#fragment')).toBe('https://example.com/path#fragment');
    });
});