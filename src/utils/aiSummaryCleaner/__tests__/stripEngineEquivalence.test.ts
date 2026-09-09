/**
 * @vitest-environment jsdom
 */

/**
 * stripEngineEquivalence.test.ts (PBI 06).
 *
 * Runs each strip* delegate and its SELECTOR_RULE_DEFS row on identical
 * fixtures and asserts identical counts and identical remaining DOM. This
 * guards the delegate-to-row wiring: a delegate pointed at the wrong row,
 * or a row whose selectors drifted from the delegate, fails here. The
 * pre-existing per-rule suites guard absolute behavior (counts, reason
 * strings) against the engine.
 */

import { describe, it, expect } from 'vitest';
import {
    stripMetadataElements,
    stripAdElements,
    stripNavElements,
    stripSocialElements,
    stripDeepElements,
    stripJsonLdScripts,
    stripLazyLoadElements,
    stripSkipLinks,
    stripCardElements,
} from '../stripCore.js';
import {
    stripRecommendSections,
    stripPaginationElements,
    stripSnsPromoElements,
    stripPopupElements,
    stripPlatformNoise,
    stripEnhancedHiddenElements,
    stripEmptyElements,
    stripJPLayoutPatterns,
    stripJPNavigationPatterns,
    stripAuthorMetaElements,
    stripNewsMediaPatterns,
    stripEcSitePatterns,
    stripQaSitePatterns,
    stripVideoSitePatterns,
} from '../stripExtended.js';
import { stripBySelectors, SELECTOR_RULE_DEFS, type SelectorRuleKey } from '../selectorRules.js';

interface EquivalenceCase {
    name: string;
    html: string;
    old: (root: Element) => number;
    def: SelectorRuleKey;
    extra?: string[];
}

const KEEP = '<p>Keep this body text alive for scoring purposes.</p>';

const CASES: EquivalenceCase[] = [
    {
        name: 'metadata',
        html: `<meta name="x" content="y"><title>T</title><link rel="icon" href="i.ico">${KEEP}`,
        old: (r) => stripMetadataElements(r),
        def: 'metadata',
    },
    {
        name: 'ads',
        html: `<div data-ad="1">A</div><div class="ad-container">B</div>` +
            `<div class="ad-wrapper"><span data-ad-slot="2">nested</span></div>` +
            `<div class="ad-container sponsored-content">overlap</div>${KEEP}`,
        old: (r) => stripAdElements(r),
        def: 'ads',
    },
    {
        name: 'nav',
        html: `<nav>N</nav><footer>F</footer><div role="navigation">R</div>` +
            `<div data-testid="site-footer">S</div><div class="menu">M</div>` +
            `<div class="menu"><footer>nested</footer></div>${KEEP}`,
        old: (r) => stripNavElements(r),
        def: 'nav',
    },
    {
        name: 'social',
        html: `<div id="comments">C</div><div class="share-buttons">S</div>` +
            `<div class="comments"><span class="social-share">nested</span></div>${KEEP}`,
        old: (r) => stripSocialElements(r),
        def: 'social',
    },
    {
        name: 'deep',
        html: `<aside>A</aside><div role="banner">B</div><div class="cookie-popup">C</div>` +
            `<ul><li><a href="#">${'link '.repeat(30)}</a></li></ul>` +
            `<div hidden>H</div><div></div>${KEEP}`,
        old: (r) => stripDeepElements(r),
        def: 'deep',
    },
    {
        name: 'jsonLd',
        html: `<script type="application/ld+json">{"@context":"x"}<\/script>${KEEP}`,
        old: (r) => stripJsonLdScripts(r),
        def: 'jsonLd',
    },
    {
        name: 'lazyLoad',
        html: `<img loading="lazy" src="a.jpg"><img data-src="b.jpg" src="x.gif">` +
            `<div class="skeleton-loader">S</div>${KEEP}`,
        old: (r) => stripLazyLoadElements(r),
        def: 'lazyLoad',
    },
    {
        name: 'skipLink',
        html: `<a href="#main">skip</a><a role="button" href="/x">cta</a>` +
            `<span class="sr-only">hidden</span>${KEEP}`,
        old: (r) => stripSkipLinks(r),
        def: 'skipLink',
    },
    {
        name: 'card',
        html: `<div class="article-card">A</div>` +
            `<div class="card"><span class="post-card">nested</span></div>${KEEP}`,
        old: (r) => stripCardElements(r),
        def: 'card',
    },
    {
        name: 'recommend',
        html: `<div class="carousel">C</div><div data-cs="viewRelation">Y</div>` +
            `<div class="rankingList">R</div>` +
            `<div class="pickup"><span class="recommend-list">nested</span></div>${KEEP}`,
        old: (r) => stripRecommendSections(r),
        def: 'recommend',
    },
    {
        name: 'pagination',
        html: `<div class="pagination">1 2 3</div><button class="load-more">more</button>${KEEP}`,
        old: (r) => stripPaginationElements(r),
        def: 'pagination',
    },
    {
        name: 'snsPromo',
        html: `<div class="promoted">P</div><div data-testid="promotedIndicator">I</div>` +
            `<div aria-label="Trending now">T</div>` +
            `<div class="AdHolder">sponsored stuff here</div>${KEEP}`,
        old: (r) => stripSnsPromoElements(r),
        def: 'snsPromo',
    },
    {
        name: 'popup',
        html: `<div class="modal">M</div><dialog open>D</dialog>` +
            `<div id="cookie-bar" class="cookie-popup">consent banner</div>` +
            `<p>当サイトではCookieの管理のため必須Cookieを使用します。</p>${KEEP}`,
        old: (r) => stripPopupElements(r),
        def: 'popup',
    },
    {
        name: 'platform',
        html: `<div class="ytp-popup">Y</div><div id="comments">C</div>` +
            `<span class="postid" id="comment-1">1</span>${KEEP}`,
        old: (r) => stripPlatformNoise(r),
        def: 'platform',
    },
    {
        name: 'enhancedHidden',
        html: `<div hidden>H</div><div aria-hidden="true">A</div>` +
            `<div style="display: none">D</div>` +
            `<div style="opacity: 0; position: fixed">O</div>` +
            `<div style="opacity: 0">visible ghost</div><template><span>T</span></template>${KEEP}`,
        old: (r) => stripEnhancedHiddenElements(r),
        def: 'enhancedHidden',
    },
    {
        name: 'emptyElem',
        html: `<div></div><div><span></span></div>` +
            `<div><img src="a.jpg"></div>${KEEP}`,
        old: (r) => stripEmptyElements(r),
        def: 'emptyElem',
    },
    {
        name: 'jpLayout',
        html: `<div class="l-footer">F</div><div class="swell-toc">T</div>` +
            `<div class="pagetop">top</div>${KEEP}`,
        old: (r) => stripJPLayoutPatterns(r),
        def: 'jpLayout',
    },
    {
        name: 'jpLayout+custom',
        html: `<div class="l-footer">F</div><div class="my-custom">C</div>${KEEP}`,
        old: (r) => stripJPLayoutPatterns(r, ['my-custom']),
        def: 'jpLayout',
        extra: ['my-custom'],
    },
    {
        name: 'jpNavigation',
        html: `<div class="global-nav">G</div><p>このサイトのメニューはこちら</p>${KEEP}`,
        old: (r) => stripJPNavigationPatterns(r),
        def: 'jpNavigation',
    },
    {
        name: 'author',
        html: `<div class="author-profile">A</div><p>投稿日: 2024-01-01</p>` +
            `<p>${'著者情報 '.repeat(60)}</p>${KEEP}`,
        old: (r) => stripAuthorMetaElements(r),
        def: 'author',
    },
    {
        name: 'newsMedia',
        html: `<div class="disqus">D</div><div class="read-also">R</div>${KEEP}`,
        old: (r) => stripNewsMediaPatterns(r),
        def: 'newsMedia',
    },
    {
        name: 'ecSite',
        html: `<div class="review-list">R</div><div class="free-shipping">S</div>${KEEP}`,
        old: (r) => stripEcSitePatterns(r),
        def: 'ecSite',
    },
    {
        name: 'qaSite',
        html: `<div class="best-answer-badge">B</div><div class="helpful-count">H</div>${KEEP}`,
        old: (r) => stripQaSitePatterns(r),
        def: 'qaSite',
    },
    {
        name: 'videoSite',
        html: `<div class="danmaku">D</div><div class="mylist-count">M</div>${KEEP}`,
        old: (r) => stripVideoSitePatterns(r),
        def: 'videoSite',
    },
];

describe('strip engine equivalence (old vs row)', () => {
    for (const c of CASES) {
        it(`${c.name}: identical counts and identical remaining DOM`, () => {
            const rootA = document.createElement('div');
            const rootB = document.createElement('div');
            rootA.innerHTML = c.html;
            rootB.innerHTML = c.html;
            const oldCount = c.old(rootA);
            const newCount = stripBySelectors(rootB, SELECTOR_RULE_DEFS[c.def], c.extra);
            expect(newCount).toBe(oldCount);
            expect(rootB.innerHTML).toBe(rootA.innerHTML);
        });
    }
});
