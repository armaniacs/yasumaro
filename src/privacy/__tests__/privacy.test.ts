// @vitest-environment jsdom
/**
 * privacy.test.ts
 * privacy.ts のユニットテスト
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    escapeHtml,
    renderMarkdown,
    renderInline,
    loadPrivacyPolicy
} from '../privacy.js';

// ============================================================================
// escapeHtml Tests
// ============================================================================

describe('escapeHtml', () => {
    it('should escape ampersands', () => {
        expect(escapeHtml('foo & bar')).toBe('foo &amp; bar');
    });

    it('should escape less-than signs', () => {
        expect(escapeHtml('<div>')).toBe('&lt;div&gt;');
    });

    it('should escape greater-than signs', () => {
        expect(escapeHtml('a > b')).toBe('a &gt; b');
    });

    it('should escape all special characters together', () => {
        // Note: escapeHtml only escapes &, <, > - not quotes or other chars
        expect(escapeHtml('<script>alert("xss") & "test"')).toBe(
            '&lt;script&gt;alert("xss") &amp; "test"'
        );
    });

    it('should handle empty string', () => {
        expect(escapeHtml('')).toBe('');
    });

    it('should handle string with no special characters', () => {
        expect(escapeHtml('Hello World')).toBe('Hello World');
    });
});

// ============================================================================
// renderInline Tests
// ============================================================================

describe('renderInline', () => {
    describe('links', () => {
        it('should render https links', () => {
            const result = renderInline('[OpenAI](https://openai.com)');
            expect(result).toContain('<a href="https://openai.com">OpenAI</a>');
        });

        it('should render anchor links', () => {
            const result = renderInline('[Jump](#section)');
            expect(result).toContain('<a href="#section">Jump</a>');
        });

        it('should escape invalid URLs to #', () => {
            const result = renderInline('[Link](not-a-url)');
            expect(result).toContain('<a href="#">Link</a>');
        });

        it('should escape javascript URLs to #', () => {
            const result = renderInline('[Link](javascript:alert(1))');
            expect(result).toContain('<a href="#">Link</a>');
        });

        it('should handle multiple links', () => {
            const result = renderInline('[A](https://a.com) and [B](https://b.com)');
            expect(result).toContain('<a href="https://a.com">A</a>');
            expect(result).toContain('<a href="https://b.com">B</a>');
        });
    });

    describe('bold', () => {
        it('should render bold text', () => {
            const result = renderInline('This is **bold** text');
            expect(result).toContain('<strong>bold</strong>');
        });

        it('should handle multiple bold sections', () => {
            const result = renderInline('**one** and **two**');
            expect(result).toContain('<strong>one</strong>');
            expect(result).toContain('<strong>two</strong>');
        });
    });

    describe('code', () => {
        it('should render inline code', () => {
            const result = renderInline('Use `code` here');
            expect(result).toContain('<code>code</code>');
        });

        it('should handle multiple code spans', () => {
            const result = renderInline('`a` and `b`');
            expect(result).toContain('<code>a</code>');
            expect(result).toContain('<code>b</code>');
        });
    });

    it('should handle mixed content', () => {
        const result = renderInline('**bold** and `code` and [link](https://example.com)');
        expect(result).toContain('<strong>bold</strong>');
        expect(result).toContain('<code>code</code>');
        expect(result).toContain('<a href="https://example.com">link</a>');
    });

    it('should handle empty string', () => {
        expect(renderInline('')).toBe('');
    });
});

// ============================================================================
// renderMarkdown Tests
// ============================================================================

describe('renderMarkdown', () => {
    describe('horizontal rule', () => {
        it('should render --- as hr', () => {
            const result = renderMarkdown('---');
            expect(result).toBe('<hr>');
        });

        it('should render ---- as hr', () => {
            const result = renderMarkdown('----');
            expect(result).toBe('<hr>');
        });

        it('should render --- with spaces as hr', () => {
            const result = renderMarkdown('   ---   ');
            expect(result).toBe('<hr>');
        });
    });

    describe('headings', () => {
        it('should render h1', () => {
            const result = renderMarkdown('# Heading 1');
            expect(result).toContain('<h1 id="heading-1">Heading 1</h1>');
        });

        it('should render h2', () => {
            const result = renderMarkdown('## Heading 2');
            expect(result).toContain('<h2 id="heading-2">Heading 2</h2>');
        });

        it('should render h3', () => {
            const result = renderMarkdown('### Heading 3');
            expect(result).toContain('<h3 id="heading-3">Heading 3</h3>');
        });

        it('should render h4', () => {
            const result = renderMarkdown('#### Heading 4');
            expect(result).toContain('<h4 id="heading-4">Heading 4</h4>');
        });

        it('should handle heading with 5 hashes (h5)', () => {
            const result = renderMarkdown('##### Heading 5');
            expect(result).toContain('<h5 id="heading-5">Heading 5</h5>');
        });

        it('should treat 6 hashes as paragraph (max is h5)', () => {
            const result = renderMarkdown('###### Heading 6');
            expect(result).not.toContain('<h6');
            expect(result).toContain('<p>###### Heading 6</p>');
        });

        it('should handle heading with special characters', () => {
            const result = renderMarkdown('# Hello & World <test>');
            expect(result).toContain('<h1 id="hello-world-test">');
        });
    });

    describe('blockquote', () => {
        it('should render simple blockquote', () => {
            const result = renderMarkdown('> Quote text');
            expect(result).toContain('<blockquote>');
            expect(result).toContain('Quote text');
        });

        it('should handle multi-line blockquote', () => {
            const result = renderMarkdown('> Line 1\n> Line 2');
            expect(result).toContain('<blockquote>');
            expect(result).toContain('Line 1');
            expect(result).toContain('Line 2');
        });

        it('should handle blockquote with [!NOTE] callout', () => {
            // Note: [!NOTE] is NOT stripped because the regex runs on the renderMarkdown output
            // which has already wrapped it in <p> tags, so ^ doesn't match at string start
            const result = renderMarkdown('> [!NOTE] Note text');
            expect(result).toContain('<blockquote>');
            expect(result).toContain('[!NOTE]'); // [!NOTE] remains due to implementation detail
        });
    });

    describe('table', () => {
        it('should render table with header and rows', () => {
            const md = `| Header 1 | Header 2 |
| --- | --- |
| Cell 1 | Cell 2 |`;
            const result = renderMarkdown(md);
            expect(result).toContain('<table>');
            expect(result).toContain('<th>Header 1</th>');
            expect(result).toContain('<th>Header 2</th>');
            expect(result).toContain('<td>Cell 1</td>');
            expect(result).toContain('<td>Cell 2</td>');
        });
    });

    describe('unordered list', () => {
        it('should render simple unordered list', () => {
            const result = renderMarkdown('- Item 1\n- Item 2');
            expect(result).toContain('<ul>');
            expect(result).toContain('<li>Item 1</li>');
            expect(result).toContain('<li>Item 2</li>');
        });

        it('should render unordered list with asterisks', () => {
            const result = renderMarkdown('* Item 1\n* Item 2');
            expect(result).toContain('<ul>');
            expect(result).toContain('<li>Item 1</li>');
        });

        it('should handle nested lists', () => {
            const result = renderMarkdown('- Item 1\n  - Nested\n  - Nested 2');
            expect(result).toContain('<ul>');
            expect(result).toContain('<li>Item 1</li>');
            expect(result).toContain('<ul>'); // nested
        });
    });

    describe('ordered list', () => {
        it('should render simple ordered list', () => {
            const result = renderMarkdown('1. Item 1\n2. Item 2');
            expect(result).toContain('<ol>');
            expect(result).toContain('<li>Item 1</li>');
            expect(result).toContain('<li>Item 2</li>');
        });

        it('should handle multiple numbered items', () => {
            const result = renderMarkdown('1. First\n2. Second\n3. Third');
            expect(result).toContain('<ol>');
            expect(result).toContain('<li>First</li>');
            expect(result).toContain('<li>Second</li>');
            expect(result).toContain('<li>Third</li>');
        });
    });

    describe('paragraph', () => {
        it('should render paragraph', () => {
            const result = renderMarkdown('This is a paragraph.');
            expect(result).toContain('<p>');
            expect(result).toContain('This is a paragraph.');
            expect(result).toContain('</p>');
        });

        it('should handle multiple paragraphs', () => {
            const result = renderMarkdown('Paragraph 1\n\nParagraph 2');
            expect(result).toContain('<p>Paragraph 1</p>');
            expect(result).toContain('<p>Paragraph 2</p>');
        });
    });

    describe('empty lines', () => {
        it('should skip empty lines', () => {
            const result = renderMarkdown('Line 1\n\n\n\nLine 2');
            expect(result).not.toContain('<p></p>');
            expect(result).toContain('Line 1');
            expect(result).toContain('Line 2');
        });
    });

    describe('mixed content', () => {
        it('should handle document with multiple elements', () => {
            const md = `# Title

## Section

Some text with **bold** and \`code\`.

- List item 1
- List item 2

> A quote
`;
            const result = renderMarkdown(md);
            expect(result).toContain('<h1');
            expect(result).toContain('<h2');
            expect(result).toContain('<strong>bold</strong>');
            expect(result).toContain('<code>code</code>');
            expect(result).toContain('<ul>');
            expect(result).toContain('<li>List item 1</li>');
            expect(result).toContain('<blockquote>');
        });
    });
});

// ============================================================================
// loadPrivacyPolicy Tests
// ============================================================================

describe('loadPrivacyPolicy', () => {
    beforeEach(() => {
        // Reset DOM
        document.body.innerHTML = '<div id="content"></div>';
        // Reset fetch mock
        global.fetch = vi.fn();
    });

    it('should fetch and render PRIVACY.md', async () => {
        const mockMd = '# Privacy Policy\n\nThis is the privacy policy.';
        (global.fetch as any).mockResolvedValueOnce({
            ok: true,
            status: 200,
            text: () => Promise.resolve(mockMd)
        });

        await loadPrivacyPolicy('content');

        expect(global.fetch).toHaveBeenCalledWith('../PRIVACY.md');
        expect(document.getElementById('content')?.innerHTML).toContain('<h1');
    });

    it('should handle fetch error gracefully', async () => {
        (global.fetch as any).mockResolvedValueOnce({
            ok: false,
            status: 404
        });

        await loadPrivacyPolicy('content');

        expect(document.getElementById('content')?.innerHTML).toContain('error');
        expect(document.getElementById('content')?.innerHTML).toContain('読み込みに失敗しました');
    });

    it('should handle network error', async () => {
        (global.fetch as any).mockRejectedValueOnce(new Error('Network error'));

        await loadPrivacyPolicy('content');

        expect(document.getElementById('content')?.innerHTML).toContain('error');
    });

    it('should do nothing if container does not exist', async () => {
        document.body.innerHTML = '';

        // Should not throw
        await loadPrivacyPolicy('nonexistent');

        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should use custom container ID', async () => {
        document.body.innerHTML = '<div id="custom-container"></div>';
        const mockMd = 'Test content';
        (global.fetch as any).mockResolvedValueOnce({
            ok: true,
            status: 200,
            text: () => Promise.resolve(mockMd)
        });

        await loadPrivacyPolicy('custom-container');

        expect(document.getElementById('custom-container')?.innerHTML).toContain('Test content');
    });
});