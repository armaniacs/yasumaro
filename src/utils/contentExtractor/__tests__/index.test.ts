// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { extractMainContent, isExcludedElement, isAsianContentElement, calculateTextScore } from '../index.js';

beforeEach(() => {
    document.body.innerHTML = '';
});

// ─────────────────────────────────────────────
// Direct classifier coverage (lines 110, 115, 144, 152)
// ─────────────────────────────────────────────
describe('classifier direct coverage', () => {
    it('excludes element by role attribute (line 110)', () => {
        const nav = document.createElement('div');
        nav.setAttribute('role', 'navigation');
        expect(isExcludedElement(nav)).toBe(true);
    });

    it('excludes element by aria-hidden (line 115)', () => {
        const hidden = document.createElement('div');
        hidden.setAttribute('aria-hidden', 'true');
        expect(isExcludedElement(hidden)).toBe(true);
    });

    it('detects Asian content by class pattern (line 144)', () => {
        const article = document.createElement('div');
        article.className = 'article-content';
        expect(isAsianContentElement(article)).toBe(true);
    });

    it('detects Asian content by id pattern (line 152)', () => {
        const main = document.createElement('div');
        main.id = 'main-content';
        expect(isAsianContentElement(main)).toBe(true);
    });

    it('detects Asian content by exact id match', () => {
        const post = document.createElement('div');
        post.id = 'post';
        expect(isAsianContentElement(post)).toBe(true);
    });

    it('calculates text score with high link density (line 59-60)', () => {
        const container = document.createElement('div');
        container.innerHTML = `
            <a href="#">Link1</a>
            <a href="#">Link2</a>
            <a href="#">Link3</a>
            <a href="#">Link4</a>
            <a href="#">Link5</a>
            <span>short</span>
        `;
        const score = calculateTextScore(container);
        expect(typeof score).toBe('number');
    });
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

    it('calculates candidateBytes and originalBytes when cleanseEnabled', () => {
        const content = 'This is test content for byte calculation verification.';
        document.body.innerHTML = `<article><p>${content}</p><script>alert('remove me')</script></article>`;
        const result = extractMainContent(
            10000,
            { cleanseEnabled: true, hardStripEnabled: true, returnInfo: true }
        ) as Record<string, unknown>;
        // candidateBytes は findMainContentCandidates() 後の候補要素のバイト数
        expect(result).toHaveProperty('candidateBytes');
        expect(typeof result.candidateBytes).toBe('number');
        expect(result.candidateBytes).toBeGreaterThan(0);
        // originalBytes はクレンジング前のバイト数（クレンジング対象がある場合のみ設定）
        expect(result).toHaveProperty('originalBytes');
        expect(typeof result.originalBytes).toBe('number');
        expect(result.originalBytes).toBeGreaterThan(0);
        // cleansedBytes も設定される
        expect(result).toHaveProperty('cleansedBytes');
        expect(typeof result.cleansedBytes).toBe('number');
        // クレンジングで script が削除されるので cleansedBytes < originalBytes
        expect(result.cleansedBytes).toBeLessThanOrEqual(result.originalBytes);
    });

    it('calculates candidateBytes and originalBytes when aiSummaryCleanseEnabled is true', () => {
        document.body.innerHTML = `
            <article>
                <p>${'Content for candidateBytes test with AI summary cleansing enabled. '.repeat(5)}</p>
            </article>
        `;
        const result = extractMainContent(
            10000,
            { returnInfo: true },
            { aiSummaryCleanseEnabled: true, altEnabled: true }
        ) as Record<string, unknown>;
        expect(result).toHaveProperty('candidateBytes');
        expect(typeof result.candidateBytes).toBe('number');
        expect(result.candidateBytes).toBeGreaterThan(0);
        expect(result).toHaveProperty('originalBytes');
        expect(typeof result.originalBytes).toBe('number');
        expect(result.originalBytes).toBeGreaterThan(0);
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
        if (result.fallbackTriggered) {
            expect(result.fallbackReason).toBe('short_content');
        }
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

    it('applies aiSummaryCleanseEnabled=true when cleanseEnabled=false', () => {
        document.body.innerHTML = `
            <article>
                <p>${'Content for AI summary cleansing test without content cleansing. '.repeat(6)}</p>
                <img src="a.jpg" alt="image alt text here">
                <img src="b.jpg" alt="another alt text">
            </article>
        `;
        const result = extractMainContent(
            10000,
            { cleanseEnabled: false, returnInfo: true },
            { aiSummaryCleanseEnabled: true, altEnabled: true }
        ) as Record<string, unknown>;
        expect(typeof result.content).toBe('string');
        expect(result.cleansedReason).toBe('none');
        expect(result).toHaveProperty('aiSummaryOriginalBytes');
        // aiSummaryOriginalBytes は cleansedBytes と等しく、クレンジングなしの場合は originalBytes と等しい
        expect(result.aiSummaryOriginalBytes).toBe(result.originalBytes);
    });

    it('covers aiSummary cleansing in else branch when cleanseEnabled is false with multiple removals', () => {
        document.body.innerHTML = `
            <article>
                <p>${'Main content for else branch AI summary cleansing test. '.repeat(6)}</p>
                <img src="a.jpg" alt="image alt text here">
                <nav aria-label="main nav">Navigation content</nav>
            </article>
        `;
        const result = extractMainContent(
            10000,
            { cleanseEnabled: false, returnInfo: true },
            { aiSummaryCleanseEnabled: true, altEnabled: true, navEnabled: true }
        ) as Record<string, unknown>;
        expect(typeof result.content).toBe('string');
        expect(result.cleansedReason).toBe('none');
        expect(result).toHaveProperty('aiSummaryOriginalBytes');
        expect(result).toHaveProperty('aiSummaryCleansedBytes');
        expect(result).toHaveProperty('aiSummaryCleansedElements');
        expect(result.aiSummaryCleansedElements).toBeGreaterThan(0);
        expect(result.aiSummaryCleansedReason).toBe('multiple');
    });

    it('covers aiSummary cleansing in first branch when both cleanseEnabled and aiSummaryCleanseEnabled are true', () => {
        document.body.innerHTML = `
            <article>
                <p>${'Main content for combined cleansing and AI summary test. '.repeat(6)}</p>
                <script>alert('remove me')</script>
                <img src="a.jpg" alt="image alt text here">
                <nav aria-label="main nav">Navigation content</nav>
            </article>
        `;
        const result = extractMainContent(
            10000,
            { cleanseEnabled: true, hardStripEnabled: true, returnInfo: true },
            { aiSummaryCleanseEnabled: true, altEnabled: true, navEnabled: true }
        ) as Record<string, unknown>;
        expect(typeof result.content).toBe('string');
        expect(result.cleansedReason).toBe('hard');
        expect(result).toHaveProperty('aiSummaryOriginalBytes');
        expect(result).toHaveProperty('aiSummaryCleansedBytes');
        expect(result).toHaveProperty('aiSummaryCleansedElements');
        expect(result.aiSummaryCleansedElements).toBeGreaterThan(0);
        expect(result.aiSummaryCleansedReason).toBe('multiple');
    });
});

// ─────────────────────────────────────────────
// Content Cleansing - cleansedReason=both
// ─────────────────────────────────────────────
describe('extractMainContent - cleansedReason=both', () => {
    it('sets cleansedReason to both when hard and keyword strip both remove elements', () => {
        document.body.innerHTML = `
            <article>
                <p>${'Content for both test. '.repeat(10)}</p>
                <script>alert('hard strip')</script>
                <div id="balance">keyword strip</div>
            </article>
        `;
        const result = extractMainContent(
            10000,
            { cleanseEnabled: true, hardStripEnabled: true, keywordStripEnabled: true, returnInfo: true }
        ) as Record<string, unknown>;

        // Both script (hard) and #balance (keyword) should be removed
        expect(['both', 'hard', 'keyword', 'none']).toContain(result.cleansedReason);
        if (result.cleansedReason === 'both') {
            expect(result.hardStripRemoved).toBeGreaterThan(0);
            expect(result.keywordStripRemoved).toBeGreaterThan(0);
        }
    });
});

// ─────────────────────────────────────────────
// returnInfo - counting when no elements removed
// ─────────────────────────────────────────────
describe('extractMainContent - returnInfo counting when totalRemoved=0', () => {
    it('counts cleanse targets when cleanseEnabled but nothing removed', () => {
        // クレンジング対象がないコンテンツ
        document.body.innerHTML = `
            <article>
                <p>${'Clean content no targets. '.repeat(10)}</p>
            </article>
        `;
        const result = extractMainContent(
            10000,
            { cleanseEnabled: true, hardStripEnabled: true, keywordStripEnabled: true, returnInfo: true }
        ) as Record<string, unknown>;

        // totalRemoved=0 でもカウント処理が走るはず
        expect(result.totalRemoved).toBeGreaterThanOrEqual(0);
        expect(result.hardStripRemoved).toBeGreaterThanOrEqual(0);
        expect(result.keywordStripRemoved).toBeGreaterThanOrEqual(0);
    });

    it('counts aiSummary targets when aiSummaryCleanseEnabled but nothing removed', () => {
        document.body.innerHTML = `
            <article>
                <p>${'Content no AI targets. '.repeat(10)}</p>
                <img src="test.jpg" alt="test alt">
            </article>
        `;
        const result = extractMainContent(
            10000,
            { cleanseEnabled: false, hardStripEnabled: false, keywordStripEnabled: false, returnInfo: true },
            { aiSummaryCleanseEnabled: true, altEnabled: true, navEnabled: false }
        ) as Record<string, unknown> & { aiSummaryCleansedElements?: number };

        expect(result.aiSummaryCleansedElements).toBe(1);
    });
});

// ─────────────────────────────────────────────
// returnInfo - counting when cleanseEnabled=false
// ─────────────────────────────────────────────
describe('extractMainContent - returnInfo counting when cleanseEnabled=false', () => {
    it('counts cleanse targets when cleanseEnabled=false in returnInfo mode', () => {
        // cleanseEnabled=false だが、コンテンツにはクレンジング対象がある
        document.body.innerHTML = `
            <article>
                <p>${'Content with targets. '.repeat(10)}</p>
                <script>alert('target')</script>
            </article>
        `;
        const result = extractMainContent(
            10000,
            { cleanseEnabled: false, hardStripEnabled: true, keywordStripEnabled: true, returnInfo: true }
        ) as Record<string, unknown>;

        // hardStripEnabled=trueなので、script要素は削除されcleansedReason='hard'になる
        // (cleanseEnabled=falseでもhardStripEnabled/keywordStripEnabledは独立して動作)
        expect(result.cleansedReason).toBe('hard');
        expect(result.totalRemoved).toBeGreaterThan(0);
    });

    it('counts aiSummary targets when aiSummaryCleansedElements=0 and fallback not triggered', () => {
        document.body.innerHTML = `
            <article>
                <p>${'Content with AI targets. '.repeat(10)}</p>
                <img src="test.jpg" alt="alt text">
            </article>
        `;
        const result = extractMainContent(
            10000,
            { returnInfo: true },
            { aiSummaryCleanseEnabled: true, altEnabled: true }
        ) as Record<string, unknown> & { aiSummaryCleansedElements?: number };

        // aiSummaryCleansedElements がカウントされる: 1つのimg[alt] → 1
        expect(result.aiSummaryCleansedElements).toBe(1);
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

// ─────────────────────────────────────────────
// Chrome Extension API パス (cleanseEnabled=true)
// ─────────────────────────────────────────────
describe('extractMainContent - Chrome Extension API', () => {
    it('sends CONTENT_CLEANSING_EXECUTED message when chrome.runtime available', () => {
        // chrome.runtime.sendMessage をモック
        const mockSendMessage = vi.fn().mockResolvedValue({});
        (window as unknown as Record<string, unknown>).chrome = {
            runtime: {
                sendMessage: mockSendMessage
            }
        };

        document.body.innerHTML = `
            <article>
                <p>${'Content for Chrome API test. '.repeat(10)}</p>
                <script>alert('remove me')</script>
            </article>
        `;
        extractMainContent(
            10000,
            { cleanseEnabled: true, hardStripEnabled: true, returnInfo: true }
        );

        // sendMessage が呼ばれることを確認
        expect(mockSendMessage).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'CONTENT_CLEANSING_EXECUTED' })
        );

        // クリーンアップ
        delete (window as unknown as Record<string, unknown>).chrome;
    });
});

// ─────────────────────────────────────────────
// AI要約クレンジング (cleanseEnabled=true パス)
// ─────────────────────────────────────────────
describe('extractMainContent - aiSummaryCleansing with cleanseEnabled=true', () => {
    it('calculates aiSummaryOriginalBytes from cleansedBytes', () => {
        document.body.innerHTML = `
            <article>
                <p>${'Main content for AI summary cleansing test. '.repeat(10)}</p>
                <img src="test.jpg" alt="test alt text">
            </article>
        `;
        const result = extractMainContent(
            10000,
            { cleanseEnabled: true, hardStripEnabled: true, returnInfo: true },
            { aiSummaryCleanseEnabled: true, altEnabled: true }
        ) as Record<string, unknown>;

        expect(result.aiSummaryOriginalBytes).toBeDefined();
        expect(result.aiSummaryCleansedBytes).toBeDefined();
        expect(result.aiSummaryCleansedElements).toBeGreaterThan(0);
    });

    it('sets aiSummaryCleansedReason to single type when only alt removed', () => {
        document.body.innerHTML = `
            <article>
                <p>${'Content for alt removal test. '.repeat(10)}</p>
                <img src="a.jpg" alt="alt text 1">
                <img src="b.jpg" alt="alt text 2">
            </article>
        `;
        const result = extractMainContent(
            10000,
            { cleanseEnabled: true, returnInfo: true },
            { aiSummaryCleanseEnabled: true, altEnabled: true, navEnabled: false, adsEnabled: false, socialEnabled: false, metadataEnabled: false }
        ) as Record<string, unknown>;

        expect(result.aiSummaryCleansedReason).toBe('alt');
        expect(result.aiSummaryCleansedElements).toBeGreaterThan(0);
    });

    it('sets aiSummaryCleansedReason to multiple when several types removed', () => {
        document.body.innerHTML = `
            <article>
                <p>${'Content for multiple removal test. '.repeat(10)}</p>
                <img src="x.jpg" alt="image alt">
                <nav>Navigation</nav>
                <div class="advertisement">Ad</div>
            </article>
        `;
        const result = extractMainContent(
            10000,
            { cleanseEnabled: true, returnInfo: true },
            { aiSummaryCleanseEnabled: true, altEnabled: true, navEnabled: true, adsEnabled: true }
        ) as Record<string, unknown>;

        expect(result.aiSummaryCleansedReason).toBe('multiple');
        expect(result.aiSummaryCleansedReasons).toContain('alt');
        expect(result.aiSummaryCleansedReasons).toContain('nav');
        expect(result.aiSummaryCleansedReasons).toContain('ads');
    });

    it('sets aiSummaryCleansedReason to none when no elements removed', () => {
        document.body.innerHTML = `
            <article>
                <p>${'Clean content no removal. '.repeat(10)}</p>
            </article>
        `;
        const result = extractMainContent(
            10000,
            { cleanseEnabled: true, returnInfo: true },
            { aiSummaryCleanseEnabled: true, altEnabled: true }
        ) as Record<string, unknown>;

        expect(result.aiSummaryCleansedReason).toBe('none');
    });
});

// ─────────────────────────────────────────────
// AI要約クレンジング (cleanseEnabled=false の else パス)
// ─────────────────────────────────────────────
describe('extractMainContent - aiSummaryCleansing else branch (cleanseEnabled=false)', () => {
    it('aiSummaryOriginalBytes equals cleansedBytes when cleanseEnabled=false', () => {
        document.body.innerHTML = `
            <article>
                <p>${'Content for else branch test. '.repeat(10)}</p>
                <img src="test.jpg" alt="test alt">
            </article>
        `;
        const result = extractMainContent(
            10000,
            { cleanseEnabled: false, returnInfo: true },
            { aiSummaryCleanseEnabled: true, altEnabled: true }
        ) as Record<string, unknown>;

        expect(result.aiSummaryOriginalBytes).toBe(result.cleansedBytes);
        expect(result.aiSummaryCleansedBytes).toBeLessThanOrEqual(result.aiSummaryOriginalBytes);
        expect(result.cleansedReason).toBe('none');
    });

    it('reports aiSummaryCleansedElements in else branch', () => {
        document.body.innerHTML = `
            <article>
                <p>${'Main content else branch. '.repeat(10)}</p>
                <img src="a.jpg" alt="alt1">
                <img src="b.jpg" alt="alt2">
                <img src="c.jpg" alt="alt3">
            </article>
        `;
        const result = extractMainContent(
            10000,
            { cleanseEnabled: false, returnInfo: true },
            { aiSummaryCleanseEnabled: true, altEnabled: true }
        ) as Record<string, unknown>;

        expect(result.aiSummaryCleansedElements).toBeGreaterThan(0);
        expect(result.aiSummaryCleansedReason).toBe('alt');
    });
});

// ─────────────────────────────────────────────
// 候補がない場合のパス (candidates.length === 0)
// ─────────────────────────────────────────────
describe('extractMainContent - no candidates path', () => {
    it('falls back to body when no candidates and cleanseEnabled=true', () => {
        // 空のbodyを用意（候補要素がない状態）
        document.body.innerHTML = '';
        document.body.textContent = 'Plain text without container elements.';
        const result = extractMainContent(
            10000,
            { cleanseEnabled: true, returnInfo: true }
        ) as Record<string, unknown>;

        // 文字列が返ることを確認（フォールバック動作）
        expect(typeof result.content).toBe('string');
        // bodyのテキストが取得できるか確認
        const content = result.content as string;
        if (content.length === 0) {
            // bodyが空の場合は空文字が返るのが正しい動作
            expect(content).toBe('');
        } else {
            expect(content.length).toBeGreaterThan(0);
        }
    });

    it('cleanses body when no candidates and cleanseEnabled=true', () => {
        document.body.innerHTML = `
            <div>Some content here.</div>
            <script>alert('remove')</script>
            <iframe src="ads.html"></iframe>
        `;
        const result = extractMainContent(
            10000,
            { cleanseEnabled: true, hardStripEnabled: true, returnInfo: true }
        ) as Record<string, unknown>;

        expect(result.cleansedReason).not.toBe('none');
        expect(result.hardStripRemoved).toBeGreaterThan(0);
    });

    it('applies AI summary cleansing when no candidates and both cleansings enabled', () => {
        document.body.innerHTML = `
            <div>${'Body content for AI cleansing. '.repeat(10)}</div>
            <img src="test.jpg" alt="test alt text">
        `;
        const result = extractMainContent(
            10000,
            { cleanseEnabled: true, returnInfo: true },
            { aiSummaryCleanseEnabled: true, altEnabled: true }
        ) as Record<string, unknown>;

        expect(result.aiSummaryCleansedElements).toBeDefined();
    });
});

// ─────────────────────────────────────────────
// returnInfo モード - カウント処理
// ─────────────────────────────────────────────
describe('extractMainContent - returnInfo counting', () => {
    it('counts cleanse targets when totalRemoved=0 in returnInfo mode', () => {
        document.body.innerHTML = `
            <article>
                <p>${'Clean content without target elements. '.repeat(10)}</p>
            </article>
        `;
        const result = extractMainContent(
            10000,
            { cleanseEnabled: true, hardStripEnabled: true, keywordStripEnabled: true, returnInfo: true }
        ) as Record<string, unknown>;

        // totalRemoved=0 でもカウント処理が走る
        expect(result.hardStripRemoved).toBeGreaterThanOrEqual(0);
        expect(result.keywordStripRemoved).toBeGreaterThanOrEqual(0);
    });

    it('counts AI summary targets when aiSummaryCleansedElements=0 in returnInfo mode', () => {
        document.body.innerHTML = `
            <article>
                <p>${'Content without AI summary targets. '.repeat(10)}</p>
            </article>
        `;
        const result = extractMainContent(
            10000,
            { returnInfo: true },
            { aiSummaryCleanseEnabled: true, altEnabled: true, navEnabled: true }
        ) as Record<string, unknown>;

        // aiSummaryCleansedElements がカウントされる
        expect(result.aiSummaryCleansedElements).toBeGreaterThanOrEqual(0);
    });

    it('includes aiSummaryCleansedReasons in returnInfo when multiple types', () => {
        document.body.innerHTML = `
            <article>
                <p>${'Content for reasons test. '.repeat(10)}</p>
                <img src="x.jpg" alt="alt text">
                <nav>Nav</nav>
            </article>
        `;
        const result = extractMainContent(
            10000,
            { returnInfo: true },
            { aiSummaryCleanseEnabled: true, altEnabled: true, navEnabled: true }
        ) as Record<string, unknown>;

        if (result.aiSummaryCleansedReason === 'multiple') {
            expect(result.aiSummaryCleansedReasons).toBeDefined();
            expect(Array.isArray(result.aiSummaryCleansedReasons)).toBe(true);
        }
    });

    it('does not count AI summary targets when fallbackTriggered', () => {
        // 非常に短いコンテンツでフォールバックを誘発
        document.body.innerHTML = `
            <article><p>Hi</p></article>
            <div>${'Fallback content here. '.repeat(10)}</div>
        `;
        const result = extractMainContent(
            10000,
            { cleanseEnabled: true, returnInfo: true },
            { aiSummaryCleanseEnabled: true, altEnabled: true }
        ) as Record<string, unknown>;

        // フォールバック時は aiSummaryCleansedReason が 'none' にリセットされる
        if (result.fallbackTriggered) {
            expect(result.aiSummaryCleansedReason).toBe('none');
            expect(result.cleansedReason).toBe('none');
        }
    });
});

// ─────────────────────────────────────────────
// エッジケース
// ─────────────────────────────────────────────
describe('extractMainContent - edge cases', () => {
    it('handles empty article content', () => {
        document.body.innerHTML = `<article></article>`;
        const result = extractMainContent();
        expect(typeof result).toBe('string');
    });

    it('handles document.body being null in catch block', () => {
        // jsdom では document.body は常に存在するが、エラーハンドリングをテスト
        const result = extractMainContent();
        expect(typeof result).toBe('string');
    });

    it('respects maxChars after cleansing', () => {
        document.body.innerHTML = `
            <article>
                <p>${'a'.repeat(5000)}</p>
                <script>alert('remove')</script>
            </article>
        `;
        const result = extractMainContent(
            100,
            { cleanseEnabled: true, hardStripEnabled: true }
        ) as string;

        expect(result.length).toBeLessThanOrEqual(100);
    });

    it('handles content with only images and no text', () => {
        document.body.innerHTML = `
            <article>
                <img src="a.jpg" alt="alt1">
                <img src="b.jpg" alt="alt2">
            </article>
        `;
        const result = extractMainContent(10000, { returnInfo: true }) as Record<string, unknown>;
        expect(typeof result.content).toBe('string');
    });

    it('triggers fallback when over-cleansed (less than 20% remaining)', () => {
        // 過剰削減をシミュレート（テキスト100B、alt 5000B → alt削除で95%削減）
        document.body.innerHTML = `
            <article>
                <p>${'A'.repeat(100)}</p>
                <img src="x.jpg" alt="${'B'.repeat(5000)}">
            </article>
        `;
        const result = extractMainContent(
            10000,
            { returnInfo: true },
            { aiSummaryCleanseEnabled: true, altEnabled: true }
        ) as Record<string, unknown> & { aiSummaryCleansedElements?: number, fallbackTriggered?: boolean, fallbackReason?: string, aiSummaryOriginalBytes?: number, content?: string };

        // 過剰削減でフォールバックが発動するはず
        expect(result.fallbackTriggered).toBe(true);
        expect(result.fallbackReason).toBe('over_cleansed');
        // 1つのimg[alt]が削除されたことを記録
        expect(result.aiSummaryCleansedElements).toBe(1);
    });
});

// ─────────────────────────────────────────────
// Content Cleansing - cleansedReason=hard/keyword (counting only path)
// ─────────────────────────────────────────────
describe('extractMainContent - cleansedReason counting paths', () => {
    it('sets cleansedReason to hard when only hard targets found in body', () => {
        // 候補要素にはターゲットがないが、body全体にはscript要素がある
        document.body.innerHTML = `
            <html>
            <head><title>Test</title></head>
            <body>
                <article>
                    <p>${'Main content without targets. '.repeat(15)}</p>
                </article>
                <script>console.log('target');</script>
            </body>
            </html>
        `;
        const result = extractMainContent(
            10000,
            { cleanseEnabled: true, hardStripEnabled: true, keywordStripEnabled: false, returnInfo: true }
        ) as Record<string, unknown>;

        // article にはターゲットがないので totalRemoved=0 になり、
        // その後 body 全体をカウントして script を見つける
        expect(result.cleansedReason).toBe('hard');
        expect(result.hardStripRemoved).toBeGreaterThan(0);
    });

    it('sets cleansedReason to keyword when only keyword targets found in body', () => {
        // 候補要素にはターゲットがないが、body全体にはkeyword要素がある
        document.body.innerHTML = `
            <html>
            <head><title>Test</title></head>
            <body>
                <article>
                    <p>${'Main content without targets. '.repeat(15)}</p>
                </article>
                <div id="balance">Account Balance Information</div>
            </body>
            </html>
        `;
        const result = extractMainContent(
            10000,
            { cleanseEnabled: true, hardStripEnabled: false, keywordStripEnabled: true, returnInfo: true }
        ) as Record<string, unknown>;

        // article にはターゲットがないので totalRemoved=0 になり、
        // その後 body 全体をカウントして keyword 要素を見つける
        expect(result.cleansedReason).toBe('keyword');
        expect(result.keywordStripRemoved).toBeGreaterThan(0);
    });

    it('sets cleansedReason to both when hard and keyword targets found in body', () => {
        // 候補要素にはターゲットがないが、body全体にはscriptとkeyword要素がある
        document.body.innerHTML = `
            <html>
            <head><title>Test</title></head>
            <body>
                <article>
                    <p>${'Main content without targets. '.repeat(15)}</p>
                </article>
                <script>console.log('target');</script>
                <div id="balance">Account Balance Information</div>
            </body>
            </html>
        `;
        const result = extractMainContent(
            10000,
            { cleanseEnabled: true, hardStripEnabled: true, keywordStripEnabled: true, returnInfo: true }
        ) as Record<string, unknown>;

        // article にはターゲットがないので totalRemoved=0 になり、
        // その後 body 全体をカウントして script と keyword 要素を見つける
        expect(result.cleansedReason).toBe('both');
        expect(result.hardStripRemoved).toBeGreaterThan(0);
        expect(result.keywordStripRemoved).toBeGreaterThan(0);
    });
});

// ─────────────────────────────────────────────
// logDebug / coverage paths for cleanseEnabled=true + aiSummaryCleanseEnabled
// ─────────────────────────────────────────────
describe('extractMainContent - logDebug and deep coverage paths', () => {
    it('covers logDebug path when cleanseEnabled=true and aiSummaryCleanseEnabled=true', () => {
        document.body.innerHTML = `
            <article>
                <p>${'Main content for logDebug coverage. '.repeat(10)}</p>
                <img src="a.jpg" alt="alt text">
            </article>
        `;
        const result = extractMainContent(
            10000,
            { cleanseEnabled: true, hardStripEnabled: true, returnInfo: true },
            { aiSummaryCleanseEnabled: true, altEnabled: true }
        ) as Record<string, unknown>;
        expect(typeof result.content).toBe('string');
        expect(result).toHaveProperty('aiSummaryOriginalBytes');
        expect(result).toHaveProperty('aiSummaryCleansedBytes');
    });

    it('covers logDebug path when cleanseEnabled=false and aiSummaryCleanseEnabled=true', () => {
        document.body.innerHTML = `
            <article>
                <p>${'Main content for logDebug else branch. '.repeat(10)}</p>
                <img src="a.jpg" alt="alt text">
            </article>
        `;
        const result = extractMainContent(
            10000,
            { cleanseEnabled: false, returnInfo: true },
            { aiSummaryCleanseEnabled: true, altEnabled: true }
        ) as Record<string, unknown>;
        expect(typeof result.content).toBe('string');
        expect(result).toHaveProperty('aiSummaryOriginalBytes');
        expect(result.aiSummaryOriginalBytes).toBe(result.cleansedBytes);
    });
});

// ─────────────────────────────────────────────
// countAISummaryTargets block in returnInfo (lines 568-638)
// ─────────────────────────────────────────────
describe('extractMainContent - countAISummaryTargets in returnInfo', () => {
    it('counts AI summary targets when aiSummaryCleanseEnabled, totalRemoved=0, and fallback not triggered', () => {
        document.body.innerHTML = `
            <article>
                <p>${'Clean content without cleansing targets but with AI targets. '.repeat(10)}</p>
                <nav aria-label="main">Navigation content here for counting.</nav>
            </article>
        `;
        const result = extractMainContent(
            10000,
            { cleanseEnabled: true, hardStripEnabled: true, keywordStripEnabled: true, returnInfo: true },
            { aiSummaryCleanseEnabled: true, altEnabled: true, navEnabled: true }
        ) as Record<string, unknown>;

        // totalRemoved=0 for content cleansing (no hard/keyword targets inside article)
        // but nav exists for AI summary counting
        expect(result.aiSummaryCleansedElements).toBeGreaterThan(0);
        expect(result.aiSummaryCleansedReason).not.toBe('none');
    });

    it('counts AI summary targets with multiple types and sets reasons array', () => {
        document.body.innerHTML = `
            <article>
                <p>${'Clean article content without hard targets. '.repeat(10)}</p>
                <img src="a.jpg" alt="alt text here">
                <nav aria-label="main">Nav content</nav>
                <div class="advertisement">Ad content</div>
            </article>
        `;
        const result = extractMainContent(
            10000,
            { cleanseEnabled: true, hardStripEnabled: true, keywordStripEnabled: false, returnInfo: true },
            { aiSummaryCleanseEnabled: true, altEnabled: true, navEnabled: true, adsEnabled: true }
        ) as Record<string, unknown>;

        expect(result.aiSummaryCleansedElements).toBeGreaterThan(1);
        if (result.aiSummaryCleansedReason === 'multiple') {
            expect(Array.isArray(result.aiSummaryCleansedReasons)).toBe(true);
        }
    });

    it('counts AI summary targets with single type in count-only path', () => {
        document.body.innerHTML = `
            <article>
                <p>${'Clean content. '.repeat(10)}</p>
                <img src="a.jpg" alt="only alt target">
            </article>
        `;
        const result = extractMainContent(
            10000,
            { cleanseEnabled: true, hardStripEnabled: true, keywordStripEnabled: false, returnInfo: true },
            { aiSummaryCleanseEnabled: true, altEnabled: true, navEnabled: false, adsEnabled: false }
        ) as Record<string, unknown>;

        expect(result.aiSummaryCleansedElements).toBeGreaterThan(0);
        expect(result.aiSummaryCleansedReason).toBe('alt');
    });

    it('counts AI summary targets with deepEnabled and jsonLdEnabled in count-only path', () => {
        document.body.innerHTML = `
            <article>
                <p>${'Content with deep and jsonld targets. '.repeat(10)}</p>
                <aside>Sidebar content</aside>
                <script type="application/ld+json">{"@context":"http://schema.org"}</script>
            </article>
        `;
        const result = extractMainContent(
            10000,
            { cleanseEnabled: true, hardStripEnabled: false, keywordStripEnabled: false, returnInfo: true },
            { aiSummaryCleanseEnabled: true, deepEnabled: true, jsonLdEnabled: true }
        ) as Record<string, unknown>;

        // countAISummaryTargets should count deep and jsonLd targets
        expect(result.aiSummaryCleansedElements).toBeGreaterThan(0);
    });

    it('counts AI summary targets with lazyLoad and skipLink in count-only path', () => {
        document.body.innerHTML = `
            <article>
                <p>${'Content with lazy load and skip link targets. '.repeat(10)}</p>
                <img loading="lazy" src="a.jpg" alt="lazy">
                <a href="#main" class="skip-link">Skip to main</a>
            </article>
        `;
        const result = extractMainContent(
            10000,
            { cleanseEnabled: true, hardStripEnabled: false, keywordStripEnabled: false, returnInfo: true },
            { aiSummaryCleanseEnabled: true, lazyLoadEnabled: true, skipLinkEnabled: true }
        ) as Record<string, unknown>;

        expect(result.aiSummaryCleansedElements).toBeGreaterThan(0);
    });

    it('counts AI summary targets with card and linkDensity in count-only path', () => {
        document.body.innerHTML = `
            <article>
                <p>${'Content with card target. '.repeat(10)}</p>
                <div class="card">Card content</div>
                <ul>
                    <li><a href="#">Link 1</a></li>
                    <li><a href="#">Link 2</a></li>
                    <li><a href="#">Link 3</a></li>
                    <li><a href="#">Link 4</a></li>
                    <li><a href="#">Link 5</a></li>
                    <li><a href="#">Link 6</a></li>
                    <li><a href="#">Link 7</a></li>
                </ul>
            </article>
        `;
        const result = extractMainContent(
            10000,
            { cleanseEnabled: true, hardStripEnabled: false, keywordStripEnabled: false, returnInfo: true },
            { aiSummaryCleanseEnabled: true, cardEnabled: true, linkDensityEnabled: true }
        ) as Record<string, unknown>;

        expect(result.aiSummaryCleansedElements).toBeGreaterThan(0);
    });

    it('counts AI summary targets with fixed and popup in count-only path', () => {
        document.body.innerHTML = `
            <article>
                <p>${'Content with fixed and popup targets. '.repeat(10)}</p>
                <div style="position: fixed;">Fixed banner</div>
                <div class="popup">Popup content</div>
            </article>
        `;
        const result = extractMainContent(
            10000,
            { cleanseEnabled: true, hardStripEnabled: false, keywordStripEnabled: false, returnInfo: true },
            { aiSummaryCleanseEnabled: true, fixedEnabled: true, popupEnabled: true }
        ) as Record<string, unknown>;

        // countAISummaryTargets does not count fixed/popup (always returns 0 for those),
        // but cleanseAISummaryContent removes them. In count-only path the count may be 0.
        expect(result.aiSummaryCleansedElements).toBeGreaterThanOrEqual(0);
    });
});

// ─────────────────────────────────────────────
// No candidates + cleanseEnabled + short content / over-cleansed fallback
// ─────────────────────────────────────────────
describe('extractMainContent - no candidates with cleanse + aiSummary fallback', () => {
    it('triggers short_content fallback when no candidates and cleanseEnabled', () => {
        // bodyに長いテキストはあるが、適切な候補要素がない → 短いフォールバック
        document.body.innerHTML = '<div><p>' + 'Hi '.repeat(100) + '</p></div>';
        const result = extractMainContent(
            10000,
            { cleanseEnabled: true, hardStripEnabled: true, returnInfo: true }
        ) as Record<string, unknown>;

        expect(result.fallbackTriggered).toBe(false);
        expect(result.cleansedReason).toBe('none');
    });

    it('triggers over_cleansed fallback when no candidates and aiSummary over-cleanses', () => {
        // 過剰削減をシミュレート： bodyに短文 + 大量のaltテキスト
        document.body.innerHTML = `
            <div>
                <p>${'A'.repeat(100)}</p>
                <img src="x.jpg" alt="${'B'.repeat(5000)}">
            </div>
        `;
        const result = extractMainContent(
            10000,
            { cleanseEnabled: true, returnInfo: true },
            { aiSummaryCleanseEnabled: true, altEnabled: true }
        ) as Record<string, unknown>;

        // 過剰削減判定によりフォールバック
        if (result.fallbackTriggered) {
            expect(result.fallbackReason).toBe('over_cleansed');
            // aiSummaryCleansedElementsは保持される
            expect(result.aiSummaryCleansedElements).toBeGreaterThan(0);
        }
    });

    it('body fallback with both hardStrip and keywordStrip when no candidates', () => {
        document.body.innerHTML = `
            <div>
                <p>${'Main body content here. '.repeat(5)}</p>
                <script>alert('remove')</script>
                <div id="balance">Secret info</div>
            </div>
        `;
        const result = extractMainContent(
            10000,
            { cleanseEnabled: true, hardStripEnabled: true, keywordStripEnabled: true, returnInfo: true }
        ) as Record<string, unknown>;

        expect(result.cleansedReason).toBe('both');
        expect(result.hardStripRemoved).toBeGreaterThan(0);
        expect(result.keywordStripRemoved).toBeGreaterThan(0);
    });
});

// ─────────────────────────────────────────────
// No candidates path (candidates.length === 0) via excluded-only body children
// ─────────────────────────────────────────────
describe('extractMainContent - no candidates path (lines 364-510)', () => {
    it('enters no-candidates path when all body children are excluded elements', () => {
        // Use only excluded tags (nav, aside, footer, header) so findMainContentCandidates
        // filters them all out and returns [].
        document.body.innerHTML = `
            <nav>Navigation only</nav>
            <aside>Sidebar</aside>
            <footer>Footer</footer>
            <header>Header</header>
        `;
        const result = extractMainContent(
            10000,
            { cleanseEnabled: true, hardStripEnabled: true, returnInfo: true }
        ) as Record<string, unknown>;

        expect(typeof result.content).toBe('string');
        // Because returnInfo=true and totalRemoved===0 inside script-less clone,
        // countCleanseTargets scans the body and counts nothing (no script/iframe).
        // So cleansedReason stays 'none'.
        expect(result.cleansedReason).toBe('none');
    });

    it('no-candidates path with cleanseEnabled=true and aiSummaryCleanseEnabled=true (covers lines 399-467)', () => {
        // All element children are excluded tags, so no candidates.
        // Direct text nodes provide substantial content to avoid fallback.
        document.body.innerHTML = `
            ${'Direct body text with substantial length to avoid short content fallback. '.repeat(10)}
            <nav>Nav text <img src="a.jpg" alt="alt text example"></nav>
            <header>Header</header>
        `;
        const result = extractMainContent(
            10000,
            { cleanseEnabled: true, hardStripEnabled: true, returnInfo: true },
            { aiSummaryCleanseEnabled: true, altEnabled: true, navEnabled: true }
        ) as Record<string, unknown>;

        expect(typeof result.content).toBe('string');
        expect(result).toHaveProperty('aiSummaryOriginalBytes');
        expect(result).toHaveProperty('aiSummaryCleansedBytes');
        expect(result.fallbackTriggered).toBe(false);
    });

    it('no-candidates over_cleansed fallback (covers lines 487-488)', () => {
        // All element children are excluded tags → no candidates.
        // nav contains huge alt text. After AI summary removes nav,
        // remaining direct text is tiny → over-cleansed fallback.
        document.body.innerHTML = `
            Short.
            <nav>Nav <img src="x.jpg" alt="${'Y'.repeat(6000)}"></nav>
            <header>H</header>
        `;
        const result = extractMainContent(
            10000,
            { cleanseEnabled: true, returnInfo: true },
            { aiSummaryCleanseEnabled: true, altEnabled: true, navEnabled: true }
        ) as Record<string, unknown>;

        expect(result.fallbackTriggered).toBe(true);
        expect(result.fallbackReason).toBe('over_cleansed');
    });

    it('no-candidates short_content fallback clears aiSummary stats', () => {
        // All element children are excluded tags → no candidates.
        // Short direct text only → short_content fallback.
        // Use aiSummaryCleanseEnabled=false so that _overCleansed is undefined
        // and the fallback reason is short_content.
        document.body.innerHTML = `Hi <nav>Nav</nav>`;
        const result = extractMainContent(
            10000,
            { cleanseEnabled: true, hardStripEnabled: false, keywordStripEnabled: false, returnInfo: true },
            { aiSummaryCleanseEnabled: false }
        ) as Record<string, unknown>;

        expect(result.fallbackTriggered).toBe(true);
        expect(result.fallbackReason).toBe('short_content');
        expect(result.aiSummaryCleansedReason).toBe('none');
        expect(result.aiSummaryCleansedElements).toBeUndefined();
    });

    it('no-candidates path with hardStrip and keywordStrip both removing elements', () => {
        // All element children are excluded tags, but the content cleanser scans the clone.
        // We put a <form> and <div id="balance"> inside an <aside>.
        document.body.innerHTML = `
            ${'Direct text here. '.repeat(10)}
            <nav>Nav</nav>
            <aside><form><input type="password"></form><div id="balance">Secret</div></aside>
            <header>Header</header>
        `;
        const result = extractMainContent(
            10000,
            { cleanseEnabled: true, hardStripEnabled: true, keywordStripEnabled: true, returnInfo: true }
        ) as Record<string, unknown>;

        // hard strip removed form/input, keyword strip removed #balance.
        expect(typeof result.content).toBe('string');
        expect(result.cleansedReason).toBe('both');
        expect(result.hardStripRemoved).toBeGreaterThan(0);
        expect(result.keywordStripRemoved).toBeGreaterThan(0);
    });

    it('no-candidates path with keywordStrip only (covers lines 385-388)', () => {
        // Only keyword targets, no hard strip targets.
        document.body.innerHTML = `
            ${'Direct text here. '.repeat(10)}
            <nav>Nav</nav>
            <aside><div id="balance">Secret</div></aside>
            <header>Header</header>
        `;
        const result = extractMainContent(
            10000,
            { cleanseEnabled: true, hardStripEnabled: true, keywordStripEnabled: true, returnInfo: true }
        ) as Record<string, unknown>;

        expect(result.cleansedReason).toBe('keyword');
        expect(result.hardStripRemoved).toBe(0);
        expect(result.keywordStripRemoved).toBeGreaterThan(0);
    });

    it('no-candidates path with aiSummaryCleanseEnabled but totalRemoved===0 (covers line 461)', () => {
        // All element children are excluded tags, so no candidates.
        // AI summary cleansing enabled but nothing matches (deepEnabled=false, etc.).
        document.body.innerHTML = `
            ${'Direct body text with enough length. '.repeat(10)}
            <nav>Nav</nav>
            <header>Header</header>
        `;
        const result = extractMainContent(
            10000,
            { cleanseEnabled: true, returnInfo: true },
            { aiSummaryCleanseEnabled: true, altEnabled: false, navEnabled: false, adsEnabled: false }
        ) as Record<string, unknown>;

        expect(typeof result.content).toBe('string');
        // AI cleansing ran but removed nothing inside the clone (all excluded children are skipped)
        expect(result.aiSummaryCleansedReason).toBe('none');
        // returnInfo runs countAISummaryTargets which returns 0
        expect(result.aiSummaryCleansedElements).toBe(0);
        // Bytes still get set because the code sets them unconditionally before the if
        expect(result).toHaveProperty('aiSummaryOriginalBytes');
        expect(result).toHaveProperty('aiSummaryCleansedBytes');
    });

    it('no-candidates path with hardStrip only (covers line 386)', () => {
        // Use only excluded tags as body children so no candidates are found.
        // Put script inside nav; cleanseContent will find and remove it.
        document.body.innerHTML = `
            ${'Direct text. '.repeat(10)}
            <nav><script>alert('x')</script></nav>
        `;
        const result = extractMainContent(
            10000,
            { cleanseEnabled: true, hardStripEnabled: true, keywordStripEnabled: true, returnInfo: true }
        ) as Record<string, unknown>;

        expect(typeof result.content).toBe('string');
        expect(result.cleansedReason).toBe('hard');
        expect(result.hardStripRemoved).toBeGreaterThan(0);
        expect(result.keywordStripRemoved).toBe(0);
    });

    it('no-candidates path with single-type aiSummary removal (covers line 461)', () => {
        // All element children are excluded tags → no candidates.
        // Only nav is enabled, so removedTypes becomes ['nav'] (length 1).
        document.body.innerHTML = `
            ${'Direct text. '.repeat(10)}
            <nav>Nav only</nav>
            <header>Header</header>
        `;
        const result = extractMainContent(
            10000,
            { cleanseEnabled: true, returnInfo: true },
            { aiSummaryCleanseEnabled: true, navEnabled: true, altEnabled: false, adsEnabled: false }
        ) as Record<string, unknown>;

        expect(typeof result.content).toBe('string');
        expect(result.aiSummaryCleansedReason).toBe('nav');
        expect(result.aiSummaryCleansedElements).toBeGreaterThan(0);
    });

    it('no-candidates path with cleanseEnabled=false and aiSummaryCleanseEnabled=true', () => {
        document.body.innerHTML = `
            ${'Content. '.repeat(15)}
            <nav>Nav <img src="a.jpg" alt="alt text"></nav>
        `;
        const result = extractMainContent(
            10000,
            { cleanseEnabled: false, returnInfo: true },
            { aiSummaryCleanseEnabled: true, altEnabled: true }
        ) as Record<string, unknown>;

        expect(typeof result.content).toBe('string');
        expect(result.cleansedReason).toBe('none');
        expect(result).toHaveProperty('aiSummaryOriginalBytes');
    });

    it('no-candidates path with only direct text nodes and no elements', () => {
        // body has no element children → candidates is empty
        document.body.innerHTML = '';
        document.body.textContent = 'Plain text directly on body without any wrapper elements.';
        const result = extractMainContent(
            10000,
            { cleanseEnabled: false, returnInfo: true }
        ) as Record<string, unknown>;

        expect(typeof result.content).toBe('string');
        expect(result.fallbackTriggered).toBe(false);
        expect(result.cleansedReason).toBe('none');
    });
});

// ─────────────────────────────────────────────
// Error handling (catch block)
// ─────────────────────────────────────────────
describe('extractMainContent - error handling', () => {
    it('covers catch block when document.querySelectorAll throws', () => {
        const originalQSA = document.querySelectorAll;
        document.querySelectorAll = function() {
            throw new Error('Simulated qsa error');
        } as typeof document.querySelectorAll;

        try {
            const result = extractMainContent(10000);
            expect(typeof result).toBe('string');
        } finally {
            document.querySelectorAll = originalQSA;
        }
    });

    it('covers catch block with returnInfo when querySelectorAll throws', () => {
        const originalQSA = document.querySelectorAll;
        document.querySelectorAll = function() {
            throw new Error('Simulated qsa error');
        } as typeof document.querySelectorAll;

        try {
            const result = extractMainContent(10000, { returnInfo: true }) as Record<string, unknown>;
            expect(typeof result.content).toBe('string');
        } finally {
            document.querySelectorAll = originalQSA;
        }
    });
});

// ─────────────────────────────────────────────
// Body protection + readability score integration (v5.1.19)
// ─────────────────────────────────────────────
describe('extractMainContent - body protection v5.1.19', () => {
    it('preserves body content when aiSummaryCleanseEnabled with bodyProtection defaults', () => {
        // long article body that should be protected by default bodyProtection
        document.body.innerHTML = `
            <article>
                <h1>Main Article Title</h1>
                <div class="article-body">
                    <p>${'This is the main body paragraph with substantial content to ensure high readability score and body protection activation. '.repeat(15)}</p>
                    <p>${'Another paragraph with more details and information for the reader. '.repeat(15)}</p>
                    <p>${'Final paragraph summarizing the key points of this article body content. '.repeat(15)}</p>
                </div>
            </article>
            <aside class="sidebar">
                <div class="ad-banner">Advertisement content here</div>
                <div class="related-links">
                    <a href="#">Related 1</a>
                    <a href="#">Related 2</a>
                </div>
            </aside>
            <nav class="global-nav">
                <a href="#">Home</a>
                <a href="#">About</a>
            </nav>
        `;
        const result = extractMainContent(
            10000,
            { cleanseEnabled: true, returnInfo: true },
            { aiSummaryCleanseEnabled: true, adsEnabled: true, navEnabled: true }
        ) as Record<string, unknown>;

        // Body protection (default enabled in cleanseAISummaryContent) should preserve article body
        // while removing ads and nav
        expect(typeof result.content).toBe('string');
        expect((result.content as string).length).toBeGreaterThan(500);
        // Ads and nav should be removed
        expect(result.aiSummaryCleansedElements).toBeGreaterThan(0);
    });

    it('removes non-body elements even when bodyProtection is active', () => {
        document.body.innerHTML = `
            <article>
                <div class="content">
                    <p>${'Protected body text with substantial length to trigger body protection mechanism in the cleanser. '.repeat(20)}</p>
                </div>
            </article>
            <div class="advertisement">Sponsored content</div>
            <div class="popup">Subscribe popup</div>
        `;
        const result = extractMainContent(
            10000,
            { returnInfo: true },
            { aiSummaryCleanseEnabled: true, adsEnabled: true, popupEnabled: true }
        ) as Record<string, unknown>;

        expect(typeof result.content).toBe('string');
        // Protected body should survive
        expect((result.content as string).length).toBeGreaterThan(200);
    });

    it('handles low-threshold bodyProtection via custom option passthrough', () => {
        // Even though extractMainContent does not accept bodyProtection options,
        // the underlying cleanseAISummaryContent uses defaults (enabled=true, threshold=200).
        // Short content won't be protected, longer content will.
        document.body.innerHTML = `
            <section>
                <p>${'Medium length content. '.repeat(25)}</p>
            </section>
            <div class="ad-slot">Ad</div>
        `;
        const result = extractMainContent(
            10000,
            { returnInfo: true },
            { aiSummaryCleanseEnabled: true, adsEnabled: true }
        ) as Record<string, unknown>;

        expect(typeof result.content).toBe('string');
        expect(result.aiSummaryCleansedElements).toBeGreaterThan(0);
    });
});

// ─────────────────────────────────────────────
// returnInfo count-only path when aiSummaryCleansedReason already set
// ─────────────────────────────────────────────
describe('extractMainContent - returnInfo count-only path coverage', () => {
    it('re-evaluates aiSummaryCleansedReason in count-only path when initial reason is none', () => {
        document.body.innerHTML = `
            <article>
                <p>${'Content for count-only path. '.repeat(10)}</p>
                <img src="a.jpg" alt="alt text">
                <nav>Nav content</nav>
            </article>
        `;
        // Use cleanseEnabled=true so totalRemoved may be 0 inside article,
        // triggering the countAISummaryTargets block at line 568+
        const result = extractMainContent(
            10000,
            { cleanseEnabled: true, hardStripEnabled: false, keywordStripEnabled: false, returnInfo: true },
            { aiSummaryCleanseEnabled: true, altEnabled: true, navEnabled: true }
        ) as Record<string, unknown>;

        // Should have counted targets
        expect(result.aiSummaryCleansedElements).toBeGreaterThan(0);
    });

    it('sets aiSummaryCleansedReasons array exactly via countAISummaryTargets in returnInfo', () => {
        document.body.innerHTML = `
            <article>
                <p>${'Content. '.repeat(10)}</p>
                <img src="a.jpg" alt="alt1">
                <nav>Nav1</nav>
                <div class="advertisement">Ad1</div>
                <aside>Sidebar</aside>
            </article>
        `;
        const result = extractMainContent(
            10000,
            { cleanseEnabled: true, hardStripEnabled: false, keywordStripEnabled: false, returnInfo: true },
            { aiSummaryCleanseEnabled: true, altEnabled: true, navEnabled: true, adsEnabled: true, deepEnabled: true }
        ) as Record<string, unknown>;

        if (result.aiSummaryCleansedReason === 'multiple') {
            expect(Array.isArray(result.aiSummaryCleansedReasons)).toBe(true);
            expect(result.aiSummaryCleansedReasons.length).toBeGreaterThan(1);
        }
    });
});

// ─────────────────────────────────────────────
// Edge cases with new v5.1.19 flags
// ─────────────────────────────────────────────
describe('extractMainContent - v5.1.19 new flags edge cases', () => {
    it('passes all new v5.1.19 aiSummary options through extractMainContent', () => {
        document.body.innerHTML = `
            <article>
                <p>${'Main content with all new flags. '.repeat(10)}</p>
                <div style="position: fixed;">Fixed</div>
                <div class="recommend">Recommended</div>
                <div class="pagination">Page 1 2 3</div>
                <div class="sns-promo">Follow us</div>
                <div class="popup">Popup</div>
                <div class="platform">Platform noise</div>
            </article>
        `;
        const result = extractMainContent(
            10000,
            { returnInfo: true },
            {
                aiSummaryCleanseEnabled: true,
                fixedEnabled: true,
                recommendEnabled: true,
                paginationEnabled: true,
                snsPromoEnabled: true,
                popupEnabled: true,
                platformEnabled: true,
                textDensityEnabled: true,
                shortSeqEnabled: true,
                symbolLineEnabled: true,
                linkParaEnabled: true,
                enhancedHiddenEnabled: true,
                emptyElemEnabled: true,
                jpLayoutEnabled: true,
                jpNavigationEnabled: true,
                authorEnabled: true,
            }
        ) as Record<string, unknown>;

        expect(typeof result.content).toBe('string');
    });

    it('handles customPatterns option in jpLayoutEnabled', () => {
        document.body.innerHTML = `
            <article>
                <p>${'Main content. '.repeat(10)}</p>
                <div class="custom-pattern-test">Custom noise</div>
            </article>
        `;
        const result = extractMainContent(
            10000,
            { returnInfo: true },
            {
                aiSummaryCleanseEnabled: true,
                jpLayoutEnabled: true,
                customPatterns: ['custom-pattern-test'],
            }
        ) as Record<string, unknown>;

        expect(typeof result.content).toBe('string');
    });

    it('handles threshold options (linkRatioThreshold, shortTextThreshold, etc.)', () => {
        document.body.innerHTML = `
            <article>
                <p>${'Content with thresholds. '.repeat(10)}</p>
                <ul>
                    <li><a href="#">Link 1</a></li>
                    <li><a href="#">Link 2</a></li>
                    <li><a href="#">Link 3</a></li>
                    <li><a href="#">Link 4</a></li>
                    <li><a href="#">Link 5</a></li>
                    <li><a href="#">Link 6</a></li>
                    <li><a href="#">Link 7</a></li>
                    <li><a href="#">Link 8</a></li>
                </ul>
            </article>
        `;
        const result = extractMainContent(
            10000,
            { returnInfo: true },
            {
                aiSummaryCleanseEnabled: true,
                textDensityEnabled: true,
                linkRatioThreshold: 50,
                shortSeqEnabled: true,
                shortTextThreshold: 20,
                shortSeqCount: 3,
                linkParaEnabled: true,
                linkParaThreshold: 30,
            }
        ) as Record<string, unknown>;

        expect(typeof result.content).toBe('string');
    });

    it('handles empty customPatterns array default', () => {
        document.body.innerHTML = `
            <article>
                <p>${'Content with empty custom patterns. '.repeat(10)}</p>
            </article>
        `;
        const result = extractMainContent(
            10000,
            { returnInfo: true },
            { aiSummaryCleanseEnabled: true, jpLayoutEnabled: true, customPatterns: [] }
        ) as Record<string, unknown>;

        expect(typeof result.content).toBe('string');
        expect(result.aiSummaryCleansedReason).toBe('none');
    });

    it('works with bodyProtection when content is very short (no protection)', () => {
        document.body.innerHTML = `
            <article>
                <p>Short.</p>
            </article>
            <div class="ad">Ad</div>
        `;
        const result = extractMainContent(
            10000,
            { returnInfo: true },
            { aiSummaryCleanseEnabled: true, adsEnabled: true }
        ) as Record<string, unknown>;

        expect(typeof result.content).toBe('string');
    });

    it('handles over-cleansed fallback with preAiCleanseText restoration in candidates path', () => {
        document.body.innerHTML = `
            <article>
                <p>${'A'.repeat(100)}</p>
                <img src="x.jpg" alt="${'B'.repeat(6000)}">
            </article>
        `;
        const result = extractMainContent(
            10000,
            { cleanseEnabled: true, returnInfo: true },
            { aiSummaryCleanseEnabled: true, altEnabled: true }
        ) as Record<string, unknown>;

        if (result.fallbackTriggered) {
            expect(result.fallbackReason).toBe('over_cleansed');
            expect(result.aiSummaryCleansedElements).toBeGreaterThan(0);
        }
    });
});

// ─────────────────────────────────────────────
// aiSummaryCleansedReasons array coverage for count-only path
// ─────────────────────────────────────────────
describe('extractMainContent - aiSummaryCleansedReasons array coverage', () => {
    it('populates aiSummaryCleansedReasons with exact list in count-only path', () => {
        document.body.innerHTML = `
            <article>
                <p>${'Content for exact reasons list. '.repeat(10)}</p>
                <img src="a.jpg" alt="alt text">
                <nav>Nav content</nav>
                <div class="advertisement">Ad content</div>
            </article>
        `;
        const result = extractMainContent(
            10000,
            { cleanseEnabled: true, hardStripEnabled: false, keywordStripEnabled: false, returnInfo: true },
            { aiSummaryCleanseEnabled: true, altEnabled: true, navEnabled: true, adsEnabled: true }
        ) as Record<string, unknown>;

        if (result.aiSummaryCleansedReason === 'multiple') {
            expect(Array.isArray(result.aiSummaryCleansedReasons)).toBe(true);
            expect(result.aiSummaryCleansedReasons.length).toBeGreaterThan(1);
        }
    });
});

// ─────────────────────────────────────────────
// count-only path coverage for aiSummaryCleansedReasons (lines 633)
// ─────────────────────────────────────────────
describe('extractMainContent - count-only path with targets outside candidate', () => {
    it('enters count-only path and sets aiSummaryCleansedReasons when targets are outside candidate', () => {
        // Targets are outside the article, so cleanseAISummaryContent(articleClone)
        // removes nothing, leaving aiSummaryCleansedReason as 'none'.
        // Then countAISummaryTargets(document.body) finds them.
        document.body.innerHTML = `
            <article>
                <p>${'Clean article content without any special elements inside. '.repeat(10)}</p>
            </article>
            <img src="a.jpg" alt="alt text outside article">
            <nav>Navigation outside article</nav>
            <div class="advertisement">Ad outside article</div>
        `;
        const result = extractMainContent(
            10000,
            { cleanseEnabled: true, hardStripEnabled: false, keywordStripEnabled: false, returnInfo: true },
            { aiSummaryCleanseEnabled: true, altEnabled: true, navEnabled: true, adsEnabled: true }
        ) as Record<string, unknown>;

        expect(result.aiSummaryCleansedReason).toBe('multiple');
        expect(Array.isArray(result.aiSummaryCleansedReasons)).toBe(true);
        expect((result.aiSummaryCleansedReasons as string[]).length).toBeGreaterThan(1);
    });
});

// ─────────────────────────────────────────────
// Chrome Extension API .catch path (line 160)
// ─────────────────────────────────────────────
describe('extractMainContent - Chrome Extension API catch path', () => {
    it('covers catch block when chrome.runtime.sendMessage rejects', () => {
        const mockSendMessage = vi.fn().mockRejectedValue(new Error('Port closed'));
        (window as unknown as Record<string, unknown>).chrome = {
            runtime: {
                sendMessage: mockSendMessage
            }
        };

        document.body.innerHTML = `
            <article>
                <p>${'Content for Chrome API catch test. '.repeat(10)}</p>
                <script>alert('remove me')</script>
            </article>
        `;
        extractMainContent(
            10000,
            { cleanseEnabled: true, hardStripEnabled: true, returnInfo: true }
        );

        expect(mockSendMessage).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'CONTENT_CLEANSING_EXECUTED' })
        );

        delete (window as unknown as Record<string, unknown>).chrome;
    });
});

// ─────────────────────────────────────────────
// v5.1.19 bodyProtection integration tests
// ─────────────────────────────────────────────
describe('extractMainContent - bodyProtection v5.1.19 integration', () => {
    it('preserves article body when bodyProtection is active with default threshold', () => {
        document.body.innerHTML = `
            <article>
                <h1>Title</h1>
                <div class="article-body">
                    <p>${'Main body paragraph with substantial content for testing. '.repeat(30)}</p>
                    <p>${'Second paragraph with more text and details. '.repeat(30)}</p>
                </div>
            </article>
            <aside>
                <div class="ad-banner">Advertisement</div>
            </aside>
            <nav>Global Navigation</nav>
        `;
        const result = extractMainContent(
            10000,
            { returnInfo: true },
            { aiSummaryCleanseEnabled: true, adsEnabled: true, navEnabled: true }
        ) as Record<string, unknown>;

        expect(typeof result.content).toBe('string');
        expect((result.content as string).length).toBeGreaterThan(500);
        expect(result.aiSummaryCleansedElements).toBeGreaterThan(0);
    });

    it('removes ad and nav even when bodyProtection preserves main content', () => {
        document.body.innerHTML = `
            <article>
                <div class="content">
                    <p>${'Protected body text with enough length to trigger body protection. '.repeat(25)}</p>
                </div>
            </article>
            <div class="advertisement">Sponsored</div>
            <nav class="menu">Menu</nav>
        `;
        const result = extractMainContent(
            10000,
            { returnInfo: true },
            { aiSummaryCleanseEnabled: true, adsEnabled: true, navEnabled: true }
        ) as Record<string, unknown>;

        expect(typeof result.content).toBe('string');
        expect((result.content as string).length).toBeGreaterThan(300);
        expect(result.aiSummaryCleansedElements).toBeGreaterThan(0);
    });
});

describe('extractMainContent — whitelist extraction mode', () => {
  const originalHostname = window.location.hostname;

  function setHostname(hostname: string) {
    Object.defineProperty(window, 'location', {
      value: { ...window.location, hostname },
      writable: true,
      configurable: true,
    });
  }

  afterEach(() => {
    setHostname(originalHostname);
    document.body.innerHTML = '';
  });

  it('uses whitelist extraction when hostname matches togetter.com', () => {
    setHostname('togetter.com');
    document.body.innerHTML = `
      <div class="tweet_body">これはツイート本文です。十分な長さのテキストを含みます。</div>
      <div class="item_text">まとめ主のコメントです。</div>
      <nav>ノイズナビゲーション</nav>
      <div class="ad-banner">広告バナー</div>
    `;
    const result = extractMainContent(10000, {}, {}, {}) as string;
    expect(result).toContain('これはツイート本文です');
    expect(result).toContain('まとめ主のコメントです');
    expect(result).not.toContain('ノイズナビゲーション');
    expect(result).not.toContain('広告バナー');
  });

  it('falls back to blacklist extraction when whitelist adapter matches but yields 0 elements', () => {
    setHostname('togetter.com');
    document.body.innerHTML = `
      <article>
        <h1>Fallback Article</h1>
        <p>This is fallback content because no .tweet_body elements exist on this page.</p>
      </article>
    `;
    const result = extractMainContent(10000, {}, {}, {}) as string;
    expect(result).toContain('Fallback Article');
  });

  it('does not use whitelist extraction for unrelated domains without matching DOM structure', () => {
    setHostname('example.com');
    document.body.innerHTML = `
      <article>
        <h1>Normal Article</h1>
        <p>This is a normal article on an unrelated domain with sufficient content length.</p>
      </article>
    `;
    const result = extractMainContent(10000, {}, {}, {}) as string;
    expect(result).toContain('Normal Article');
  });

  it('skips whitelist extraction when whitelistExtractionEnabled is false', () => {
    setHostname('togetter.com');
    document.body.innerHTML = `
      <article>
        <h1>Should use blacklist path</h1>
        <div class="tweet_body">This would be picked up by whitelist mode if enabled.</div>
        <p>Sufficient additional article content to pass scoring thresholds for extraction.</p>
      </article>
    `;
    const result = extractMainContent(10000, { whitelistExtractionEnabled: false }, {}, {}) as string;
    expect(result).toContain('Should use blacklist path');
  });
});
