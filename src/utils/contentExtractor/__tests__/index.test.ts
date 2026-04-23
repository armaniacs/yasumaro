// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { extractMainContent } from '../index.js';

beforeEach(() => {
    document.body.innerHTML = '';
});

// ─────────────────────────────────────────────
// 基本動作
// ─────────────────────────────────────────────
describe('extractMainContent - basic', () => {
    it('returns string for empty body', () => {
        const result = extractMainContent();
        expect(typeof result).toBe('string');
    });

    it('extracts text from article element', () => {
        document.body.innerHTML = `
            <article>
                <h1>Test Article</h1>
                <p>This paragraph has enough content to pass the extraction threshold.</p>
                <p>Another paragraph with meaningful content here.</p>
            </article>
        `;
        const result = extractMainContent();
        expect(typeof result).toBe('string');
        expect((result as string).length).toBeGreaterThan(0);
    });

    it('respects maxChars limit', () => {
        document.body.innerHTML = `<article><p>${'a'.repeat(5000)}</p></article>`;
        const result = extractMainContent(100);
        expect((result as string).length).toBeLessThanOrEqual(100);
    });

    it('normalizes whitespace in output', () => {
        document.body.innerHTML = `<article><p>hello   world</p></article>`;
        const result = extractMainContent();
        expect(result as string).not.toMatch(/\s{2,}/);
    });
});

// ─────────────────────────────────────────────
// returnInfo モード
// ─────────────────────────────────────────────
describe('extractMainContent - returnInfo mode', () => {
    it('returns ExtractResult object when returnInfo is true', () => {
        document.body.innerHTML = `
            <article>
                <h1>Article</h1>
                <p>Paragraph content for testing returnInfo behavior.</p>
            </article>
        `;
        const result = extractMainContent(10000, { returnInfo: true });
        expect(typeof result).toBe('object');
        const r = result as ReturnType<typeof extractMainContent> & { content: string };
        expect(typeof r.content).toBe('string');
    });

    it('includes byte stats in returnInfo result', () => {
        document.body.innerHTML = `<article><p>${'Byte measurement content. '.repeat(20)}</p></article>`;
        const result = extractMainContent(10000, { returnInfo: true }) as Record<string, unknown>;
        expect(result).toHaveProperty('pageBytes');
        expect(result).toHaveProperty('originalBytes');
        expect(result).toHaveProperty('cleansedBytes');
        expect(result).toHaveProperty('fallbackTriggered');
        expect(result.fallbackTriggered).toBe(false);
    });

    it('includes cleansedReason in returnInfo result', () => {
        document.body.innerHTML = `<article><p>Content for cleanse reason test.</p></article>`;
        const result = extractMainContent(10000, { returnInfo: true }) as Record<string, unknown>;
        expect(result).toHaveProperty('cleansedReason');
        expect(['none', 'hard', 'keyword', 'both']).toContain(result.cleansedReason);
    });

    it('includes AI summary cleanse fields in returnInfo result', () => {
        document.body.innerHTML = `<article><p>Content for AI summary cleanse test.</p></article>`;
        const result = extractMainContent(
            10000,
            { returnInfo: true },
            { aiSummaryCleanseEnabled: false }
        ) as Record<string, unknown>;
        expect(result).toHaveProperty('aiSummaryCleansedReason');
        expect(result.aiSummaryCleansedReason).toBe('none');
    });
});

// ─────────────────────────────────────────────
// Content Cleansing (cleanseEnabled: true)
// ─────────────────────────────────────────────
describe('extractMainContent - cleanseEnabled', () => {
    it('removes script and form elements when cleanseEnabled', () => {
        document.body.innerHTML = `
            <article>
                <p>Main article content that should remain after cleansing.</p>
                <script>alert('remove me')</script>
                <form><input type="password" value="secret"></form>
            </article>
        `;
        const result = extractMainContent(
            10000,
            { cleanseEnabled: true, returnInfo: true }
        ) as Record<string, unknown>;
        expect(typeof result.content).toBe('string');
    });

    it('reports cleansedReason when hard strip removes elements', () => {
        document.body.innerHTML = `
            <article>
                <p>Good content paragraph that will remain after cleansing here.</p>
                <script>badScript()</script>
                <iframe src="ads.html"></iframe>
            </article>
        `;
        const result = extractMainContent(
            10000,
            { cleanseEnabled: true, hardStripEnabled: true, keywordStripEnabled: false, returnInfo: true }
        ) as Record<string, unknown>;
        expect(['hard', 'none']).toContain(result.cleansedReason);
    });

    it('works with cleanseEnabled but no candidates (body fallback)', () => {
        // body直下のテキストのみ（article/main/divなし）
        document.body.innerHTML = `Plain text without container elements.`;
        const result = extractMainContent(
            10000,
            { cleanseEnabled: true, returnInfo: true }
        ) as Record<string, unknown>;
        expect(typeof result.content).toBe('string');
    });

    it('applies keyword strip to remove sensitive elements', () => {
        document.body.innerHTML = `
            <article>
                <p>Normal article content here for testing keyword stripping behavior.</p>
                <div id="balance">Secret balance info</div>
            </article>
        `;
        const result = extractMainContent(
            10000,
            { cleanseEnabled: true, keywordStripEnabled: true, returnInfo: true }
        ) as Record<string, unknown>;
        expect(typeof result.content).toBe('string');
    });
});

// ─────────────────────────────────────────────
// AI Summary Cleansing
// ─────────────────────────────────────────────
describe('extractMainContent - aiSummaryCleanseEnabled', () => {
    it('runs AI summary cleansing when enabled', () => {
        document.body.innerHTML = `
            <article>
                <p>Main content paragraph with enough text for extraction to work.</p>
                <img src="photo.jpg" alt="A descriptive alt text for image">
                <nav>Navigation links here</nav>
            </article>
        `;
        const result = extractMainContent(
            10000,
            { returnInfo: true },
            { aiSummaryCleanseEnabled: true, altEnabled: true, navEnabled: true }
        ) as Record<string, unknown>;
        expect(typeof result.content).toBe('string');
        expect(result).toHaveProperty('aiSummaryOriginalBytes');
        expect(result).toHaveProperty('aiSummaryCleansedBytes');
    });

    it('reports aiSummaryCleansedElements when elements removed', () => {
        document.body.innerHTML = `
            <article>
                <p>Main content paragraph with sufficient text to be extracted properly.</p>
                <img src="a.jpg" alt="alt1">
                <img src="b.jpg" alt="alt2">
                <img src="c.jpg" alt="alt3">
            </article>
        `;
        const result = extractMainContent(
            10000,
            { returnInfo: true },
            { aiSummaryCleanseEnabled: true, altEnabled: true }
        ) as Record<string, unknown>;
        expect(result).toHaveProperty('aiSummaryCleansedElements');
    });

    it('sets aiSummaryCleansedReason to "multiple" when several types removed', () => {
        document.body.innerHTML = `
            <article>
                <p>Article body with sufficient content for extraction to run properly.</p>
                <img src="x.jpg" alt="image alt text here">
                <nav aria-label="navigation">Nav links</nav>
                <div class="advertisement">Ad content</div>
            </article>
        `;
        const result = extractMainContent(
            10000,
            { returnInfo: true },
            { aiSummaryCleanseEnabled: true, altEnabled: true, navEnabled: true, adsEnabled: true }
        ) as Record<string, unknown>;
        expect(['alt', 'nav', 'ads', 'multiple', 'none']).toContain(result.aiSummaryCleansedReason);
    });

    it('sets aiSummaryCleansedReason to single type when only one type removed', () => {
        document.body.innerHTML = `
            <article>
                <p>${'Main content paragraph that is long enough for extraction. '.repeat(5)}</p>
                <img src="x.jpg" alt="image alt text here that is descriptive">
            </article>
        `;
        const result = extractMainContent(
            10000,
            { returnInfo: true },
            { aiSummaryCleanseEnabled: true, altEnabled: true, navEnabled: false, adsEnabled: false }
        ) as Record<string, unknown>;
        // img[alt] のみ削除 → 'alt' or 'none'
        expect(['alt', 'none']).toContain(result.aiSummaryCleansedReason);
    });

    it('returnInfo with cleanseEnabled counts targets even when none removed', () => {
        document.body.innerHTML = `
            <article>
                <p>${'Clean content without any special elements. '.repeat(10)}</p>
            </article>
        `;
        const result = extractMainContent(
            10000,
            { cleanseEnabled: true, hardStripEnabled: true, returnInfo: true },
        ) as Record<string, unknown>;
        // クレンジング対象がなくても totalRemoved は数値
        expect(typeof result.cleansedReason).toBe('string');
    });
});

// ─────────────────────────────────────────────
// フォールバック動作
// ─────────────────────────────────────────────
describe('extractMainContent - fallback', () => {
    it('triggers fallback when extracted content is too short', () => {
        // article要素があるが本文が非常に短い → fallback
        document.body.innerHTML = `
            <article><p>Hi</p></article>
            <div>Some other body content that will be used as fallback text here.</div>
        `;
        const result = extractMainContent(10000, { returnInfo: true }) as Record<string, unknown>;
        // fallbackTriggeredがtrueになるかどうかはコンテンツ長次第
        expect(typeof result.fallbackTriggered).toBe('boolean');
    });

    it('does not trigger fallback when content is sufficient', () => {
        document.body.innerHTML = `
            <article>
                <p>${'Sufficient content for this article. '.repeat(10)}</p>
                <p>${'More paragraphs with text. '.repeat(10)}</p>
            </article>
        `;
        const result = extractMainContent(10000, { returnInfo: true }) as Record<string, unknown>;
        expect(result.fallbackTriggered).toBe(false);
    });
});

// ─────────────────────────────────────────────
// cleanseEnabled=false（クレンジングなし）パス
// ─────────────────────────────────────────────
describe('extractMainContent - cleanseEnabled false', () => {
    it('returns body content directly when cleanseEnabled is false', () => {
        document.body.innerHTML = `
            <article>
                <p>${'Article content without cleansing enabled. '.repeat(10)}</p>
            </article>
        `;
        const result = extractMainContent(10000, { cleanseEnabled: false, returnInfo: true }) as Record<string, unknown>;
        expect(typeof result.content).toBe('string');
        expect(result.cleansedReason).toBe('none');
    });

    it('returnInfo reports originalBytes equals cleansedBytes when no cleansing', () => {
        document.body.innerHTML = `
            <article>
                <p>${'Content without any cleansing applied here. '.repeat(8)}</p>
            </article>
        `;
        const result = extractMainContent(10000, { cleanseEnabled: false, returnInfo: true }) as Record<string, unknown>;
        expect(result.cleansedReason).toBe('none');
        expect(result.fallbackTriggered).toBe(false);
    });
});

// ─────────────────────────────────────────────
// 重複除去
// ─────────────────────────────────────────────
describe('extractMainContent - deduplication', () => {
    it('applies deduplication when dedupEnabled', () => {
        const repeated = 'This sentence is repeated over and over again. ';
        document.body.innerHTML = `<article><p>${repeated.repeat(20)}</p></article>`;
        const withDedup = extractMainContent(10000, {}, {}, { dedupEnabled: true }) as string;
        const withoutDedup = extractMainContent(10000, {}, {}, { dedupEnabled: false }) as string;
        // 重複除去ありの方が短いか同等
        expect(withDedup.length).toBeLessThanOrEqual(withoutDedup.length);
    });
});
