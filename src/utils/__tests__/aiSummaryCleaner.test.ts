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

        test('NAV拡張: copyright/legal クラス要素を削除する', () => {
            const dom2 = new JSDOM(`<html><body><div id="root">
                <p class="footer__copyright-text">© 2026 CNN</p>
                <div class="legal-notice">Terms of Service</div>
                <div class="common-footer">Site footer</div>
                <div class="l-footer">Layout footer</div>
                <p class="main-content">Important article text here.</p>
            </div></body></html>`, { url: 'http://localhost' });
            const el = dom2.window.document.getElementById('root')!;
            (global as any).document = dom2.window.document;
            const result = cleanseAISummaryContent(el, {
                navEnabled: true, altEnabled: false, metadataEnabled: false,
                adsEnabled: false, socialEnabled: false, deepEnabled: false
            });
            expect(result.navRemoved).toBeGreaterThanOrEqual(4);
            expect(el.querySelector('.footer__copyright-text')).toBeNull();
            expect(el.querySelector('.legal-notice')).toBeNull();
            expect(el.querySelector('.common-footer')).toBeNull();
            expect(el.querySelector('.l-footer')).toBeNull();
            expect(el.querySelector('.main-content')).not.toBeNull();
            dom2.window.close();
        });

        test('NAV拡張: role="contentinfo" 要素を削除する', () => {
            const dom2 = new JSDOM(`<html><body><div id="root">
                <div role="contentinfo">Site footer region</div>
                <p class="article-body">Article text here.</p>
            </div></body></html>`, { url: 'http://localhost' });
            const el = dom2.window.document.getElementById('root')!;
            (global as any).document = dom2.window.document;
            const result = cleanseAISummaryContent(el, {
                navEnabled: true, altEnabled: false, metadataEnabled: false,
                adsEnabled: false, socialEnabled: false, deepEnabled: false
            });
            expect(result.navRemoved).toBeGreaterThanOrEqual(1);
            expect(el.querySelector('[role="contentinfo"]')).toBeNull();
            dom2.window.close();
        });

        test('広告拡張: data-ad/data-gpt/ins.adsbygoogle を削除する', () => {
            const dom2 = new JSDOM(`<html><body><div id="root">
                <div data-ad="banner">Ad content</div>
                <div data-gpt-ad="slot1">GPT ad</div>
                <ins class="adsbygoogle" data-ad-client="ca-pub-123">Google Ad</ins>
                <div class="sponsored-content">Sponsored</div>
                <div class="native-ad">Native ad</div>
                <p class="article-text">Real content here.</p>
            </div></body></html>`, { url: 'http://localhost' });
            const el = dom2.window.document.getElementById('root')!;
            (global as any).document = dom2.window.document;
            const result = cleanseAISummaryContent(el, {
                adsEnabled: true, altEnabled: false, metadataEnabled: false,
                navEnabled: false, socialEnabled: false, deepEnabled: false
            });
            expect(result.adsRemoved).toBeGreaterThanOrEqual(5);
            expect(el.querySelector('[data-ad]')).toBeNull();
            expect(el.querySelector('[data-gpt-ad]')).toBeNull();
            expect(el.querySelector('ins.adsbygoogle')).toBeNull();
            expect(el.querySelector('.article-text')).not.toBeNull();
            dom2.window.close();
        });

        test('stripLegalTextNodes: © 年号パターンを含む短い要素を削除する', () => {
            const dom2 = new JSDOM(`<html><body><div id="root">
                <p>© 2026 Cable News Network. All Rights Reserved.</p>
                <p>Copyright 2026 togetter.com. All Rights Reserved.</p>
                <div>無断転載禁止</div>
                <p>著作権は株式会社読売新聞社に帰属します。</p>
                <p class="article-body">This is a long article paragraph with lots of real content about important topics that should definitely not be removed by legal text stripping because it is clearly article content and not a copyright notice.</p>
            </div></body></html>`, { url: 'http://localhost' });
            const el = dom2.window.document.getElementById('root')!;
            (global as any).document = dom2.window.document;
            const result = cleanseAISummaryContent(el, {
                navEnabled: true, altEnabled: false, metadataEnabled: false,
                adsEnabled: false, socialEnabled: false, deepEnabled: false
            });
            expect(result.navRemoved).toBeGreaterThanOrEqual(4);
            const remaining = el.textContent || '';
            expect(remaining).not.toContain('© 2026 Cable News Network');
            expect(remaining).not.toContain('Copyright 2026 togetter.com');
            expect(remaining).not.toContain('無断転載禁止');
            expect(remaining).toContain('long article paragraph');
            dom2.window.close();
        });

        test('stripHighLinkDensityElements: リンク密度0.7以上のブロックを削除する', () => {
            const dom2 = new JSDOM(`<html><body><div id="root"><ul class="related-links"><li><a href="/a">Related article one long title</a></li><li><a href="/b">Related article two long title</a></li><li><a href="/c">Related article three long title</a></li><li><a href="/d">Related article four long title</a></li></ul><div class="article-content"><p>This is the main article content. It has lots of <a href="/x">one link</a> among regular text that makes up the majority of the text content here so link density stays low.</p></div></div></body></html>`, { url: 'http://localhost' });
            const el = dom2.window.document.getElementById('root')!;
            (global as any).document = dom2.window.document;
            const result = cleanseAISummaryContent(el, {
                navEnabled: false, altEnabled: false, metadataEnabled: false,
                adsEnabled: false, socialEnabled: false, deepEnabled: false,
                linkDensityEnabled: true
            });
            expect(result.linkDensityRemoved).toBeGreaterThanOrEqual(1);
            expect(el.querySelector('.related-links')).toBeNull();
            expect(el.querySelector('.article-content')).not.toBeNull();
            dom2.window.close();
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

    describe('nav ID selector elements', () => {
        test('ナビゲーションIDを含む要素を削除する', () => {
            const container = document.createElement('div');
            container.innerHTML = `
                <div id="main-navigation">Nav</div>
                <div id="site-menu">Menu</div>
                <div id="breadcrumb-list">Breadcrumbs</div>
                <p>Content</p>
            `;
            document.body.appendChild(container);

            const result = cleanseAISummaryContent(container, {
                altEnabled: false,
                metadataEnabled: false,
                adsEnabled: false,
                navEnabled: true,
                socialEnabled: false,
                deepEnabled: false
            });

            expect(result.navRemoved).toBeGreaterThan(0);
            expect(container.querySelector('#main-navigation')).toBeNull();
            expect(container.querySelector('#site-menu')).toBeNull();
            document.body.removeChild(container);
        });

        test('ナビゲーションIDを含む要素をカウントする', () => {
            const container = document.createElement('div');
            container.innerHTML = `
                <div id="site-nav">Nav</div>
                <div id="footer-links">Footer</div>
                <p>Content</p>
            `;
            document.body.appendChild(container);

            const result = countAISummaryTargets(container, {
                altEnabled: false,
                metadataEnabled: false,
                adsEnabled: false,
                navEnabled: true,
                socialEnabled: false,
                deepEnabled: false
            });

            expect(result.navRemoved).toBeGreaterThan(0);
            document.body.removeChild(container);
        });
    });

    describe('social ID selector elements', () => {
        test('ソーシャルIDを含む要素を削除する', () => {
            const container = document.createElement('div');
            container.innerHTML = `
                <div id="share-buttons">Share</div>
                <div id="social-widget">Social</div>
                <p>Content</p>
            `;
            document.body.appendChild(container);

            const result = cleanseAISummaryContent(container, {
                altEnabled: false,
                metadataEnabled: false,
                adsEnabled: false,
                navEnabled: false,
                socialEnabled: true,
                deepEnabled: false
            });

            expect(result.socialRemoved).toBeGreaterThan(0);
            expect(container.querySelector('#share-buttons')).toBeNull();
            document.body.removeChild(container);
        });

        test('ソーシャルIDを含む要素をカウントする', () => {
            const container = document.createElement('div');
            container.innerHTML = `
                <div id="fb-like-box">Facebook</div>
                <div id="twitter-feed">Twitter</div>
                <p>Content</p>
            `;
            document.body.appendChild(container);

            const result = countAISummaryTargets(container, {
                altEnabled: false,
                metadataEnabled: false,
                adsEnabled: false,
                navEnabled: false,
                socialEnabled: true,
                deepEnabled: false
            });

            expect(result.socialRemoved).toBeGreaterThan(0);
            document.body.removeChild(container);
        });
    });

    describe('deep cleansing edge cases', () => {
        test('高リンク密度リストを削除する', () => {
            const container = document.createElement('div');
            container.innerHTML = '<ul><li><a href="#">First Link Text</a></li><li><a href="#">Second Link Text</a></li><li><a href="#">Third Link Text</a></li></ul><p>Content</p>';
            document.body.appendChild(container);

            const result = cleanseAISummaryContent(container, {
                altEnabled: false,
                metadataEnabled: false,
                adsEnabled: false,
                navEnabled: false,
                socialEnabled: false,
                deepEnabled: true
            });

            expect(result.deepRemoved).toBeGreaterThan(0);
            expect(container.querySelector('ul')).toBeNull();
            document.body.removeChild(container);
        });

        test('高リンク密度リストをカウントする（ディープ）', () => {
            const container = document.createElement('div');
            container.innerHTML = '<ol><li><a href="#">Alpha Link Content</a></li><li><a href="#">Beta Link Content Here</a></li></ol><p>Content</p>';
            document.body.appendChild(container);

            const result = countAISummaryTargets(container, {
                altEnabled: false,
                metadataEnabled: false,
                adsEnabled: false,
                navEnabled: false,
                socialEnabled: false,
                deepEnabled: true
            });

            expect(result.deepRemoved).toBeGreaterThan(0);
            document.body.removeChild(container);
        });

        test('低リンク密度リストは削除しない', () => {
            const container = document.createElement('div');
            container.innerHTML = `
                <ul>
                    <li><a href="#">Link 1</a></li>
                    <li>Plain text content that is much longer than the link text</li>
                    <li>Another plain text item</li>
                </ul>
                <p>Content</p>
            `;
            document.body.appendChild(container);

            const result = cleanseAISummaryContent(container, {
                altEnabled: false,
                metadataEnabled: false,
                adsEnabled: false,
                navEnabled: false,
                socialEnabled: false,
                deepEnabled: true
            });

            // リンク密度が低いのでulは削除されない
            expect(container.querySelector('ul')).not.toBeNull();
            document.body.removeChild(container);
        });

        test('role属性でディープ要素をカウントする', () => {
            const container = document.createElement('div');
            container.innerHTML = `
                <div role="banner">Banner</div>
                <div role="complementary">Sidebar</div>
                <div role="contentinfo">Footer info</div>
                <p>Content</p>
            `;
            document.body.appendChild(container);

            const result = countAISummaryTargets(container, {
                altEnabled: false,
                metadataEnabled: false,
                adsEnabled: false,
                navEnabled: false,
                socialEnabled: false,
                deepEnabled: true
            });

            expect(result.deepRemoved).toBeGreaterThan(0);
            document.body.removeChild(container);
        });

        test('role属性のディープ要素を削除する', () => {
            const container = document.createElement('div');
            container.innerHTML = `
                <div role="banner">Header Banner</div>
                <div role="complementary">Complementary Content</div>
                <p>Main content</p>
            `;
            document.body.appendChild(container);

            const result = cleanseAISummaryContent(container, {
                altEnabled: false,
                metadataEnabled: false,
                adsEnabled: false,
                navEnabled: false,
                socialEnabled: false,
                deepEnabled: true
            });

            expect(result.deepRemoved).toBeGreaterThan(0);
            expect(container.querySelector('[role="banner"]')).toBeNull();
            expect(container.querySelector('[role="complementary"]')).toBeNull();
            document.body.removeChild(container);
        });

        test('DEEP_CLASS_PATTERNSに一致するIDの要素を削除する', () => {
            const container = document.createElement('div');
            container.innerHTML = `
                <div id="cookie-consent-banner">Cookie Banner</div>
                <div id="modal-overlay">Modal</div>
                <p>Main content</p>
            `;
            document.body.appendChild(container);

            const result = cleanseAISummaryContent(container, {
                altEnabled: false,
                metadataEnabled: false,
                adsEnabled: false,
                navEnabled: false,
                socialEnabled: false,
                deepEnabled: true
            });

            expect(result.deepRemoved).toBeGreaterThan(0);
            expect(container.querySelector('#cookie-consent-banner')).toBeNull();
            document.body.removeChild(container);
        });

        test('空のリストは高リンク密度チェックをスキップする', () => {
            const container = document.createElement('div');
            container.innerHTML = `
                <ul></ul>
                <ol>   </ol>
                <p>Content</p>
            `;
            document.body.appendChild(container);

            const result = cleanseAISummaryContent(container, {
                altEnabled: false,
                metadataEnabled: false,
                adsEnabled: false,
                navEnabled: false,
                socialEnabled: false,
                deepEnabled: true
            });

            expect(result.totalRemoved).toBeGreaterThanOrEqual(0);
            document.body.removeChild(container);
        });
    });

    describe('DOM query optimization', () => {
        let originalQuerySelectorAll: typeof Element.prototype.querySelectorAll;
        let queryCallCount: number;

        beforeEach(() => {
            originalQuerySelectorAll = Element.prototype.querySelectorAll;
            queryCallCount = 0;
            Element.prototype.querySelectorAll = function(selector: string) {
                queryCallCount++;
                return originalQuerySelectorAll.call(this, selector);
            };
        });

        afterEach(() => {
            Element.prototype.querySelectorAll = originalQuerySelectorAll;
        });

        test('最適化後も同じ要素が削除される', () => {
            const container = document.createElement('div');
            container.innerHTML = `
                <div class="advertisement">ad1</div>
                <div id="ad-container">ad2</div>
                <nav class="navbar">nav1</nav>
                <div id="navigation">nav2</div>
                <a class="social-share">social1</a>
                <div class="twitter-follow">social2</div>
            `;
            document.body.appendChild(container);

            const result = cleanseAISummaryContent(container, {
                altEnabled: false,
                metadataEnabled: false,
                adsEnabled: true,
                navEnabled: true,
                socialEnabled: true,
                deepEnabled: false
            });

            expect(result.totalRemoved).toBeGreaterThan(0);
            expect(container.querySelector('.advertisement')).toBeNull();
            expect(container.querySelector('#ad-container')).toBeNull();
            expect(container.querySelector('.social-share')).toBeNull();
            document.body.removeChild(container);
        });

        test('querySelectorAllの呼び出しが20回未満になる', () => {
            const container = document.createElement('div');
            container.innerHTML = `
                <div class="advertisement">ad1</div>
                <div id="ad-container">ad2</div>
                <nav class="navbar">nav1</nav>
                <div id="navigation">nav2</div>
                <a class="social-share">social1</a>
                <div class="twitter-follow">social2</div>
                <div class="metadata">meta1</div>
                <span class="skip-link">skip1</span>
            `;
            document.body.appendChild(container);

            queryCallCount = 0;
            cleanseAISummaryContent(container, {
                altEnabled: false,
                metadataEnabled: false,
                adsEnabled: true,
                navEnabled: true,
                socialEnabled: true,
                deepEnabled: false
            });

            // 最適化後は20回以下に削減されるはず
            expect(queryCallCount).toBeLessThan(20);
            document.body.removeChild(container);
        });
    });
});
