/**
 * aiSummaryCleaner.test.ts
 * aiSummaryCleaner.ts の単体テスト
 */

import { webcrypto as crypto } from '@peculiar/webcrypto';
Object.defineProperty(global, 'crypto', {
    value: crypto
});

import { JSDOM } from 'jsdom';
import {
    cleanseAISummaryContent,
    countAISummaryTargets
} from '../aiSummaryCleaner.js';

describe('aiSummaryCleaner', () => {
    let dom: JSDOM;
    let document: Document;

    beforeEach(() => {
        dom = new JSDOM(`
            <html><body>
                <div id="content">
                    <h1>Main Article</h1>
                    <p>This is the main content paragraph with enough text to be meaningful.</p>
                    <img alt="decorative image" src="test.jpg" />
                    <img alt="photo" src="photo.jpg" />
                    <meta name="description" content="test" />
                    <title>Page Title</title>
                    <link rel="icon" href="favicon.ico" />
                    <link rel="stylesheet" href="style.css" />
                    <div class="ad-container">Ad content</div>
                    <div class="sponsor">Sponsored content</div>
                    <div id="ad-banner-1">Banner ad</div>
                    <nav class="main-nav">Navigation</nav>
                    <footer>Footer content</footer>
                    <div role="navigation">Role nav</div>
                    <div class="sidebar">Sidebar</div>
                    <div id="comments">Comments section</div>
                    <div class="social-share">Share buttons</div>
                    <div class="facebook-widget">FB widget</div>
                    <aside class="related">Related articles</aside>
                    <form id="search-form">Search</form>
                    <script>console.log('test');</script>
                    <div class="cookie-banner">Cookie consent</div>
                    <div hidden>Hidden content</div>
                    <div></div>
                    <span></span>
                </div>
            </body></html>
        `, { url: 'http://localhost' });
        document = dom.window.document;
        (global as any).document = document;
    });

    afterEach(() => {
        dom.window.close();
    });

    describe('cleanseAISummaryContent', () => {
        test('画像alt属性を削除する', () => {
            const element = document.getElementById('content')!;
            const result = cleanseAISummaryContent(element, {
                altEnabled: true,
                metadataEnabled: false,
                adsEnabled: false,
                navEnabled: false,
                socialEnabled: false,
                deepEnabled: false
            });

            expect(result.altRemoved).toBe(2);
            const imgs = element.querySelectorAll('img');
            imgs.forEach(img => {
                expect(img.hasAttribute('alt')).toBe(false);
            });
        });

        test('メタデータ要素を削除する', () => {
            const element = document.getElementById('content')!;
            const result = cleanseAISummaryContent(element, {
                altEnabled: false,
                metadataEnabled: true,
                adsEnabled: false,
                navEnabled: false,
                socialEnabled: false,
                deepEnabled: false
            });

            expect(result.metadataRemoved).toBeGreaterThan(0);
            expect(element.querySelector('meta')).toBeNull();
            expect(element.querySelector('title')).toBeNull();
        });

        test('広告要素を削除する', () => {
            const element = document.getElementById('content')!;
            const result = cleanseAISummaryContent(element, {
                altEnabled: false,
                metadataEnabled: false,
                adsEnabled: true,
                navEnabled: false,
                socialEnabled: false,
                deepEnabled: false
            });

            expect(result.adsRemoved).toBeGreaterThan(0);
            expect(element.querySelector('.ad-container')).toBeNull();
            expect(element.querySelector('.sponsor')).toBeNull();
            expect(element.querySelector('#ad-banner-1')).toBeNull();
        });

        test('ナビゲーション要素を削除する', () => {
            const element = document.getElementById('content')!;
            const result = cleanseAISummaryContent(element, {
                altEnabled: false,
                metadataEnabled: false,
                adsEnabled: false,
                navEnabled: true,
                socialEnabled: false,
                deepEnabled: false
            });

            expect(result.navRemoved).toBeGreaterThan(0);
            expect(element.querySelector('nav')).toBeNull();
            expect(element.querySelector('footer')).toBeNull();
        });

        test('ソーシャル要素を削除する', () => {
            const element = document.getElementById('content')!;
            const result = cleanseAISummaryContent(element, {
                altEnabled: false,
                metadataEnabled: false,
                adsEnabled: false,
                navEnabled: false,
                socialEnabled: true,
                deepEnabled: false
            });

            expect(result.socialRemoved).toBeGreaterThan(0);
            expect(element.querySelector('#comments')).toBeNull();
        });

        test('ディープクレンジングで aside/form/script を削除する', () => {
            const element = document.getElementById('content')!;
            const result = cleanseAISummaryContent(element, {
                altEnabled: false,
                metadataEnabled: false,
                adsEnabled: false,
                navEnabled: false,
                socialEnabled: false,
                deepEnabled: true
            });

            expect(result.deepRemoved).toBeGreaterThan(0);
            expect(element.querySelector('aside')).toBeNull();
            expect(element.querySelector('form')).toBeNull();
            expect(element.querySelector('script')).toBeNull();
        });

        test('デフォルトオプションで全機能（deep以外）を実行する', () => {
            const element = document.getElementById('content')!;
            const result = cleanseAISummaryContent(element);

            expect(result.altRemoved).toBeGreaterThan(0);
            expect(result.metadataRemoved).toBeGreaterThan(0);
            expect(result.adsRemoved).toBeGreaterThan(0);
            expect(result.navRemoved).toBeGreaterThan(0);
            expect(result.socialRemoved).toBeGreaterThan(0);
            expect(result.totalRemoved).toBe(
                result.altRemoved + result.metadataRemoved + result.adsRemoved +
                result.navRemoved + result.socialRemoved + result.deepRemoved
            );
        });

        test('bytesBefore と bytesAfter を計算する', () => {
            const element = document.getElementById('content')!;
            const result = cleanseAISummaryContent(element);

            expect(result.bytesBefore).toBeGreaterThan(0);
            expect(result.bytesAfter).toBeGreaterThan(0);
            expect(result.bytesBefore).toBeGreaterThan(result.bytesAfter);
        });

        test('すべてのオプション無効では何も削除しない', () => {
            const element = document.getElementById('content')!;
            const result = cleanseAISummaryContent(element, {
                altEnabled: false,
                metadataEnabled: false,
                adsEnabled: false,
                navEnabled: false,
                socialEnabled: false,
                deepEnabled: false
            });

            expect(result.totalRemoved).toBe(0);
        });
    });

    describe('countAISummaryTargets', () => {
        test('画像alt属性をカウントする', () => {
            const element = document.getElementById('content')!;
            const result = countAISummaryTargets(element, {
                altEnabled: true,
                metadataEnabled: false,
                adsEnabled: false,
                navEnabled: false,
                socialEnabled: false,
                deepEnabled: false
            });

            expect(result.altRemoved).toBe(2);
        });

        test('メタデータをカウントする', () => {
            const element = document.getElementById('content')!;
            const result = countAISummaryTargets(element, {
                altEnabled: false,
                metadataEnabled: true,
                adsEnabled: false,
                navEnabled: false,
                socialEnabled: false,
                deepEnabled: false
            });

            expect(result.metadataRemoved).toBeGreaterThan(0);
        });

        test('広告をカウントする', () => {
            const element = document.getElementById('content')!;
            const result = countAISummaryTargets(element, {
                altEnabled: false,
                metadataEnabled: false,
                adsEnabled: true,
                navEnabled: false,
                socialEnabled: false,
                deepEnabled: false
            });

            expect(result.adsRemoved).toBeGreaterThan(0);
        });

        test('カウントしてもDOMを変更しない', () => {
            const element = document.getElementById('content')!;
            const htmlBefore = element.innerHTML;

            countAISummaryTargets(element);

            expect(element.innerHTML).toBe(htmlBefore);
        });

        test('bytesBefore と bytesAfter は 0 を返す', () => {
            const element = document.getElementById('content')!;
            const result = countAISummaryTargets(element);

            expect(result.bytesBefore).toBe(0);
            expect(result.bytesAfter).toBe(0);
        });

        test('totalRemoved が各カウントの合計と一致する', () => {
            const element = document.getElementById('content')!;
            const result = countAISummaryTargets(element);

            expect(result.totalRemoved).toBe(
                result.altRemoved + result.metadataRemoved + result.adsRemoved +
                result.navRemoved + result.socialRemoved + result.deepRemoved
            );
        });

        test('ディープクレンジングカウント', () => {
            const element = document.getElementById('content')!;
            const result = countAISummaryTargets(element, {
                altEnabled: false,
                metadataEnabled: false,
                adsEnabled: false,
                navEnabled: false,
                socialEnabled: false,
                deepEnabled: true
            });

            expect(result.deepRemoved).toBeGreaterThan(0);
        });

        test('空要素をカウント（ディープ）', () => {
            const element = document.getElementById('content')!;
            const result = countAISummaryTargets(element, {
                altEnabled: false,
                metadataEnabled: false,
                adsEnabled: false,
                navEnabled: false,
                socialEnabled: false,
                deepEnabled: true
            });

            // 空の div, span がカウントされる
            expect(result.deepRemoved).toBeGreaterThan(0);
        });
    });
});
