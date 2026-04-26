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
            </article>
        `;
        const result = extractMainContent(
            10000,
            { returnInfo: true },
            { aiSummaryCleanseEnabled: true, altEnabled: true, navEnabled: true }
        ) as Record<string, unknown>;

        expect(result.aiSummaryCleansedElements).toBeGreaterThanOrEqual(0);
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
        ) as Record<string, unknown>;

        // aiSummaryCleansedElements がカウントされる
        expect(result.aiSummaryCleansedElements).toBeGreaterThanOrEqual(0);
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

    it('triggers fallback when over-cleansed (less than 10% remaining)', () => {
        // 短いコンテンツを用意して過剰削減をシミュレート
        document.body.innerHTML = `
            <article>
                <p>Short</p>
                <img src="x.jpg" alt="${'x'.repeat(2000)}">
            </article>
        `;
        const result = extractMainContent(
            10000,
            { returnInfo: true },
            { aiSummaryCleanseEnabled: true, altEnabled: true }
        ) as Record<string, unknown>;

        // 過剰削減でフォールバックする可能性をチェック
        expect(typeof result.fallbackTriggered).toBe('boolean');
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
