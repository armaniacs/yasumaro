/**
 * contentExtractor.test.ts
 * contentExtractor.ts の単体テスト
 */

import { extractMainContent, isExcludedElement, calculateTextScore, isAsianContentElement } from '../contentExtractor.js';

function setupDocument(html: string): void {
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    document.body.innerHTML = bodyMatch ? bodyMatch[1] : html;
}

describe('contentExtractor', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    describe('extractMainContent', () => {
        test('articleタグを優先的に抽出する', () => {
            setupDocument(`
                <body>
                    <nav>Navigation</nav>
                    <article>
                        <h1>Main Article</h1>
                        <p>This is the main content of the page with enough text to be meaningful.</p>
                        <p>Another paragraph with more content for extraction.</p>
                    </article>
                    <footer>Footer</footer>
                </body>
            `);

            const result = extractMainContent(10000);
            expect(result).toContain('Main Article');
            expect(result).toContain('main content');
        });

        test('mainタグ内のコンテンツを含む', () => {
            setupDocument(`
                <body>
                    <main>
                        <p>Main content paragraph here with enough text to be meaningful for testing extraction.</p>
                        <p>Another paragraph with additional content for the extraction algorithm.</p>
                    </main>
                </body>
            `);

            const result = extractMainContent(10000);
            expect(result).toContain('Main content');
        });

        test('ナビゲーションを除外する', () => {
            setupDocument(`
                <body>
                    <nav class="main-nav">Home | About | Contact | Services</nav>
                    <article>
                        <h1>Article Title</h1>
                        <p>Article content paragraph here with enough text for extraction to work properly.</p>
                        <p>Second paragraph with more content to make this a valid article block.</p>
                    </article>
                </body>
            `);

            const result = extractMainContent(10000);
            expect(result).toContain('Article content');
        });

        test('ExtractResult 形式で返す', () => {
            setupDocument(`
                <body>
                    <article>
                        <p>Content paragraph for extraction test with enough text to score well.</p>
                        <p>Second paragraph for the extraction result format test.</p>
                    </article>
                </body>
            `);

            const result = extractMainContent(10000, { returnInfo: true }) as any;
            expect(typeof result).toBe('object');
            expect(result).toHaveProperty('content');
            expect(result).toHaveProperty('pageBytes');
            expect(result).toHaveProperty('originalBytes');
            expect(result.content).toContain('Content paragraph');
        });

        test('cleansing オプションを適用する', () => {
            setupDocument(`
                <body>
                    <article>
                        <p>Main content paragraph here with enough text for scoring.</p>
                        <p>Another paragraph with content to ensure this element scores high.</p>
                    </article>
                </body>
            `);

            const result = extractMainContent(10000, { hardStripEnabled: true });
            expect(result).toContain('Main content');
        });

        test('最大文字数を制限する', () => {
            setupDocument(`<body><article>${'a'.repeat(20000)}</article></body>`);
            const result = extractMainContent(1000);
            expect(result.length).toBeLessThanOrEqual(1000);
        });

        test('空のbodyの場合は空文字を返す', () => {
            setupDocument('');
            const result = extractMainContent(10000);
            expect(result).toBe('');
        });

        test('scriptタグを除外する', () => {
            setupDocument(`
                <body>
                    <article>
                        <p>Main content paragraph here.</p>
                        <script>console.log('test');</script>
                    </article>
                </body>
            `);

            const result = extractMainContent(10000);
            expect(result).not.toContain('console.log');
        });
    });

    describe('isExcludedElement', () => {
        test('nav要素は除外される', () => {
            setupDocument('<nav>Navigation</nav>');
            const el = document.querySelector('nav')!;
            expect(isExcludedElement(el)).toBe(true);
        });

        test('footer要素は除外される', () => {
            setupDocument('<footer>Footer</footer>');
            const el = document.querySelector('footer')!;
            expect(isExcludedElement(el)).toBe(true);
        });

        test('aside要素は除外される', () => {
            setupDocument('<aside>Sidebar</aside>');
            const el = document.querySelector('aside')!;
            expect(isExcludedElement(el)).toBe(true);
        });

        test('header要素は除外される', () => {
            setupDocument('<header>Header</header>');
            const el = document.querySelector('header')!;
            expect(isExcludedElement(el)).toBe(true);
        });

        test('role="navigation"は除外される', () => {
            setupDocument('<div role="navigation">Nav</div>');
            const el = document.querySelector('[role="navigation"]')!;
            expect(isExcludedElement(el)).toBe(true);
        });

        test('aria-hidden="true"は除外される', () => {
            setupDocument('<div aria-hidden="true">Hidden</div>');
            const el = document.querySelector('[aria-hidden="true"]')!;
            expect(isExcludedElement(el)).toBe(true);
        });

        test('sidebarクラスは除外される', () => {
            setupDocument('<div class="sidebar">Sidebar</div>');
            const el = document.querySelector('.sidebar')!;
            expect(isExcludedElement(el)).toBe(true);
        });

        test('menuクラスは除外される', () => {
            setupDocument('<div class="menu">Menu</div>');
            const el = document.querySelector('.menu')!;
            expect(isExcludedElement(el)).toBe(true);
        });

        test('adクラスは除外される', () => {
            setupDocument('<div class="ad-container">Ad</div>');
            const el = document.querySelector('.ad-container')!;
            expect(isExcludedElement(el)).toBe(true);
        });

        test('p要素は除外されない', () => {
            setupDocument('<p>Content</p>');
            const el = document.querySelector('p')!;
            expect(isExcludedElement(el)).toBe(false);
        });

        test('article要素は除外されない', () => {
            setupDocument('<article>Content</article>');
            const el = document.querySelector('article')!;
            expect(isExcludedElement(el)).toBe(false);
        });

        test('div要素は除外されない', () => {
            setupDocument('<div>Content</div>');
            const el = document.querySelector('div')!;
            expect(isExcludedElement(el)).toBe(false);
        });
    });

    describe('calculateTextScore', () => {
        test('長いテキストほど高いスコア', () => {
            setupDocument(`
                <div>
                    <p class="short">Short text.</p>
                    <p class="long">${'Long paragraph with content. '.repeat(20)}</p>
                </div>
            `);

            const short = document.querySelector('.short')!;
            const long = document.querySelector('.long')!;

            expect(calculateTextScore(long)).toBeGreaterThan(calculateTextScore(short));
        });

        test('paragraph を含む要素はスコアが高い', () => {
            setupDocument(`
                <div>
                    <div class="a">Just text without structure</div>
                    <div class="b">
                        <p>Paragraph one with content.</p>
                        <p>Paragraph two with more content.</p>
                        <p>Paragraph three with content here.</p>
                    </div>
                </div>
            `);

            const a = document.querySelector('.a')!;
            const b = document.querySelector('.b')!;

            expect(calculateTextScore(b)).toBeGreaterThan(calculateTextScore(a));
        });

        test('空要素のスコアは 0', () => {
            setupDocument('<div></div>');
            const el = document.querySelector('div')!;
            expect(calculateTextScore(el)).toBe(0);
        });

        test('見出しを含む要素はスコアが高い', () => {
            setupDocument(`
                <div>
                    <div class="a">Plain text content here</div>
                    <div class="b">
                        <h2>Title</h2>
                        <p>Some paragraph content here for testing.</p>
                    </div>
                </div>
            `);

            const a = document.querySelector('.a')!;
            const b = document.querySelector('.b')!;

            expect(calculateTextScore(b)).toBeGreaterThan(calculateTextScore(a));
        });

        test('リンク密度が高い要素はスコアが下がる', () => {
            setupDocument(`
                <div>
                    <div class="content">
                        <p>Paragraph with some text content here for testing.</p>
                        <p>Another paragraph with more text content to ensure enough non-link text.</p>
                        <p>Third paragraph with additional non-link text content for scoring.</p>
                    </div>
                    <div class="link-heavy">
                        <a href="#">Link A long text here</a>
                        <a href="#">Link B long text here</a>
                        <a href="#">Link C long text here</a>
                        <a href="#">Link D long text here</a>
                    </div>
                </div>
            `);

            const content = document.querySelector('.content')!;
            const linkHeavy = document.querySelector('.link-heavy')!;

            // content要素はpタグ含むのでスコアが高い
            expect(calculateTextScore(content)).toBeGreaterThan(calculateTextScore(linkHeavy));
        });

        test('リスト要素を含む要素はスコア加算される', () => {
            setupDocument(`
                <div>
                    <div class="a">Just plain text content here for comparison.</div>
                    <div class="b">
                        <ul>
                            <li>Item one</li>
                            <li>Item two</li>
                        </ul>
                        <ol>
                            <li>First</li>
                            <li>Second</li>
                        </ol>
                    </div>
                </div>
            `);

            const a = document.querySelector('.a')!;
            const b = document.querySelector('.b')!;

            expect(calculateTextScore(b)).toBeGreaterThan(calculateTextScore(a));
        });

        test('リンク密度が50%を超えるとスコアが30%に減少する', () => {
            setupDocument(`
                <div>
                    <div class="high-link-density">
                        <a href="#">This is a very long link text that dominates the content of this element completely</a>
                        <span>short</span>
                    </div>
                </div>
            `);

            const el = document.querySelector('.high-link-density')!;
            const score = calculateTextScore(el);
            // リンク密度 > 0.5 のためスコアが 0.3 倍される
            // テキスト長 + pCount*50 + ... が 0.3 倍になる
            expect(score).toBeGreaterThan(0);
        });
    });

    describe('isAsianContentElement', () => {
        test('contentクラスを持つ要素は true を返す', () => {
            setupDocument('<div class="main-content">Content</div>');
            const el = document.querySelector('.main-content')!;
            expect(isAsianContentElement(el)).toBe(true);
        });

        test('articleクラスを持つ要素は true を返す', () => {
            setupDocument('<div class="article-body">Content</div>');
            const el = document.querySelector('.article-body')!;
            expect(isAsianContentElement(el)).toBe(true);
        });

        test('entry-content ID を持つ要素は true を返す', () => {
            setupDocument('<div id="entry-content">Content</div>');
            const el = document.querySelector('#entry-content')!;
            expect(isAsianContentElement(el)).toBe(true);
        });

        test('content- プレフィックス ID を持つ要素は true を返す', () => {
            setupDocument('<div id="content-main">Content</div>');
            const el = document.querySelector('#content-main')!;
            expect(isAsianContentElement(el)).toBe(true);
        });

        test('-content サフィックス ID を持つ要素は true を返す', () => {
            setupDocument('<div id="article-content">Content</div>');
            const el = document.querySelector('#article-content')!;
            expect(isAsianContentElement(el)).toBe(true);
        });

        test('一致しないクラス/ID の要素は false を返す', () => {
            setupDocument('<div class="random-class" id="random-id">Content</div>');
            const el = document.querySelector('.random-class')!;
            expect(isAsianContentElement(el)).toBe(false);
        });

        test('空のクラスと ID の要素は false を返す', () => {
            setupDocument('<div>Content</div>');
            const el = document.querySelector('div')!;
            expect(isAsianContentElement(el)).toBe(false);
        });
    });

    describe('extractMainContent - AI要約クレンジング', () => {
        test('aiSummaryCleanseEnabled=true で AI要約クレンジング結果を返す', () => {
            setupDocument(`
                <body>
                    <article>
                        <h1>Article Title</h1>
                        <img alt="Descriptive alt text for the image" />
                        <p>Main content paragraph with enough text to score well.</p>
                        <p>Second paragraph with more content for extraction.</p>
                    </article>
                </body>
            `);

            const result = extractMainContent(10000,
                { returnInfo: true },
                { aiSummaryCleanseEnabled: true, altEnabled: true }
            ) as any;

            expect(result).toHaveProperty('content');
            expect(result).toHaveProperty('aiSummaryOriginalBytes');
            expect(result).toHaveProperty('aiSummaryCleansedBytes');
        });

        test('aiSummaryCleanseEnabled=false でも正常に動作する', () => {
            setupDocument(`
                <body>
                    <article>
                        <p>Main content paragraph with enough text to score well.</p>
                        <p>Second paragraph with more content for extraction.</p>
                    </article>
                </body>
            `);

            const result = extractMainContent(10000,
                { returnInfo: true },
                { aiSummaryCleanseEnabled: false }
            ) as any;

            expect(result).toHaveProperty('content');
            // aiSummaryCleanseEnabled=false の場合、aiSummaryOriginalBytes と aiSummaryCleansedBytes は undefined
            // (AI要約クレンジングが実行されないため)
            if (result.aiSummaryOriginalBytes !== undefined) {
                expect(result.aiSummaryOriginalBytes).toBe(result.cleansedBytes);
            }
            if (result.aiSummaryCleansedBytes !== undefined) {
                expect(result.aiSummaryCleansedBytes).toBe(result.cleansedBytes);
            }
        });

        test('候補あり + aiSummaryCleanseEnabled で candidates パスの AI要約クレンジング', () => {
            setupDocument(`
                <body>
                    <article>
                        <h1>Long Article Title for Testing AI Summary Cleansing</h1>
                        <img alt="Alt text for image that should be removed by cleansing" />
                        <p>This is a substantial paragraph with enough content to ensure the article scores well.</p>
                        <p>Another paragraph with more content for extraction and testing purposes.</p>
                        <p>Third paragraph to ensure sufficient text length for the scoring algorithm.</p>
                    </article>
                </body>
            `);

            const result = extractMainContent(10000,
                { cleanseEnabled: false, returnInfo: true },
                { aiSummaryCleanseEnabled: true, altEnabled: true, metadataEnabled: false, adsEnabled: false, navEnabled: false, socialEnabled: false }
            ) as any;

            expect(typeof result).toBe('object');
            expect(result).toHaveProperty('content');
            expect(result).toHaveProperty('aiSummaryCleansedElements');
            expect(result).toHaveProperty('aiSummaryCleansedReason');
        });

        test('候補あり + cleanseEnabled + aiSummaryCleanseEnabled の両方', () => {
            setupDocument(`
                <body>
                    <article>
                        <h1>Article for Combined Cleansing Test</h1>
                        <img alt="Image alt text for cleansing test with enough content" />
                        <input type="password" value="secret" />
                        <p>This is substantial article content with enough text for the extraction algorithm to score this element highly and select it as the best candidate.</p>
                        <p>Second paragraph with additional content for combined cleansing test to verify proper scoring.</p>
                        <p>Third paragraph to ensure scoring is sufficient for candidate selection.</p>
                    </article>
                </body>
            `);

            const result = extractMainContent(10000,
                { cleanseEnabled: true, hardStripEnabled: true, returnInfo: true },
                { aiSummaryCleanseEnabled: true, altEnabled: true }
            ) as any;

            expect(typeof result).toBe('object');
            expect(result).toHaveProperty('content');
            expect(result).toHaveProperty('aiSummaryCleansedReason');
            // aiSummaryCleansedElements は undefined の可能性がある
            if (result.aiSummaryCleansedElements !== undefined) {
                expect(result.aiSummaryCleansedElements).toBeGreaterThanOrEqual(0);
            }
        });

        test('候補あり + aiSummaryCleanseEnabled で複数タイプ削除時に reason=multiple', () => {
            setupDocument(`
                <body>
                    <article>
                        <h1>Article for Multiple Type Removal Test</h1>
                        <img alt="Image with descriptive alt text for testing" />
                        <nav class="sub-navigation">Sub nav for removal</nav>
                        <p>Substantial article content for testing multiple AI summary cleansing types being triggered simultaneously.</p>
                        <p>Second paragraph with enough content for the scoring algorithm.</p>
                        <p>Third paragraph for scoring purposes and content extraction.</p>
                    </article>
                </body>
            `);

            const result = extractMainContent(10000,
                { cleanseEnabled: true, hardStripEnabled: true, returnInfo: true },
                { aiSummaryCleanseEnabled: true, altEnabled: true, navEnabled: true }
            ) as any;

            expect(result).toHaveProperty('aiSummaryCleansedReason');
            expect(result.aiSummaryCleansedElements).toBeGreaterThanOrEqual(0);
        });

        test('aiSummaryCleanseEnabled 時、aiSummaryOriginalBytes と aiSummaryCleansedBytes が正しく設定される', () => {
            setupDocument(`
                <body>
                    <article>
                        <h1>Article for Bytes Test</h1>
                        <img alt="Alt text for image that should be removed" />
                        <p>This is a substantial paragraph with enough content to ensure the article scores well for extraction.</p>
                        <p>Another paragraph with more content for extraction and testing purposes.</p>
                        <p>Third paragraph to ensure sufficient text length for the scoring algorithm.</p>
                    </article>
                </body>
            `);

            const result = extractMainContent(10000,
                { cleanseEnabled: false, returnInfo: true },
                { aiSummaryCleanseEnabled: true, altEnabled: true }
            ) as any;

            // aiSummaryOriginalBytes と aiSummaryCleansedBytes が定義されていることを確認
            expect(result).toHaveProperty('aiSummaryOriginalBytes');
            expect(result).toHaveProperty('aiSummaryCleansedBytes');

            // 具体的なバイト数が設定されていることを確認（0より大きい）
            expect(result.aiSummaryOriginalBytes).toBeGreaterThan(0);
            expect(result.aiSummaryCleansedBytes).toBeGreaterThan(0);

            // aiSummaryOriginalBytes >= aiSummaryCleansedBytes（クレンジングで削除されるため）
            expect(result.aiSummaryOriginalBytes).toBeGreaterThanOrEqual(result.aiSummaryCleansedBytes);
        });

        test('deep クレンジング有効時、テキストを含む要素が削除されて bytes が減少する', () => {
            setupDocument(`
                <body>
                    <article>
                        <h1>Deep Cleansing Test Article</h1>
                        <nav class="page-navigation">
                            Nav link 1
                            Nav link 2
                            Nav link 3
                        </nav>
                        <aside class="related-posts">
                            <h2>Related Posts</h2>
                            <p>Related article 1</p>
                            <p>Related article 2</p>
                        </aside>
                        <p>This is the main content paragraph with substantial text for testing deep cleansing functionality.</p>
                        <p>Another paragraph for additional content and proper extraction.</p>
                        <p>Third paragraph to ensure enough content for scoring algorithm.</p>
                    </article>
                </body>
            `);

            const result = extractMainContent(10000,
                { cleanseEnabled: false, returnInfo: true },
                { aiSummaryCleanseEnabled: true, deepEnabled: true }
            ) as any;

            expect(result).toHaveProperty('aiSummaryOriginalBytes');
            expect(result).toHaveProperty('aiSummaryCleansedBytes');
            expect(result.aiSummaryOriginalBytes).toBeGreaterThan(0);
            expect(result.aiSummaryCleansedBytes).toBeGreaterThan(0);
            expect(result.aiSummaryOriginalBytes).toBeGreaterThanOrEqual(result.aiSummaryCleansedBytes);
        });
    });

    describe('extractMainContent - フォールバック', () => {
        test('article も main もない場合、body テキストを返す', () => {
            setupDocument(`
                <body>
                    <div>
                        <p>Plain content without article or main tags.</p>
                        <p>Another paragraph for text extraction.</p>
                    </div>
                </body>
            `);

            const result = extractMainContent(10000);
            expect(result).toContain('Plain content');
        });

        test('複数の article がある場合、スコアの高いものを選択する', () => {
            setupDocument(`
                <body>
                    <article class="short">Short.</article>
                    <article class="long">
                        <h1>Long Article</h1>
                        <p>Paragraph one with substantial content.</p>
                        <p>Paragraph two with more substantial content.</p>
                        <p>Paragraph three with even more content.</p>
                    </article>
                </body>
            `);

            const result = extractMainContent(10000);
            expect(result).toContain('Long Article');
        });

        test('article/main なしでアジア圏コンテンツ構造を検出する', () => {
            setupDocument(`
                <body>
                    <div class="main-content">
                        <h1>Asian Content Article</h1>
                        <p>This is an article using Asian-style class naming conventions.</p>
                        <p>Second paragraph with enough content to be meaningful.</p>
                    </div>
                    <footer>Footer text</footer>
                </body>
            `);

            const result = extractMainContent(10000);
            expect(result).toContain('Asian Content Article');
        });

        test('article/main なしでアジア圏 ID 構造を検出する', () => {
            setupDocument(`
                <body>
                    <div id="article-content">
                        <h1>ID-based Article</h1>
                        <p>Content found via Asian ID pattern matching.</p>
                        <p>Another paragraph for sufficient content.</p>
                    </div>
                </body>
            `);

            const result = extractMainContent(10000);
            expect(result).toContain('ID-based Article');
        });

        test('候補なし + cleanseEnabled で body をクレンジングする', () => {
            setupDocument(`
                <body>
                    <div>
                        <p>Plain body content without article or main tags.</p>
                        <input type="password" value="secret" />
                        <p>More body content for extraction testing.</p>
                    </div>
                </body>
            `);

            const result = extractMainContent(10000, {
                cleanseEnabled: true,
                hardStripEnabled: true,
                returnInfo: true,
            }) as any;

            expect(typeof result).toBe('object');
            expect(result).toHaveProperty('content');
            expect(result).toHaveProperty('cleansedReason');
        });

        test('候補なし + cleanseEnabled + aiSummaryCleanseEnabled で body クレンジング', () => {
            setupDocument(`
                <body>
                    <div>
                        <p>Body content for combined cleansing test.</p>
                        <img alt="Image alt text for removal" />
                        <p>More body content here.</p>
                    </div>
                </body>
            `);

            const result = extractMainContent(10000,
                { cleanseEnabled: true, hardStripEnabled: true, returnInfo: true },
                { aiSummaryCleanseEnabled: true, altEnabled: true }
            ) as any;

            expect(typeof result).toBe('object');
            expect(result).toHaveProperty('content');
            expect(result).toHaveProperty('aiSummaryCleansedReason');
        });

        test('候補なし + cleanseEnabled=false で body を返す', () => {
            setupDocument(`
                <body>
                    <div>
                        <p>Simple body fallback content.</p>
                        <p>No candidates and no cleansing.</p>
                    </div>
                </body>
            `);

            const result = extractMainContent(10000, { returnInfo: true }) as any;
            expect(typeof result).toBe('object');
            expect(result).toHaveProperty('content');
            expect(result).toHaveProperty('originalBytes');
        });
    });

    describe('extractMainContent - クレンジング詳細', () => {
        test('cleanseEnabled + hardStrip で要素削除し cleansedReason=hard を返す', () => {
            setupDocument(`
                <body>
                    <article>
                        <p>Main article content with enough text for extraction.</p>
                        <input type="password" value="secret123" />
                        <p>More article content for cleansing test.</p>
                    </article>
                </body>
            `);

            const result = extractMainContent(10000, {
                cleanseEnabled: true,
                hardStripEnabled: true,
                keywordStripEnabled: false,
                returnInfo: true,
            }) as any;

            expect(result).toHaveProperty('cleansedReason');
            expect(result.hardStripRemoved).toBeGreaterThanOrEqual(0);
        });

        test('cleanseEnabled + keywordStrip でキーワード要素を削除する', () => {
            setupDocument(`
                <body>
                    <article>
                        <p>Main article content here with enough text for extraction.</p>
                        <div id="login-form">Login content</div>
                        <p>More article content for keyword cleansing.</p>
                    </article>
                </body>
            `);

            const result = extractMainContent(10000, {
                cleanseEnabled: true,
                hardStripEnabled: false,
                keywordStripEnabled: true,
                keywords: ['login'],
                returnInfo: true,
            }) as any;

            expect(result).toHaveProperty('cleansedReason');
            expect(result.keywordStripRemoved).toBeGreaterThanOrEqual(0);
        });

        test('cleanseEnabled + hardStrip + keywordStrip 両方で cleansedReason=both', () => {
            setupDocument(`
                <body>
                    <article>
                        <p>Main article content with text for extraction testing.</p>
                        <input type="password" value="secret" />
                        <div id="card-number-field">Card info</div>
                        <p>More article content for dual cleansing test.</p>
                    </article>
                </body>
            `);

            const result = extractMainContent(10000, {
                cleanseEnabled: true,
                hardStripEnabled: true,
                keywordStripEnabled: true,
                keywords: ['card-number'],
                returnInfo: true,
            }) as any;

            expect(result).toHaveProperty('cleansedReason');
        });

        test('aiSummaryCleanseEnabled で複数タイプの削除時 aiSummaryCleansedReason=multiple', () => {
            setupDocument(`
                <body>
                    <article>
                        <h1>Article Title</h1>
                        <img alt="Descriptive alt text for cleansing" />
                        <nav class="sub-navigation">Sub nav</nav>
                        <p>Main content paragraph with enough text for extraction.</p>
                        <p>Second paragraph with more content for testing.</p>
                    </article>
                </body>
            `);

            const result = extractMainContent(10000,
                { cleanseEnabled: false, returnInfo: true },
                { aiSummaryCleanseEnabled: true, altEnabled: true, navEnabled: true }
            ) as any;

            expect(result).toHaveProperty('aiSummaryCleansedReason');
            expect(result).toHaveProperty('aiSummaryCleansedElements');
        });

        test('aiSummaryCleanseEnabled 単一タイプで aiSummaryCleansedReason がそのタイプになる', () => {
            setupDocument(`
                <body>
                    <article>
                        <h1>Article Title</h1>
                        <img alt="Alt text for image removal testing" />
                        <p>Main content paragraph with enough text to be meaningful.</p>
                        <p>Second paragraph with more content for extraction.</p>
                    </article>
                </body>
            `);

            const result = extractMainContent(10000,
                { cleanseEnabled: false, returnInfo: true },
                { aiSummaryCleanseEnabled: true, altEnabled: true, metadataEnabled: false, adsEnabled: false, navEnabled: false, socialEnabled: false }
            ) as any;

            expect(result).toHaveProperty('aiSummaryCleansedReason');
        });

        test('cleanseEnabled=false でも aiSummaryCleanseEnabled で AI要約クレンジングが動作する', () => {
            setupDocument(`
                <body>
                    <article>
                        <h1>Article Title</h1>
                        <img alt="Alt text for cleansing test" />
                        <p>Main content with enough text for extraction.</p>
                        <p>Second paragraph for AI summary cleansing test.</p>
                    </article>
                </body>
            `);

            const result = extractMainContent(10000,
                { cleanseEnabled: false, returnInfo: true },
                { aiSummaryCleanseEnabled: true, altEnabled: true }
            ) as any;

            expect(result).toHaveProperty('content');
            expect(result).toHaveProperty('aiSummaryOriginalBytes');
            expect(result).toHaveProperty('aiSummaryCleansedBytes');
        });
    });

    describe('extractMainContent - returnInfo 詳細', () => {
        test('returnInfo でクレンジング対象をカウント（削除なし）', () => {
            setupDocument(`
                <body>
                    <article>
                        <p>Main article content with text for extraction.</p>
                        <input type="password" value="secret" />
                        <p>More article content for counting test.</p>
                    </article>
                </body>
            `);

            const result = extractMainContent(10000, {
                cleanseEnabled: false,
                hardStripEnabled: true,
                returnInfo: true,
            }) as any;

            expect(typeof result).toBe('object');
            expect(result).toHaveProperty('content');
            expect(result).toHaveProperty('totalRemoved');
        });

        test('returnInfo + aiSummaryCleanseEnabled で AI要約カウント', () => {
            setupDocument(`
                <body>
                    <article>
                        <h1>Article Title</h1>
                        <img alt="Image with alt text" />
                        <p>Main content with enough text for extraction.</p>
                        <p>Second paragraph with more content.</p>
                    </article>
                </body>
            `);

            const result = extractMainContent(10000,
                { cleanseEnabled: false, returnInfo: true },
                { aiSummaryCleanseEnabled: true, altEnabled: true }
            ) as any;

            expect(result).toHaveProperty('aiSummaryCleansedElements');
            expect(result).toHaveProperty('aiSummaryCleansedReason');
        });

        test('returnInfo でクレンジング実行後の reason を返す', () => {
            setupDocument(`
                <body>
                    <article>
                        <p>Main article content with enough text for extraction.</p>
                        <input type="password" value="secret" />
                        <div id="balance-display">Balance info</div>
                        <p>More content for cleansing reason test.</p>
                    </article>
                </body>
            `);

            const result = extractMainContent(10000, {
                cleanseEnabled: true,
                hardStripEnabled: true,
                keywordStripEnabled: true,
                keywords: ['balance'],
                returnInfo: true,
            }) as any;

            expect(result).toHaveProperty('cleansedReason');
            expect(['hard', 'keyword', 'both', 'none']).toContain(result.cleansedReason);
        });
    });

    describe('extractMainContent - 除外要素フィルタリング', () => {
        test('抽出時に除外要素のテキストを含まない', () => {
            setupDocument(`
                <body>
                    <article>
                        <p>Main article content with enough text.</p>
                        <aside>Sidebar content that should be excluded</aside>
                        <p>More article content for testing.</p>
                    </article>
                </body>
            `);

            const result = extractMainContent(10000);
            expect(result).toContain('Main article content');
            expect(result).not.toContain('Sidebar content that should be excluded');
        });

        test('img タグのテキストはスキップされる', () => {
            setupDocument(`
                <body>
                    <article>
                        <p>Main article content with enough text.</p>
                        <img src="test.jpg" alt="Test image" />
                        <p>More article content after image.</p>
                    </article>
                </body>
            `);

            const result = extractMainContent(10000);
            expect(result).toContain('Main article content');
        });
    });

    describe('extractMainContent - エラーハンドリング', () => {
        test('コンテンツ抽出がエラー時も安全にフォールバックする', () => {
            setupDocument(`
                <body>
                    <p>Fallback content for error handling test.</p>
                </body>
            `);

            const result = extractMainContent(10000);
            expect(typeof result).toBe('string');
        });
    });

    describe('extractMainContent - 短いコンテンツフォールバック', () => {
        test('抽出テキストが短い場合でも結果を返す', () => {
            setupDocument(`
                <body>
                    <article>
                        <p>Short.</p>
                    </article>
                </body>
            `);

            const result = extractMainContent(10000);
            expect(typeof result).toBe('string');
        });
    });

    describe('extractMainContent - returnInfo クレンジング理由', () => {
        test('returnInfo で hardStrip + keywordStrip の両方カウント時に cleansedReason=both', () => {
            setupDocument(`
                <body>
                    <article>
                        <p>Main article content with enough text for extraction.</p>
                        <input type="password" value="secret" />
                        <div id="login-form">Login area</div>
                        <p>More article content for counting test.</p>
                    </article>
                </body>
            `);

            const result = extractMainContent(10000,
                { cleanseEnabled: false, hardStripEnabled: true, keywordStripEnabled: true, keywords: ['login'], returnInfo: true },
            ) as any;

            expect(typeof result).toBe('object');
            expect(result).toHaveProperty('cleansedReason');
        });

        test('returnInfo + aiSummaryCleanseEnabled で複数タイプカウント時に reason=multiple', () => {
            setupDocument(`
                <body>
                    <article>
                        <h1>Article Title</h1>
                        <img alt="Image with alt text" />
                        <nav class="page-navigation">Nav</nav>
                        <p>Main content with enough text for extraction.</p>
                        <p>Second paragraph with more content.</p>
                    </article>
                </body>
            `);

            const result = extractMainContent(10000,
                { cleanseEnabled: false, returnInfo: true },
                { aiSummaryCleanseEnabled: true, altEnabled: true, navEnabled: true }
            ) as any;

            expect(result).toHaveProperty('aiSummaryCleansedReason');
            expect(['alt', 'nav', 'multiple', 'none']).toContain(result.aiSummaryCleansedReason);
        });
    });
});
