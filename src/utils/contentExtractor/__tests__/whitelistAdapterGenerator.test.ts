// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
    estimateSelectors,
    generateAdapterDraft,
    buildLlmPrompt,
    CANDIDATE_SELECTORS,
    toHostname,
    toAdapterName,
} from '../whitelistAdapterGenerator.js';

describe('whitelistAdapterGenerator', () => {
    describe('CANDIDATE_SELECTORS', () => {
        it('includes required selectors', () => {
            expect(CANDIDATE_SELECTORS).toContain('article');
            expect(CANDIDATE_SELECTORS).toContain('main');
            expect(CANDIDATE_SELECTORS).toContain('.post-content');
            expect(CANDIDATE_SELECTORS).toContain('.entry-content');
            expect(CANDIDATE_SELECTORS).toContain('#content');
        });
    });

    describe('estimateSelectors - article priority', () => {
        it('prefers article when it has the most text', () => {
            const html = `<!DOCTYPE html><html><body>
                <article><p>${'article text '.repeat(100)}</p></article>
                <div class="sidebar"><p>short</p></div>
                <main><p>${'main text '.repeat(10)}</p></main>
            </body></html>`;
            const scores = estimateSelectors(html);
            expect(scores.length).toBeGreaterThan(0);
            expect(scores[0].selector).toBe('article');
            expect(scores[0].textLength).toBeGreaterThan(500);
        });
    });

    describe('estimateSelectors - main fallback', () => {
        it('falls back to main when article is absent but main has content', () => {
            const html = `<!DOCTYPE html><html><body>
                <main><p>${'main content '.repeat(80)}</p></main>
                <div class="post-content"><p>tiny</p></div>
                <div class="sidebar">ads</div>
            </body></html>`;
            const scores = estimateSelectors(html);
            expect(scores.length).toBeGreaterThan(0);
            expect(scores[0].selector).toBe('main');
        });

        it('falls back to main when article is small and main is larger', () => {
            const html = `<!DOCTYPE html><html><body>
                <article><p>small</p></article>
                <main><p>${'large main content '.repeat(50)}</p></main>
            </body></html>`;
            const scores = estimateSelectors(html);
            expect(scores[0].selector).toBe('main');
            expect(scores.find((s) => s.selector === 'article')?.textLength).toBeLessThan(scores[0].textLength);
        });
    });

    describe('estimateSelectors - ambiguous case', () => {
        it('returns multiple candidates sorted by textLength when ambiguous', () => {
            const html = `<!DOCTYPE html><html><body>
                <article><p>${'a '.repeat(50)}</p></article>
                <main><p>${'b '.repeat(48)}</p></main>
                <div class="post-content"><p>${'c '.repeat(45)}</p></div>
            </body></html>`;
            const scores = estimateSelectors(html);
            expect(scores.length).toBeGreaterThanOrEqual(2);
            // Should be sorted descending
            for (let i = 1; i < scores.length; i++) {
                expect(scores[i - 1].textLength).toBeGreaterThanOrEqual(scores[i].textLength);
            }
        });

        it('returns empty when no candidate matches', () => {
            const html = `<!DOCTYPE html><html><body><div class="unknown"><p>hello</p></div></body></html>`;
            const scores = estimateSelectors(html);
            expect(scores).toEqual([]);
        });

        it('handles empty html', () => {
            const scores = estimateSelectors('');
            expect(scores).toEqual([]);
        });
    });

    describe('generateAdapterDraft', () => {
        it('generates draft with article as detectSelector when article is dominant', () => {
            const html = `<!DOCTYPE html><html><body><article><p>${'x '.repeat(200)}</p></article></body></html>`;
            const draft = generateAdapterDraft('https://example.com/path', html);
            expect(draft.hostname).toBe('example.com');
            expect(draft.name).toBe('example-com');
            expect(draft.detectSelector).toBe('article');
            expect(draft.contentSelectors).toContain('article');
            expect(draft.candidates[0].selector).toBe('article');
        });

        it('generates draft with main when article absent', () => {
            const html = `<!DOCTYPE html><html><body><main><p>${'y '.repeat(200)}</p></main></body></html>`;
            const draft = generateAdapterDraft('https://blog.example.org', html);
            expect(draft.hostname).toBe('blog.example.org');
            expect(draft.detectSelector).toBe('main');
        });

        it('includes up to 2 contentSelectors when second is >=30% of top', () => {
            const html = `<!DOCTYPE html><html><body>
                <article><p>${'a '.repeat(100)}</p></article>
                <main><p>${'b '.repeat(90)}</p></main>
            </body></html>`;
            const draft = generateAdapterDraft('https://example.com', html);
            // Both article and main are large, second is 90% of top -> should include both
            expect(draft.contentSelectors.length).toBe(2);
            expect(draft.contentSelectors).toContain('article');
            expect(draft.contentSelectors).toContain('main');
        });

        it('uses bare hostname when URL without scheme is given', () => {
            const html = `<article><p>${'z '.repeat(50)}</p></article>`;
            const draft = generateAdapterDraft('example.com', html);
            expect(draft.hostname).toBe('example.com');
        });

        it('defaults to article when no candidates', () => {
            const html = `<div><p>no candidate</p></div>`;
            const draft = generateAdapterDraft('https://example.com', html);
            expect(draft.detectSelector).toBe('article');
            expect(draft.contentSelectors).toEqual(['article']);
        });
    });

    describe('buildLlmPrompt', () => {
        it('contains hostname and HTML and constraint text', () => {
            const html = `<article><p>hello world</p></article>`;
            const prompt = buildLlmPrompt(html, 'example.com');
            expect(prompt).toContain('example.com');
            expect(prompt).toContain('hello world');
            expect(prompt).toContain('以下のHTMLから本文セレクタを推論せよ');
            expect(prompt).toContain('JSON');
        });

        it('truncates HTML longer than 8000 chars', () => {
            const longHtml = 'a'.repeat(9000);
            const prompt = buildLlmPrompt(longHtml, 'example.com');
            expect(prompt).toContain('[truncated]');
            expect(prompt.length).toBeLessThan(9500);
        });
    });

    describe('toHostname / toAdapterName', () => {
        it('extracts hostname from URL', () => {
            expect(toHostname('https://sub.example.com/path?q=1')).toBe('sub.example.com');
            expect(toHostname('example.com')).toBe('example.com');
        });
        it('converts hostname to adapter name', () => {
            expect(toAdapterName('www.example.com')).toBe('example-com');
            expect(toAdapterName('sub.domain.co.jp')).toBe('sub-domain-co-jp');
        });
    });
});
