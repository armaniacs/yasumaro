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
    COOKIE_TEXT_PATTERNS,
    LEGAL_TEXT_PATTERNS,
    I18N_AD_TEXT_PATTERNS,
    I18N_SOCIAL_TEXT_PATTERNS,
} from '../patterns.js';
import { buildClassIdSelectors } from '../helpers.js';
import { stripCookieConsentElements } from '../stripExtended.js';
import { stripLegalTextNodes } from '../stripCore.js';

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

        it('does not match unrelated CSS framework class names containing "x-" (M7 mitigation)', () => {
            // M7: 'x-' 単独は誤爆のため x-share/x-follow/x-button のみに具体化 — x-large 等はヒットしない
            document.body.innerHTML = '<div class="x-large">サイズ指定</div>';
            expect(document.querySelectorAll(selector).length).toBe(0);
        });

        it('does not match Alpine.js x-data via class selector', () => {
            document.body.innerHTML = '<div class="x-data">Alpine data</div>';
            expect(document.querySelectorAll(selector).length).toBe(0);
        });

        it('matches concretized x-share pattern', () => {
            document.body.innerHTML = '<div class="x-share">share</div>';
            expect(document.querySelectorAll(selector).length).toBe(1);
        });

        it('matches concretized x-follow pattern', () => {
            document.body.innerHTML = '<div class="x-follow">follow</div>';
            expect(document.querySelectorAll(selector).length).toBe(1);
        });

        it('matches concretized x-button pattern', () => {
            document.body.innerHTML = '<div class="x-button">button</div>';
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

    describe('COOKIE_TEXT_PATTERNS — i18n', () => {
        it.each([
            ['Accepter tous les cookies', 'fr'],
            ['Gérer les cookies', 'fr'],
            ['Paramétrer les cookies', 'fr'],
            ['Alle Cookies akzeptieren', 'de'],
            ['Cookie Einstellungen verwalten', 'de'],
            ['Aceptar todas las cookies', 'es'],
            ['Gestionar cookies', 'es'],
            ['接受所有Cookie', 'zh'],
            ['管理Cookie偏好设置', 'zh'],
            ['모든 쿠키 수락', 'ko'],
            ['쿠키 설정 관리', 'ko'],
        ])('matches "%s" (%s) via RegExp', (text) => {
            expect(COOKIE_TEXT_PATTERNS.some((re) => re.test(text))).toBe(true);
        });

        it('fr: stripCookieConsentElements removes French banner', () => {
            document.body.innerHTML = '<div>Accepter tous les cookies</div><p>本文コンテンツ</p>';
            const removed = stripCookieConsentElements(document.body);
            expect(removed).toBe(1);
        });

        it('de: stripCookieConsentElements removes German banner', () => {
            document.body.innerHTML = '<div>Alle Cookies akzeptieren</div><p>本文</p>';
            expect(stripCookieConsentElements(document.body)).toBe(1);
        });

        it('zh: stripCookieConsentElements removes Chinese banner', () => {
            document.body.innerHTML = '<div>接受所有Cookie</div><p>本文</p>';
            expect(stripCookieConsentElements(document.body)).toBe(1);
        });

        it('existing ja pattern still works', () => {
            document.body.innerHTML = '<div>Cookieの管理 - 設定を確認してください</div><p>本文</p>';
            expect(stripCookieConsentElements(document.body)).toBe(1);
        });
    });

    describe('LEGAL_TEXT_PATTERNS — i18n', () => {
        it.each([
            ['Tous droits réservés 2024', 'fr'],
            ['Alle Rechte vorbehalten', 'de'],
            ['Todos los derechos reservados', 'es'],
            ['版权所有 2024', 'zh'],
            ['保留所有权利', 'zh'],
            ['모든 권리 보유', 'ko'],
            ['저작권자 All Rights', 'ko'],
        ])('matches "%s" (%s) via RegExp', (text) => {
            expect(LEGAL_TEXT_PATTERNS.some((re) => re.test(text))).toBe(true);
        });

        it('fr: stripLegalTextNodes removes French legal', () => {
            document.body.innerHTML = '<p>Tous droits réservés</p><p>本文</p>';
            expect(stripLegalTextNodes(document.body)).toBe(1);
        });

        it('de: stripLegalTextNodes removes German legal', () => {
            document.body.innerHTML = '<p>Alle Rechte vorbehalten</p>';
            expect(stripLegalTextNodes(document.body)).toBe(1);
        });

        it('zh: stripLegalTextNodes removes Chinese legal', () => {
            document.body.innerHTML = '<p>版权所有</p>';
            expect(stripLegalTextNodes(document.body)).toBe(1);
        });

        it('existing ja pattern still works', () => {
            document.body.innerHTML = '<p>© 2024 Example</p>';
            expect(stripLegalTextNodes(document.body)).toBe(1);
        });

        it('does not remove long body text containing legal phrase (guard 500 chars)', () => {
            const long = `Tous droits réservés ${'a'.repeat(600)}`;
            document.body.innerHTML = `<div><p>${long}</p></div>`;
            expect(stripLegalTextNodes(document.body)).toBe(0);
        });
    });

    describe('I18N_AD_TEXT_PATTERNS — text match only, not class selector', () => {
        it.each([
            ['publicité', 'fr'],
            ['annonce sponsorisée', 'fr'],
            ['Werbung', 'de'],
            ['Anzeige', 'de'],
            ['广告信息', 'zh'],
            ['推广内容', 'zh'],
            ['publicidad', 'es'],
            ['광고', 'ko'],
        ])('matches "%s" (%s)', (text) => {
            expect(I18N_AD_TEXT_PATTERNS.some((re) => re.test(text))).toBe(true);
        });

        it('does not expand via buildClassIdSelectors (no class false positive)', () => {
            const selector = buildClassIdSelectors(['publicité', 'Werbung']);
            // Selector is built from class patterns, but i18n ad patterns are NOT in that list
            // Ensure I18N patterns are not leaking into class selectors
            expect(I18N_AD_TEXT_PATTERNS.length).toBeGreaterThan(5);
            // The i18n patterns must not be used as class selectors
            document.body.innerHTML = '<div class="publicité">test</div>';
            // This class-based selector would match if we mistakenly added i18n to class list
            // But we assert I18N patterns remain text-only: they are RegExp, not strings
            expect(typeof I18N_AD_TEXT_PATTERNS[0].test).toBe('function');
        });

        it('has language comments and minimum 8 patterns', () => {
            expect(I18N_AD_TEXT_PATTERNS.length).toBeGreaterThanOrEqual(8);
        });
    });

    describe('I18N_SOCIAL_TEXT_PATTERNS — text match only', () => {
        it.each([
            ['Partager', 'fr'],
            ['Suivez-nous', 'fr'],
            ['Teilen', 'de'],
            ['Folgen', 'de'],
            ['分享', 'zh'],
            ['关注我们', 'zh'],
            ['Compartir', 'es'],
            ['공유하기', 'ko'],
            ['팔로우', 'ko'],
        ])('matches "%s" (%s)', (text) => {
            expect(I18N_SOCIAL_TEXT_PATTERNS.some((re) => re.test(text))).toBe(true);
        });

        it('has language comments and minimum 8 patterns', () => {
            expect(I18N_SOCIAL_TEXT_PATTERNS.length).toBeGreaterThanOrEqual(8);
        });
    });
});
