/**
 * AI要約クレンジング — セレクタールール表 + 共有ストリップエンジン
 *
 * Pattern-based strips shared one ~20-line shape (fresh Set, querySelectorAll,
 * counted dedupe guard, safeRemoveElement loop) copied across 23 functions.
 * Each row here is one former function: `patterns` feed buildClassIdSelectors,
 * `extraSelectors` hold the verbatim tag/attribute selectors, and per-group
 * `predicate` entries hold the gated checks (isLikelyAd, isLikelyPopup,
 * isPlatformNoise, text/keyword guards) that used to sit inline.
 *
 * stripBySelectors owns the single counted Set for the whole row, so a row
 * behaves exactly like the function it replaces: the union of all groups is
 * collected before any removal, and each element is removed at most once.
 * Splitting a row into several engine calls would NOT preserve counting when
 * an ancestor and a descendant match different groups, which is why groups
 * with different predicates still live in one row.
 */

import { escapeCssSelector } from '../cssUtils.js';
import {
    buildClassIdSelectors,
    isFixedOrSticky,
    isLikelyAd,
    isLikelyPopup,
    isPlatformNoise,
    safeRemoveElement,
} from './helpers.js';
import {
    AD_CLASS_PATTERNS,
    CARD_PATTERNS,
    COOKIE_TEXT_PATTERNS,
    DEEP_CLASS_PATTERNS,
    DEEP_ROLES,
    EC_SITE_PATTERNS,
    NAV_CLASS_PATTERNS,
    NEWS_MEDIA_PATTERNS,
    QA_SITE_PATTERNS,
    SOCIAL_CLASS_PATTERNS,
    VIDEO_SITE_PATTERNS,
} from './patterns.js';

/** One selector group inside a row: a verbatim CSS query plus an optional gate. */
export interface SelectorGroupDef {
    css: string;
    predicate?: (el: Element) => boolean;
}

/**
 * One table-ized strip rule. `predicate` gates the pattern-built selectors;
 * groups in `extraSelectors` carry their own gates independently.
 */
export interface SelectorRuleDef {
    key: string;
    patterns?: string[];
    extraSelectors?: Array<string | SelectorGroupDef>;
    predicate?: (el: Element) => boolean;
}

/** Built pattern selectors, cached per row so repeated cleanses never rebuild strings. */
const patternSelectorCache = new WeakMap<SelectorRuleDef, string>();

function patternSelectorFor(def: SelectorRuleDef, extraPatterns?: string[]): string {
    if (extraPatterns !== undefined && extraPatterns.length > 0) {
        return buildClassIdSelectors([...(def.patterns ?? []), ...extraPatterns]);
    }
    const patterns = def.patterns;
    if (patterns === undefined || patterns.length === 0) {
        return '';
    }
    let cached = patternSelectorCache.get(def);
    if (cached === undefined) {
        cached = buildClassIdSelectors(patterns);
        patternSelectorCache.set(def, cached);
    }
    return cached;
}

/**
 * Runs one selector row: collects the union of every group under a single
 * counted Set, then removes. Returns how many elements were removed.
 */
export function stripBySelectors(root: Element, def: SelectorRuleDef, extraPatterns?: string[]): number {
    const counted = new Set<Element>();
    const collected: Element[] = [];
    const collect = (selector: string, predicate?: (el: Element) => boolean): void => {
        if (selector === '') {
            return;
        }
        root.querySelectorAll(selector).forEach((elem) => {
            if (counted.has(elem)) {
                return;
            }
            if (predicate !== undefined && !predicate(elem)) {
                return;
            }
            collected.push(elem);
            counted.add(elem);
        });
    };

    collect(patternSelectorFor(def, extraPatterns), def.predicate);
    for (const entry of def.extraSelectors ?? []) {
        if (typeof entry === 'string') {
            collect(entry);
        } else {
            collect(entry.css, entry.predicate);
        }
    }

    let removed = 0;
    for (const elem of collected) {
        if (safeRemoveElement(elem)) {
            removed++;
        }
    }
    return removed;
}

/**
 * Text-based cookie-consent check shared by the cookie rule implementation
 * (stripExtended keeps collectCookieConsentElements as the proven precedent)
 * and the popup row below, so both match the same elements.
 */
export function isCookieConsentText(elem: Element): boolean {
    const text = (elem.textContent || '').trim();
    if (text.length > 1200 || text.length < 10) {
        return false;
    }
    if (elem.querySelectorAll('p, article, section').length >= 3) {
        return false;
    }
    return COOKIE_TEXT_PATTERNS.some((pattern) => pattern.test(text));
}

const JP_NAVIGATION_KEYWORDS = [' Site Menu', 'このサイトのメニュー', 'ページメニュー'];

const AUTHOR_META_KEYWORDS = ['この記事書いた人', 'プロフィール', '投稿', '更新日', '著者'];

const JP_LAYOUT_PATTERNS = [
    'l-footer', 'l-header', 'l-sidebar', 'l-wrapper',
    'p-entry__footer', 'p-entry__header', 'p-entry__body',
    'c-button', 'c-label', 'c-card',
    'common-footer', 'common-header', 'sub-column',
    'ly-', 'el-',
    'swell-toc', 'p-postList', 'c-shareBtns', 'p-relatedPosts', 'c-widget',
    'swell-block-', 'swell-block-check', 'swell-block-quote',
    'author-box', 'author-box-label', 'sns-share', 'related-entry-card',
    'toc', 'toc-box', 'sidebar', 'sns-follow-buttons', 'article-outer',
    'entry-card', 'post-list', 'sidebar-widget', 'author-block', 'share-btn',
    'entry-utility', 'cat-links', 'tag-links', 'wp-post-image', 'post-thumbnail',
    'sm-related-posts', 'sm-author-profile', 'sm-widget', 'sm-entry-summary',
    'stinger', 'stingerV8',
    'ad-disclosure', 'promotion-note', 'pr-disclosure',
    'disclosure-area', 'sponsor-info-wrapper', 'pr-note',
    'promotion-content', 'sponsored-content-label',
    'popin_recommend', 'popin_recommend_container', 'popin-recommend',
    'logly-lift', 'logly-lift-widget', 'logly-widget',
    'uzou-recommend', 'uzou-widget', 'uzou-recommendation',
    'outbrain_carousels', 'outbrain-widget', 'taboola-placeholder',
    'taboola-unit', 'taboola-container',
    'wp-block-button', 'wp-block-separator', 'wp-block-spacer',
    'wp-block-pullquote', 'wp-block-image', 'wp-block-list',
    'wp-block-quote', 'wp-block-code',
    'pagetop', 'page-top', 'to-top', 'go-top', 'btn-pagetop', 'back-to-top',
    'drawer-menu', 'sp-menu', 'hamburger', 'toggle-menu', 'mobile-menu', 'menu-drawer',
    'toc-container', 'rtoc-box', 'toc_list',
    'table-of-contents', 'toc-wrapper', 'toc_title',
    'access-counter', 'accesscount', 'pv-counter', 'page-counter',
];

const RECOMMEND_PATTERNS = [
    'carousel', 'slider', 'recommend-item', 'product-carousel',
    'pickup', 'feature', 'ranking', 'trending',
    'for-you', 'personalized', 'recommendation-box',
    'ichiran', 'yoyaku', 'osusume', 'kanren', 'kiji-related',
    'kaiwa-related', 'yahoo-relation', 'lazuda', 'rakuten-scrap',
    'sp-RELATED', 'sp-centered', 'a-carousel-container',
    'contents--contents-recommend', 'pickup-content',
    'recommend-list',
];

const PAGINATION_PATTERNS = [
    'next', 'prev', 'pager', 'page-nav', 'page-numbers',
    'pagination-numbers', 'pagination', 'load-more',
    'infinite-scroll-trigger',
];

const SNS_PROMO_PATTERNS = [
    'promoted', 'sponsored', 'sp-cc', 'trend-item',
    'a-carousel', 'sp-RELATED', 'ad-slot', 'ad-container',
    'sp-ads', 'sp-ad', 'sponseredContent', 'adPokemon',
    'tweet-promoted', 'promoted-trend', 'ads-results',
    'koukoku', 'kouka', 'ad-area',
];

const POPUP_PATTERNS = [
    'popup', 'modal', 'overlay', 'lightbox', 'dialog',
    'toast', 'notification', 'snackbar', 'ribbon', 'alert',
    'consent', 'cookie-banner', 'gdpr', 'age-gate', 'paywall',
    'onetrust', 'ot-sdk', 'optanon', 'truste', 'cc-banner', 'cookieNotice', 'consent-sdk', 'cookieConsent',
    'ameba-popup', 'follow-prompt', 'spc-overlay', 'warranty-popup',
    'popup-cookie', 'consent-banner', 'login-prompt',
    'a-popover', 'a-modal', 'snssignup',
    'game8-popup', 'loginbox', 'messagebox',
];

const PLATFORM_PATTERNS = [
    'be-', 'mona', 'since', '2chmate', '2ch-sc', 'matome-hatune',
    'ytp-', 'ytd-companion', 'video-ads', 'ytd-promoted-video',
    'tver-overlay', 'player-overlay',
    'nico-external-banner', 'ndm-ads', 'nicolive',
    'yahoo-ad', 'weather', 'ranking',
    'aws-iv', 'a-carousel', 'sp-ads',
    'game8-ad', 'adiene',
    'promoted-trend', 'tweet',
];

const JP_NAVIGATION_PATTERNS = [
    'global-nav', 'gnav', 'g-nav', 'primary-nav',
    'footer-nav', 'fnav',
    'topic-path', 'topicpath', 'breadcrumb',
    'site-search', 'search-form', 'ss-search',
    'utility-nav', 'sub-nav', 'local-nav',
];

const AUTHOR_META_PATTERNS = [
    'author-profile', 'writer-bio', 'profile-card',
    'post-date', 'update-date', 'post-meta', 'entry-meta',
    'article-tag', 'post-tag', 'tag-list',
    'entry-footer', 'article-footer',
];

const LAZY_CLASS_SELECTOR = ['lazy', 'skeleton', 'placeholder', 'loading']
    .map((p) => `[class*="${escapeCssSelector(p)}"]`).join(', ');

const SKIP_LINK_CLASS_SELECTOR = ['skip', 'sr-only', 'visually-hidden', 'screen-reader']
    .map((p) => `[class*="${escapeCssSelector(p)}"]`).join(', ');

/** Deep-rule link-density check: formerly inline in stripDeepElements. */
function isDeepLinkDenseList(elem: Element): boolean {
    const totalText = (elem.textContent || '').trim().length;
    if (totalText === 0) {
        return false;
    }
    let linkText = 0;
    elem.querySelectorAll('a').forEach((a) => {
        linkText += (a.textContent || '').length;
    });
    return linkText / totalText > 0.7;
}

/** Deep-rule empty check: formerly inline in stripDeepElements. */
function isDeepEmptyContainer(elem: Element): boolean {
    return (elem.textContent || '').trim() === '';
}

/** Empty-element rule check: formerly inline in stripEmptyElements. */
function isEmptyContainer(elem: Element): boolean {
    const hasText = (elem.textContent || '').trim().length > 0;
    const hasChildren = elem.children.length > 0;
    const hasImages = elem.querySelectorAll('img').length > 0;
    if (!hasText && !hasImages) {
        if (!hasChildren) {
            return true;
        }
        for (const child of Array.from(elem.children)) {
            const childText = (child.textContent || '').trim();
            const childHasContent = childText.length > 0 || child.querySelectorAll('img').length > 0;
            if (childHasContent) {
                return false;
            }
        }
        return true;
    }
    return false;
}

/**
 * Every pattern-based strip row, keyed by its CLEANSING_RULES key.
 * Bespoke rules (alt, legal, linkDensity, fixed, cookie, textDensity,
 * shortSeq, symbolLine, linkPara, affiliate, speechBubble) have no row here:
 * their logic is not selector-shaped and they stay functions.
 */
export const SELECTOR_RULE_DEFS = {
    metadata: {
        key: 'metadata',
        extraSelectors: ['meta', 'title', 'link[rel="icon"], link[rel="stylesheet"], link[rel="canonical"]'],
    },
    ads: {
        key: 'ads',
        patterns: AD_CLASS_PATTERNS,
        extraSelectors: [
            '[data-ad], [data-ad-slot], [data-ad-client], [data-dfp], [data-gpt-ad], ' +
            'ins.adsbygoogle, [class*="sponsored-content"], [class*="native-ad"]',
        ],
    },
    nav: {
        key: 'nav',
        patterns: NAV_CLASS_PATTERNS,
        extraSelectors: [
            'nav',
            'footer',
            '[role="navigation"]',
            '[role="contentinfo"]',
            '[data-testid*="footer"], [data-testid*="nav"], ' +
            '[aria-label*="advertisement"], [aria-label*="navigation"], [aria-label*="footer"]',
        ],
    },
    social: {
        key: 'social',
        patterns: SOCIAL_CLASS_PATTERNS,
        extraSelectors: ['#comments, .comments, .comment-section'],
    },
    deep: {
        key: 'deep',
        patterns: DEEP_CLASS_PATTERNS,
        extraSelectors: [
            'aside, figure, figcaption, form, dialog, iframe, video, audio, script, style, noscript, button, input, select, details',
            DEEP_ROLES.map((role) => `[role="${role}"]`).join(', '),
            { css: 'ul, ol', predicate: isDeepLinkDenseList },
            '[hidden], [aria-hidden="true"], [style*="display:none"], [style*="display: none"]',
            { css: 'div, span, p', predicate: isDeepEmptyContainer },
        ],
    },
    jsonLd: {
        key: 'jsonLd',
        extraSelectors: ['script[type="application/ld+json"]'],
    },
    lazyLoad: {
        key: 'lazyLoad',
        extraSelectors: [
            '[loading="lazy"]',
            'img[data-src], iframe[data-src], video[data-src]',
            LAZY_CLASS_SELECTOR,
        ],
    },
    skipLink: {
        key: 'skipLink',
        extraSelectors: [
            'a[href^="#"], a[href^="javascript:"]',
            'a[role="button"]',
            SKIP_LINK_CLASS_SELECTOR,
        ],
    },
    card: {
        key: 'card',
        patterns: CARD_PATTERNS,
    },
    recommend: {
        key: 'recommend',
        patterns: RECOMMEND_PATTERNS,
        extraSelectors: [
            '[data-cs="viewRelation"], [data-ual="relation"], .relation-module, .topics-module',
            '[class*="rankingList"], [class*="RankingBox"], [id*="Ranking"]',
        ],
    },
    pagination: {
        key: 'pagination',
        patterns: PAGINATION_PATTERNS,
    },
    snsPromo: {
        key: 'snsPromo',
        patterns: SNS_PROMO_PATTERNS,
        extraSelectors: [
            '[data-testid="promotedIndicator"]',
            '[aria-label="Trending now"]',
            { css: '[data-a-divination], [class*="AdHolder"], [id*="ad"]', predicate: isLikelyAd },
        ],
    },
    popup: {
        key: 'popup',
        patterns: POPUP_PATTERNS,
        extraSelectors: [
            'dialog[open]',
            { css: '[id*="cookie"], [class*="cookie"], [id*="consent"], [class*="consent"]', predicate: isLikelyPopup },
            { css: 'p, div, span, small, footer, section', predicate: isCookieConsentText },
        ],
    },
    platform: {
        key: 'platform',
        patterns: PLATFORM_PATTERNS,
        extraSelectors: [
            '#comments, #related, .ytd-watch-flexy .secondary, #secondary',
            { css: '[class*="number"], [class*="postnum"], [class*="id"], [class*="beid"]', predicate: isPlatformNoise },
        ],
    },
    enhancedHidden: {
        key: 'enhancedHidden',
        extraSelectors: [
            '[hidden]',
            '[aria-hidden="true"]',
            '[style*="display: none"]',
            '[style*="display:none"]',
            '[style*="visibility: hidden"]',
            '[style*="visibility:hidden"]',
            { css: '[style*="opacity: 0"]', predicate: isFixedOrSticky },
            'template',
            'slot',
        ],
    },
    emptyElem: {
        key: 'emptyElem',
        extraSelectors: [
            { css: 'div, span, p, section, article', predicate: isEmptyContainer },
        ],
    },
    jpLayout: {
        key: 'jpLayout',
        patterns: JP_LAYOUT_PATTERNS,
    },
    jpNavigation: {
        key: 'jpNavigation',
        patterns: JP_NAVIGATION_PATTERNS,
        extraSelectors: [
            { css: 'p, div, span, li', predicate: (el: Element): boolean =>
                JP_NAVIGATION_KEYWORDS.some((kw) => (el.textContent || '').includes(kw)) },
        ],
    },
    author: {
        key: 'author',
        patterns: AUTHOR_META_PATTERNS,
        extraSelectors: [
            { css: 'p, div, span', predicate: (el: Element): boolean => {
                const text = el.textContent || '';
                if (text.length > 200) {
                    return false;
                }
                return AUTHOR_META_KEYWORDS.some((kw) => text.includes(kw));
            } },
        ],
    },
    newsMedia: {
        key: 'newsMedia',
        patterns: NEWS_MEDIA_PATTERNS,
    },
    ecSite: {
        key: 'ecSite',
        patterns: EC_SITE_PATTERNS,
    },
    qaSite: {
        key: 'qaSite',
        patterns: QA_SITE_PATTERNS,
    },
    videoSite: {
        key: 'videoSite',
        patterns: VIDEO_SITE_PATTERNS,
    },
} satisfies Record<string, SelectorRuleDef>;

export type SelectorRuleKey = keyof typeof SELECTOR_RULE_DEFS;
