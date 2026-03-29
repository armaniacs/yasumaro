/**
 * contentExtractor.test.ts
 * contentExtractor.ts の単体テスト
 */

import { extractMainContent, isExcludedElement, calculateTextScore } from '../contentExtractor.js';

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
    });
});
