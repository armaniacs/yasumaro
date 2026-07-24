/**
 * @vitest-environment jsdom
 */

/**
 * patterns.test.ts
 * AD_CLASS_PATTERNS/SOCIAL_CLASS_PATTERNS/NAV_CLASS_PATTERNS/DEEP_CLASS_PATTERNS を
 * buildClassIdSelectors() 経由で実際のDOM要素に適用し、誤検出・正検出を確認する
 */

import {
    AD_CLASS_PATTERNS,
    SOCIAL_CLASS_PATTERNS,
    NAV_CLASS_PATTERNS,
    DEEP_CLASS_PATTERNS,
} from '../patterns.js';
import { buildClassIdSelectors } from '../helpers.js';

describe('aiSummaryCleaner/patterns', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    describe('AD_CLASS_PATTERNS', () => {
        const selector = buildClassIdSelectors(AD_CLASS_PATTERNS);

        it('matches an element with an ad-related class name', () => {
            document.body.innerHTML = '<div class="ad-banner">広告</div>';
            expect(document.querySelectorAll(selector).length).toBe(1);
        });

        it('matches an element with sponsored content class', () => {
            document.body.innerHTML = '<div class="sponsored-content">PR</div>';
            expect(document.querySelectorAll(selector).length).toBe(1);
        });

        it('does not match an address element', () => {
            document.body.innerHTML = '<div class="address-book">連絡先</div>';
            expect(document.querySelectorAll(selector).length).toBe(0);
        });

        it('does not match an admin element', () => {
            document.body.innerHTML = '<div class="admin-panel">管理画面</div>';
            expect(document.querySelectorAll(selector).length).toBe(0);
        });
    });

    describe('SOCIAL_CLASS_PATTERNS', () => {
        const selector = buildClassIdSelectors(SOCIAL_CLASS_PATTERNS);

        it('matches an element with a share button class', () => {
            document.body.innerHTML = '<div class="share-buttons">シェア</div>';
            expect(document.querySelectorAll(selector).length).toBe(1);
        });

        it('matches an element with twitter class', () => {
            document.body.innerHTML = '<div class="twitter-embed">埋め込み</div>';
            expect(document.querySelectorAll(selector).length).toBe(1);
        });

        it('matches unrelated CSS framework class names containing "x-"', () => {
            // 「x-」は意図的に広いパターン。誤爆リスクとして仕様上マッチすることを明示する
            document.body.innerHTML = '<div class="x-large">サイズ指定</div>';
            expect(document.querySelectorAll(selector).length).toBe(1);
        });
    });

    describe('NAV_CLASS_PATTERNS', () => {
        const selector = buildClassIdSelectors(NAV_CLASS_PATTERNS);

        it('matches an element with a footer class', () => {
            document.body.innerHTML = '<div class="site-footer">フッター</div>';
            expect(document.querySelectorAll(selector).length).toBe(1);
        });

        it('matches an element with a breadcrumb class', () => {
            document.body.innerHTML = '<nav class="breadcrumb">パンくず</nav>';
            expect(document.querySelectorAll(selector).length).toBe(1);
        });

        it('does not match an article element unrelated to navigation', () => {
            document.body.innerHTML = '<article class="post-content">本文</article>';
            expect(document.querySelectorAll(selector).length).toBe(0);
        });
    });

    describe('DEEP_CLASS_PATTERNS', () => {
        const selector = buildClassIdSelectors(DEEP_CLASS_PATTERNS);

        it('matches an element with a cookie consent class', () => {
            document.body.innerHTML = '<div class="cookie-consent-banner">同意</div>';
            expect(document.querySelectorAll(selector).length).toBe(1);
        });

        it('matches an element with a related articles class', () => {
            document.body.innerHTML = '<div class="related-posts">関連記事</div>';
            expect(document.querySelectorAll(selector).length).toBe(1);
        });

        it('does not match a main article body element', () => {
            document.body.innerHTML = '<div class="post-body">本文コンテンツ</div>';
            expect(document.querySelectorAll(selector).length).toBe(0);
        });
    });
});
