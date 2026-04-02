import { describe, it, expect } from '@jest/globals';
import { shouldSkipUrl, SKIPPED_PROTOCOLS } from '../urlSkipper.js';

describe('shouldSkipUrl', () => {
    test('SKIPPED_PROTOCOLS is exported and non-empty', () => {
        expect(SKIPPED_PROTOCOLS.length).toBeGreaterThan(0);
    });

    test('skips internal schemes (explicit)', () => {
        expect(shouldSkipUrl('chrome://extensions')).toBe(true);
        expect(shouldSkipUrl('chrome-extension://abc/popup.html')).toBe(true);
        expect(shouldSkipUrl('file:///tmp/test.html')).toBe(true);
        expect(shouldSkipUrl('about:blank')).toBe(true);
        expect(shouldSkipUrl('about:srcdoc')).toBe(true);
        expect(shouldSkipUrl('data:text/html,<h1>test</h1>')).toBe(true);
        expect(shouldSkipUrl('moz-extension://abc/page.html')).toBe(true);
        expect(shouldSkipUrl('edge://settings')).toBe(true);
    });

    test('does NOT skip http/https', () => {
        expect(shouldSkipUrl('http://localhost:8080/page.html')).toBe(false);
        expect(shouldSkipUrl('https://example.com')).toBe(false);
    });

    test('skips empty/invalid URLs', () => {
        expect(shouldSkipUrl('')).toBe(true);
    });
});
