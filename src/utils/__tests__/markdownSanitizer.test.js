/**
 * markdownSanitizer.test.js
 * Markdownサニタイザーのテスト
 * 
 * 【Code Review P1】: XSS対策 - Markdownリンクのサニタイズ
 */

import { sanitizeMarkdownLinks, sanitizeAllMarkdownLinks, sanitizeForObsidian } from '../markdownSanitizer.ts';

describe('markdownSanitizer', () => {
    describe('sanitizeMarkdownLinks', () => {
        it('should escape Markdown links with http URLs', () => {
            const input = '[悪意あるリンク](http://malicious.com)';
            const expected = '\\[悪意あるリンク\\]\\(http://malicious.com\\)';
            expect(sanitizeMarkdownLinks(input)).toBe(expected);
        });

        it('should escape Markdown links with https URLs', () => {
            const input = '[Click here](https://example.com)';
            const expected = '\\[Click here\\]\\(https://example.com\\)';
            expect(sanitizeMarkdownLinks(input)).toBe(expected);
        });

        it('should handle multiple Markdown links', () => {
            const input = 'Check [link1](https://a.com) and [link2](https://b.com)';
            const expected = 'Check \\[link1\\]\\(https://a.com\\) and \\[link2\\]\\(https://b.com\\)';
            expect(sanitizeMarkdownLinks(input)).toBe(expected);
        });

        it('should not escape non-URL patterns', () => {
            const input = '[これは括弧で囲まれたテキスト]';
            expect(sanitizeMarkdownLinks(input)).toBe(input);
        });

        it('should not escape relative URL patterns', () => {
            const input = '[link](/path/to/page)';
            expect(sanitizeMarkdownLinks(input)).toBe(input);
        });

        it('should handle empty string', () => {
            expect(sanitizeMarkdownLinks('')).toBe('');
        });

        it('should handle null input', () => {
            expect(sanitizeMarkdownLinks(null)).toBeNull();
        });

        it('should handle undefined input', () => {
            expect(sanitizeMarkdownLinks(undefined)).toBeUndefined();
        });

        it('should handle non-string input', () => {
            expect(sanitizeMarkdownLinks(123)).toBe(123);
        });

        it('should preserve normal text without links', () => {
            const input = 'This is normal text without any links.';
            expect(sanitizeMarkdownLinks(input)).toBe(input);
        });

        it('should handle mixed content', () => {
            const input = 'Before [link](https://example.com) after';
            const expected = 'Before \\[link\\]\\(https://example.com\\) after';
            expect(sanitizeMarkdownLinks(input)).toBe(expected);
        });
    });

    describe('sanitizeAllMarkdownLinks', () => {
        it('should escape all Markdown link patterns regardless of URL format', () => {
            const input = '[link](/relative/path)';
            const expected = '\\[link\\]\\(/relative/path\\)';
            expect(sanitizeAllMarkdownLinks(input)).toBe(expected);
        });

        it('should escape links with any content in parentheses', () => {
            const input = '[text](anything)';
            const expected = '\\[text\\]\\(anything\\)';
            expect(sanitizeAllMarkdownLinks(input)).toBe(expected);
        });
    });

    describe('sanitizeForObsidian', () => {
        it('should apply all sanitization rules', () => {
            const input = 'Visit [malicious](https://bad.com) for more info';
            const expected = 'Visit \\[malicious\\]\\(https://bad.com\\) for more info';
            expect(sanitizeForObsidian(input)).toBe(expected);
        });

        it('should handle complex content', () => {
            const input = 'Title: [Attack](https://evil.com)\nSummary: More [links](https://bad.org)';
            const expected = 'Title: \\[Attack\\]\\(https://evil.com\\)\nSummary: More \\[links\\]\\(https://bad.org\\)';
            expect(sanitizeForObsidian(input)).toBe(expected);
        });

        it('should preserve legitimate content', () => {
            const input = 'This is a legitimate summary without any links.';
            expect(sanitizeForObsidian(input)).toBe(input);
        });
    });
});
