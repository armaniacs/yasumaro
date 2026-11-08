// @vitest-environment jsdom
/**
 * privacy-r2.test.ts
 * PBI 2026-11-08-15 の回帰テスト: 見出しh6・重複id・括弧含みURL・
 * 太字/コード順序・上限のlimits共有。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../utils/i18n.js', async () => {
    const { mockGetMessage: i18nMock } = await import('../../../testDir/i18nMock.js');
    const getMessage = vi.fn((key: string) => {
        const messages: Record<string, string> = {
            loading: 'Loading...',
            privacyPolicyTitle: 'Privacy Policy — Yasumaro',
            privacyPolicyLoadError: 'Failed to load the privacy policy.',
        };
        return messages[key] || key;
    });
    return { ...i18nMock(getMessage), applyI18n: vi.fn() };
});

import { renderMarkdown, renderInline, loadPrivacyPolicy } from '../privacy.js';
import { MAX_PRIVACY_POLICY_BYTES } from '../../utils/limits.js';

describe('privacy', () => {
    describe('renderMarkdown headings', () => {
        it('renders h1 through h6 as headings', () => {
            const cases: Array<[string, string]> = [
                ['# T', '<h1 id="t">T</h1>'],
                ['## T', '<h2 id="t">T</h2>'],
                ['### T', '<h3 id="t">T</h3>'],
                ['#### T', '<h4 id="t">T</h4>'],
                ['##### T', '<h5 id="t">T</h5>'],
                ['###### T', '<h6 id="t">T</h6>'],
            ];
            for (const [md, html] of cases) {
                expect(renderMarkdown(md)).toContain(html);
            }
        });

        it('assigns unique ids to duplicate headings', () => {
            const result = renderMarkdown('## Foo\n\n## Foo\n\n## Foo');
            expect(result).toContain('<h2 id="foo">Foo</h2>');
            expect(result).toContain('<h2 id="foo-1">Foo</h2>');
            expect(result).toContain('<h2 id="foo-2">Foo</h2>');
        });

        it('keeps ids unique across heading levels', () => {
            const result = renderMarkdown('## Foo\n\n### Foo');
            expect(result).toContain('<h2 id="foo">Foo</h2>');
            expect(result).toContain('<h3 id="foo-1">Foo</h3>');
        });
    });

    describe('renderInline links', () => {
        it('keeps parenthesized URLs intact instead of cutting at the first )', () => {
            const result = renderInline('[Media](https://en.wikipedia.org/wiki/Test_(exam))');
            expect(result).toContain('Test_(exam)');
            expect(result).not.toContain('href="#"');
        });

        it('handles multiple parenthesized groups in one URL', () => {
            const result = renderInline('[X](https://example.com/a_(b)_c_(d))');
            expect(result).toContain('a_(b)_c_(d)');
        });

        it('still falls back to # for unsafe schemes with parens', () => {
            const result = renderInline('[X](http://example.com/(foo))');
            expect(result).toContain('<a href="#">X</a>');
        });
    });

    describe('renderInline code and bold', () => {
        it('does not interpret bold markers inside code spans', () => {
            const result = renderInline('Use `**not bold**` here');
            expect(result).toContain('<code>**not bold**</code>');
            expect(result).not.toContain('<strong>');
        });

        it('does not double-escape code nested in bold', () => {
            const result = renderInline('**`<b>`**');
            expect(result).toContain('<code>&lt;b&gt;</code>');
            expect(result).not.toContain('&amp;lt;');
        });

        it('still renders adjacent bold and code spans', () => {
            const result = renderInline('**bold** and `code`');
            expect(result).toContain('<strong>bold</strong>');
            expect(result).toContain('<code>code</code>');
        });
    });

    describe('loadPrivacyPolicy size limit', () => {
        beforeEach(() => {
            document.body.innerHTML = '<div id="content"></div>';
            global.fetch = vi.fn();
        });

        it('shares the 1MB cap with the limits registry', () => {
            expect(MAX_PRIVACY_POLICY_BYTES).toBe(1024 * 1024);
        });

        it('rejects content over the shared cap', async () => {
            (global.fetch as any).mockResolvedValueOnce({
                ok: true,
                status: 200,
                headers: {
                    get: (name: string) => (name === 'content-length' ? String(MAX_PRIVACY_POLICY_BYTES + 1) : null),
                },
                text: () => Promise.resolve('should not be used'),
            });

            await loadPrivacyPolicy('content');

            expect(document.getElementById('content')?.innerHTML).toContain('error');
        });

        it('accepts content exactly at the shared cap', async () => {
            (global.fetch as any).mockResolvedValueOnce({
                ok: true,
                status: 200,
                headers: {
                    get: (name: string) => (name === 'content-length' ? String(MAX_PRIVACY_POLICY_BYTES) : null),
                },
                text: () => Promise.resolve('# Within limit'),
            });

            await loadPrivacyPolicy('content');

            expect(document.getElementById('content')?.innerHTML).toContain('<h1');
        });

        it('rejects an over-size body when the header is missing (post-read check)', async () => {
            (global.fetch as any).mockResolvedValueOnce({
                ok: true,
                status: 200,
                headers: { get: () => null },
                text: () => Promise.resolve('x'.repeat(MAX_PRIVACY_POLICY_BYTES + 1)),
            });

            await loadPrivacyPolicy('content');

            expect(document.getElementById('content')?.innerHTML).toContain('error');
        });

        it('measures the post-read cap in UTF-8 bytes, not UTF-16 code units', async () => {
            // 'あ' is 3 bytes in UTF-8 but 1 UTF-16 unit: a body of
            // cap/3 + 1 chars passes a length check yet exceeds the byte cap.
            const overByChars = 'あ'.repeat(Math.floor(MAX_PRIVACY_POLICY_BYTES / 3) + 1);
            expect(overByChars.length).toBeLessThan(MAX_PRIVACY_POLICY_BYTES);
            (global.fetch as any).mockResolvedValueOnce({
                ok: true,
                status: 200,
                headers: { get: () => null },
                text: () => Promise.resolve(overByChars),
            });

            await loadPrivacyPolicy('content');

            expect(document.getElementById('content')?.innerHTML).toContain('error');
        });
    });
});
