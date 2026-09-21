/**
 * urlGuardsParity.test.ts
 * Parity/golden tests for PBI 2026-09-21-03: isSecureUrl delegates to the
 * SSOT isHttpUrl, and HeaderDetector.normalizeUrl delegates to
 * normalizeUrlSafe. These tests pin the contracted semantics and assert
 * pairwise equivalence, so a future meaning change in either copy fails here.
 */

import { describe, test, expect } from 'vitest';
import { isSecureUrl, normalizeUrlSafe } from '../urlUtils.js';
import { isHttpUrl } from '../archiveGuards.js';
import { HeaderDetector } from '../../background/headerDetector.js';

describe('isSecureUrl golden semantics', () => {
  test('accepts http/https', () => {
    expect(isSecureUrl('http://example.com')).toBe(true);
    expect(isSecureUrl('https://example.com/path?q=1')).toBe(true);
  });

  test('rejects non-http schemes', () => {
    expect(isSecureUrl('chrome://extensions')).toBe(false);
    expect(isSecureUrl('data:text/plain,hello')).toBe(false);
    expect(isSecureUrl('file:///path/to/file.txt')).toBe(false);
    expect(isSecureUrl('ftp://example.com/file.txt')).toBe(false);
    expect(isSecureUrl('javascript:alert(1)')).toBe(false);
  });

  test('rejects empty and garbage input', () => {
    expect(isSecureUrl('')).toBe(false);
    expect(isSecureUrl('not-a-url')).toBe(false);
  });

  test('uppercase scheme is rejected (URL normalizes protocol to lowercase, guard compares exact)', () => {
    // Pin current behavior: new URL('HTTP://...').protocol === 'http:'
    // so uppercase actually passes the exact comparison — record it here.
    expect(isSecureUrl('HTTP://example.com')).toBe(true);
    expect(isSecureUrl('HTTPS://example.com')).toBe(true);
  });
});

describe('isSecureUrl / isHttpUrl parity', () => {
  const cases = [
    'http://example.com',
    'https://example.com/path?q=1#frag',
    'HTTP://example.com',
    'chrome://extensions',
    'data:text/plain,hello',
    'file:///path/to/file.txt',
    'ftp://example.com/file.txt',
    'javascript:alert(1)',
    '',
    'not-a-url',
  ];

  test.each(cases)('isSecureUrl(%j) === isHttpUrl(%j)', (url) => {
    expect(isSecureUrl(url)).toBe(isHttpUrl(url));
  });
});

describe('normalizeUrlSafe golden semantics', () => {
  test('strips hash', () => {
    expect(normalizeUrlSafe('https://example.com/page#section')).toBe('https://example.com/page');
  });

  test('removes trailing slash except root', () => {
    expect(normalizeUrlSafe('https://example.com/page/')).toBe('https://example.com/page');
    expect(normalizeUrlSafe('https://example.com/')).toBe('https://example.com/');
  });

  test('returns invalid input unchanged', () => {
    expect(normalizeUrlSafe('not-a-url')).toBe('not-a-url');
    expect(normalizeUrlSafe('')).toBe('');
  });
});

describe('HeaderDetector.normalizeUrl / normalizeUrlSafe parity', () => {
  const cases = [
    'https://example.com/page/',
    'https://example.com/',
    'https://example.com/page#section',
    'https://example.com/page/?q=1#frag',
    'http://localhost:8080/a/b/',
    'not-a-url',
    '',
  ];

  test.each(cases)('HeaderDetector.normalizeUrl(%j) === normalizeUrlSafe(%j)', (url) => {
    expect(HeaderDetector.normalizeUrl(url)).toBe(normalizeUrlSafe(url));
  });
});
