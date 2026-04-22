/**
 * AI要約クレンジング — 拡張_strip関数群
 * 追加の6オプション（固定・推薦・ページネーション・SNSプロモ・ポップアップ・プラットフォーム）+
 * 9オプション（テキスト密度・短文連続・記号行・リンクのみ段落・非表示強化・空要素・JPレイアウト・JPナビ・著者メタ）
 */

import { buildClassIdSelectors, isFixedOrSticky, isLikelyAd, isLikelyPopup, isPlatformNoise } from './helpers.js';

/**
 * 固定要素を削除（position:fixed/sticky）
 * @param element - クレンジング対象のルート要素
 * @returns 削除した要素の数
 */
export function stripFixedElements(element: Element): number {
    let removedCount = 0;
    const elementsToRemove: Element[] = [];
    const counted = new Set<Element>();

    const fixedElements = element.querySelectorAll('[style*="position: fixed"], [style*="position:fixed"]');
    fixedElements.forEach(elem => {
        if (!counted.has(elem)) {
            elementsToRemove.push(elem);
            counted.add(elem);
        }
    });

    const stickyElements = element.querySelectorAll('[style*="position: sticky"], [style*="position:sticky"]');
    stickyElements.forEach(elem => {
        if (!counted.has(elem)) {
            elementsToRemove.push(elem);
            counted.add(elem);
        }
    });

    const fixedPlayerElements = element.querySelectorAll('[class*="fixed-video"], [class*="sticky-player"]');
    fixedPlayerElements.forEach(elem => {
        if (!counted.has(elem)) {
            elementsToRemove.push(elem);
            counted.add(elem);
        }
    });

    // Yahoo! News 固定ヘッダー
    element.querySelectorAll('[class*="yahoo-news"], [id*="headerWrap"], [class*="Topics"], [class*="IssueTop"]').forEach(elem => {
        if (!counted.has(elem) && isFixedOrSticky(elem)) {
            elementsToRemove.push(elem);
            counted.add(elem);
        }
    });

    // Game8 固定メニュー
    element.querySelectorAll('[class*="game8"], [class*="headerMenu"], [class*="SideBar"], [id*="SideBar"]').forEach(elem => {
        if (!counted.has(elem) && isFixedOrSticky(elem)) {
            elementsToRemove.push(elem);
            counted.add(elem);
        }
    });

    for (const elem of elementsToRemove) {
        elem.remove();
        removedCount++;
    }

    return removedCount;
}

/**
 * 推薦セクションを削除
 * @param element - クレンジング対象のルート要素
 * @returns 削除した要素の数
 */
export function stripRecommendSections(element: Element): number {
    let removedCount = 0;
    const elementsToRemove: Element[] = [];
    const counted = new Set<Element>();

    const recommendPatterns = [
        // 英語パターン
        'carousel', 'slider', 'recommend-item', 'product-carousel',
        'pickup', 'feature', 'ranking', 'trending',
        'for-you', 'personalized', 'recommendation-box',
        // 日本語パターン
        'ichiran', 'yoyaku', 'osusume', 'kanren', 'kiji-related',
        'kaiwa-related', 'yahoo-relation', 'lazuda', 'rakuten-scrap',
        // Amazon
        'sp-RELATED', 'sp-centered', 'a-carousel-container',
        // その他
        'contents--contents-recommend', 'pickup-content',
        'recommend-list'
    ];

    element.querySelectorAll(buildClassIdSelectors(recommendPatterns)).forEach(elem => {
        if (!counted.has(elem)) {
            elementsToRemove.push(elem);
            counted.add(elem);
        }
    });

    // Yahoo! 関連知見・ドック
    element.querySelectorAll('[data-cs="viewRelation"], [data-ual="relation"], .relation-module, .topics-module').forEach(elem => {
        if (!counted.has(elem)) {
            elementsToRemove.push(elem);
            counted.add(elem);
        }
    });

    // Game8 ランキング
    element.querySelectorAll('[class*="rankingList"], [class*="RankingBox"], [id*="Ranking"]').forEach(elem => {
        if (!counted.has(elem)) {
            elementsToRemove.push(elem);
            counted.add(elem);
        }
    });

    for (const elem of elementsToRemove) {
        elem.remove();
        removedCount++;
    }

    return removedCount;
}

/**
 * ページネーション要素を削除
 * @param element - クレンジング対象のルート要素
 * @returns 削除した要素の数
 */
export function stripPaginationElements(element: Element): number {
    let removedCount = 0;
    const elementsToRemove: Element[] = [];
    const counted = new Set<Element>();

    const paginationPatterns = [
        'next', 'prev', 'pager', 'page-nav', 'page-numbers',
        'pagination-numbers', 'pagination', 'load-more',
        'infinite-scroll-trigger'
    ];

    element.querySelectorAll(buildClassIdSelectors(paginationPatterns)).forEach(elem => {
        if (!counted.has(elem)) {
            elementsToRemove.push(elem);
            counted.add(elem);
        }
    });

    for (const elem of elementsToRemove) {
        elem.remove();
        removedCount++;
    }

    return removedCount;
}

/**
 * SNS/Amazonプロモコンテンツを削除
 * @param element - クレンジング対象のルート要素
 * @returns 削除した要素の数
 */
export function stripSnsPromoElements(element: Element): number {
    let removedCount = 0;
    const elementsToRemove: Element[] = [];
    const counted = new Set<Element>();

    const snsPromoPatterns = [
        // 英語
        'promoted', 'sponsored', 'sp-cc', 'trend-item',
        'a-carousel', 'sp-RELATED', 'ad-slot', 'ad-container',
        // Amazon スポンサープロダクト
        'sp-ads', 'sp-ad', 'sponseredContent', 'adPokemon',
        // Google/Twitter
        'tweet-promoted', 'promoted-trend', 'ads-results',
        // 日本語
        'koukoku', 'kouka', 'ad-area'
    ];

    element.querySelectorAll(buildClassIdSelectors(snsPromoPatterns)).forEach(elem => {
        if (!counted.has(elem)) {
            elementsToRemove.push(elem);
            counted.add(elem);
        }
    });

    element.querySelectorAll('[data-testid="promotedIndicator"]').forEach(elem => {
        if (!counted.has(elem)) {
            elementsToRemove.push(elem);
            counted.add(elem);
        }
    });

    element.querySelectorAll('[aria-label="Trending now"]').forEach(elem => {
        if (!counted.has(elem)) {
            elementsToRemove.push(elem);
            counted.add(elem);
        }
    });

    // Amazon スポンサー製品リンク
    element.querySelectorAll('[data-a-divination], [class*="AdHolder"], [id*="ad"]').forEach(elem => {
        if (!counted.has(elem) && isLikelyAd(elem)) {
            elementsToRemove.push(elem);
            counted.add(elem);
        }
    });

    for (const elem of elementsToRemove) {
        elem.remove();
        removedCount++;
    }

    return removedCount;
}

/**
 * ポップアップ/モーダル/通知-estを削除
 * @param element - クレンジング対象のルート要素
 * @returns 削除した要素の数
 */
export function stripPopupElements(element: Element): number {
    let removedCount = 0;
    const elementsToRemove: Element[] = [];
    const counted = new Set<Element>();

    const popupPatterns = [
        // 英語
        'popup', 'modal', 'overlay', 'lightbox', 'dialog',
        'toast', 'notification', 'snackbar', 'ribbon', 'alert',
        'consent', 'cookie-banner', 'gdpr', 'age-gate', 'paywall',
        // 日本語
        'ameba-popup', 'follow-prompt', 'spc-overlay', 'warranty-popup',
        'popup-cookie', 'consent-banner', 'login-prompt',
        // Amazon
        'a-popover', 'a-modal', 'snssignup',
        // Game8
        'game8-popup', 'loginbox', 'messagebox'
    ];

    element.querySelectorAll(buildClassIdSelectors(popupPatterns)).forEach(elem => {
        if (!counted.has(elem)) {
            elementsToRemove.push(elem);
            counted.add(elem);
        }
    });

    // dialog要素
    element.querySelectorAll('dialog[open]').forEach(elem => {
        if (!counted.has(elem)) {
            elementsToRemove.push(elem);
            counted.add(elem);
        }
    });

    // cookie consent banner
    element.querySelectorAll('[id*="cookie"], [class*="cookie"], [id*="consent"], [class*="consent"]').forEach(elem => {
        if (!counted.has(elem) && isLikelyPopup(elem)) {
            elementsToRemove.push(elem);
            counted.add(elem);
        }
    });

    for (const elem of elementsToRemove) {
        elem.remove();
        removedCount++;
    }

    return removedCount;
}

/**
 * プラットフォーム固有のノイズを削除
 * @param element - クレンジング対象のルート要素
 * @returns 削除した要素の数
 */
export function stripPlatformNoise(element: Element): number {
    let removedCount = 0;
    const elementsToRemove: Element[] = [];
    const counted = new Set<Element>();

    const platformPatterns = [
        // 5ch/be
        'be-', 'mona', 'since', '2chmate', '2ch-sc', 'matome-hatune',
        // YouTube
        'ytp-', 'ytd-companion', 'video-ads', 'ytd-promoted-video',
        // TVer
        'tver-overlay', 'player-overlay',
        // ニコニコ動画
        'nico-external-banner', 'ndm-ads', 'nicolive',
        // Yahoo!
        'yahoo-ad', 'weather', 'ranking',
        // Amazon
        'aws-iv', 'a-carousel', 'sp-ads',
        // Game8
        'game8-ad', 'adiene',
        //  Twitter/X 
        'promoted-trend', 'tweet'
    ];

    element.querySelectorAll(buildClassIdSelectors(platformPatterns)).forEach(elem => {
        if (!counted.has(elem)) {
            elementsToRemove.push(elem);
            counted.add(elem);
        }
    });

    // YouTube コメント欄
    element.querySelectorAll('#comments, #related, .ytd-watch-flexy .secondary, #secondary').forEach(elem => {
        if (!counted.has(elem)) {
            elementsToRemove.push(elem);
            counted.add(elem);
        }
    });

    // 5ch mate板的レス番とID
    element.querySelectorAll('[class*="number"], [class*="postnum"], [class*="id"], [class*="beid"]').forEach(elem => {
        if (!counted.has(elem) && isPlatformNoise(elem)) {
            elementsToRemove.push(elem);
            counted.add(elem);
        }
    });

    for (const elem of elementsToRemove) {
        elem.remove();
        removedCount++;
    }

    return removedCount;
}

// ============================================================================
// 9つの追加クレンジング関数
// ============================================================================

/**
 * テキスト密度が高い要素を削除（リンク文字が70%以上の要素）
 * @param element - クレンジング対象のルート要素
 * @param threshold - リンク密度閾値（デフォルト: 70%）
 * @returns 削除した要素の数
 */
export function stripTextDensityElements(element: Element, threshold: number = 70): number {
    let removedCount = 0;
    const elementsToRemove: Element[] = [];
    const counted = new Set<Element>();
    const ratio = threshold / 100;

    const targets = element.querySelectorAll('ul, ol, div, nav');
    targets.forEach(elem => {
        if (counted.has(elem)) return;
        const text = elem.textContent || '';
        const totalText = text.length;
        if (totalText < 50) return;

        let linkText = 0;
        elem.querySelectorAll('a').forEach(a => {
            linkText += (a.textContent || '').length;
        });

        if (totalText > 0 && linkText / totalText >= ratio) {
            elementsToRemove.push(elem);
            counted.add(elem);
        }
    });

    for (const elem of elementsToRemove) {
        elem.remove();
        removedCount++;
    }
    return removedCount;
}

/**
 * 短文要素の連続を削除
 * @param element - クレンジング対象のルート要素
 * @param shortThreshold - 短文閾値文字数（デフォルト: 30）
 * @param seqCount - 連続数閾値（デフォルト: 5）
 * @returns 削除した要素の数
 */
export function stripShortSequenceElements(element: Element, shortThreshold: number = 30, seqCount: number = 5): number {
    let removedCount = 0;
    const elementsToRemove: Element[] = [];
    const counted = new Set<Element>();

    const targets = element.querySelectorAll('p, span, li, div');
    const shortElements: Element[] = [];

    targets.forEach(elem => {
        if (counted.has(elem)) return;
        const text = (elem.textContent || '').trim();
        if (text.length > 0 && text.length <= shortThreshold) {
            shortElements.push(elem);
        }
    });

    let consecutive = 0;
    let lastParent: Element | null = null;

    for (const elem of shortElements) {
        const parent = elem.parentElement;
        if (parent === lastParent) {
            consecutive++;
        } else {
            consecutive = 1;
            lastParent = parent;
        }

        if (consecutive >= seqCount) {
            elementsToRemove.push(elem);
            counted.add(elem);
        }
    }

    for (const elem of elementsToRemove) {
        elem.remove();
        removedCount++;
    }
    return removedCount;
}

/**
 * 特殊記号行を削除
 * @param element - クレンジング対象のルート要素
 * @returns 削除した要素の数
 */
export function stripSymbolLineElements(element: Element): number {
    let removedCount = 0;
    const elementsToRemove: Element[] = [];
    const counted = new Set<Element>();
    const symbolPattern = /^[|\►◀▶«»•·]+$/;

    const targets = element.querySelectorAll('p, span, div, li');
    targets.forEach(elem => {
        if (counted.has(elem)) return;
        const text = (elem.textContent || '').trim();
        if (text.length > 0 && symbolPattern.test(text)) {
            elementsToRemove.push(elem);
            counted.add(elem);
        }
    });

    for (const elem of elementsToRemove) {
        elem.remove();
        removedCount++;
    }
    return removedCount;
}

/**
 * リンクのみ段落を削除（50文字以下のリンクのみ段落）
 * @param element - クレンジング対象のルート要素
 * @param maxLength - 最大文字数閾値（デフォルト: 50）
 * @returns 削除した要素の数
 */
export function stripLinkOnlyParagraphs(element: Element, maxLength: number = 50): number {
    let removedCount = 0;
    const elementsToRemove: Element[] = [];
    const counted = new Set<Element>();

    const paragraphs = element.querySelectorAll('p');
    paragraphs.forEach(p => {
        if (counted.has(p)) return;
        const text = (p.textContent || '').trim();
        if (text.length > maxLength) return;

        const children = p.children;
        let hasLinks = false;
        let hasOnlyLinks = true;
        let hasNonLinkText = false;

        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            if (child.tagName.toLowerCase() === 'a') {
                hasLinks = true;
                continue;
            }
            if (child.tagName.toLowerCase() === 'br') {
                continue;
            }
            hasOnlyLinks = false;
            break;
        }

        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            if (child.tagName.toLowerCase() !== 'a' && child.tagName.toLowerCase() !== 'br') {
                const childText = child.textContent || '';
                if (childText.trim().length > 0) {
                    hasNonLinkText = true;
                    break;
                }
            }
        }

        // Check for direct text nodes outside of links
        if (!hasNonLinkText) {
            for (const node of Array.from(p.childNodes)) {
                if (node.nodeType === 3 && (node.nodeValue || '').trim().length > 0) {
                    hasNonLinkText = true;
                    break;
                }
            }
        }

        if (hasLinks && hasOnlyLinks && !hasNonLinkText && text.length > 0) {
            elementsToRemove.push(p);
            counted.add(p);
        }
    });

    for (const elem of elementsToRemove) {
        elem.remove();
        removedCount++;
    }
    return removedCount;
}

/**
 * 非表示要素を強化削除
 * @param element - クレンジング対象のルート要素
 * @returns 削除した要素の数
 */
export function stripEnhancedHiddenElements(element: Element): number {
    let removedCount = 0;
    const elementsToRemove: Element[] = [];
    const counted = new Set<Element>();

    const selectors = [
        '[hidden]',
        '[aria-hidden="true"]',
        '[style*="display: none"]',
        '[style*="display:none"]',
        '[style*="visibility: hidden"]',
        '[style*="visibility:hidden"]',
        '[style*="opacity: 0"]',
        'template',
        'slot'
    ];

    for (const sel of selectors) {
        element.querySelectorAll(sel).forEach(elem => {
            if (!counted.has(elem)) {
                if (sel.includes('opacity: 0')) {
                    const style = elem.getAttribute('style') || '';
                    if (style.includes('position: fixed') || style.includes('position:fixed') ||
                        style.includes('position: sticky') || style.includes('position:sticky')) {
                        elementsToRemove.push(elem);
                        counted.add(elem);
                    }
                } else {
                    elementsToRemove.push(elem);
                    counted.add(elem);
                }
            }
        });
    }

    for (const elem of elementsToRemove) {
        elem.remove();
        removedCount++;
    }
    return removedCount;
}

/**
 * 空要素を削除
 * @param element - クレンジング対象のルート要素
 * @returns 削除した要素の数
 */
export function stripEmptyElements(element: Element): number {
    let removedCount = 0;
    const elementsToRemove: Element[] = [];
    const counted = new Set<Element>();

    const targets = element.querySelectorAll('div, span, p, section, article');
    targets.forEach(elem => {
        if (counted.has(elem)) return;
        const hasText = (elem.textContent || '').trim().length > 0;
        const hasChildren = elem.children.length > 0;
        const hasImages = elem.querySelectorAll('img').length > 0;

        if (!hasText && !hasImages) {
            if (!hasChildren) {
                elementsToRemove.push(elem);
                counted.add(elem);
            } else {
                let allEmpty = true;
                for (const child of Array.from(elem.children)) {
                    const childText = (child.textContent || '').trim();
                    const childHasContent = childText.length > 0 || child.querySelectorAll('img').length > 0;
                    if (childHasContent) {
                        allEmpty = false;
                        break;
                    }
                }
                if (allEmpty) {
                    elementsToRemove.push(elem);
                    counted.add(elem);
                }
            }
        }
    });

    for (const elem of elementsToRemove) {
        elem.remove();
        removedCount++;
    }
    return removedCount;
}

/**
 * JP BEM系レイアウトパターンを削除
 * @param element - クレンジング対象のルート要素
 * @param customPatterns - カスタムパターン列表
 * @returns 削除した要素の数
 */
export function stripJPLayoutPatterns(element: Element, customPatterns: string[] = []): number {
    let removedCount = 0;
    const elementsToRemove: Element[] = [];
    const counted = new Set<Element>();

    const patterns = [
        'l-footer', 'l-header', 'l-sidebar', 'l-wrapper',
        'p-entry__footer', 'p-entry__header', 'p-entry__body',
        'c-button', 'c-label', 'c-card',
        'common-footer', 'common-header', 'sub-column',
        'ly-', 'el-',
        ...customPatterns
    ];

    element.querySelectorAll(buildClassIdSelectors(patterns)).forEach(elem => {
        if (!counted.has(elem)) {
            elementsToRemove.push(elem);
            counted.add(elem);
        }
    });

    for (const elem of elementsToRemove) {
        elem.remove();
        removedCount++;
    }
    return removedCount;
}

/**
 * JP ナビ頻出語を削除
 * @param element - クレンジング対象のルート要素
 * @returns 削除した要素の数
 */
export function stripJPNavigationPatterns(element: Element): number {
    let removedCount = 0;
    const elementsToRemove: Element[] = [];
    const counted = new Set<Element>();

    const patterns = [
        'global-nav', 'gnav', 'g-nav', 'primary-nav',
        'footer-nav', 'fnav',
        'topic-path', 'topicpath', 'breadcrumb',
        'site-search', 'search-form', 'ss-search',
        'utility-nav', 'sub-nav', 'local-nav'
    ];

    element.querySelectorAll(buildClassIdSelectors(patterns)).forEach(elem => {
        if (!counted.has(elem)) {
            elementsToRemove.push(elem);
            counted.add(elem);
        }
    });

    const keywords = [' Site Menu', 'このサイトのメニュー', 'ページメニュー'];
    const targets = element.querySelectorAll('p, div, span, li');
    targets.forEach(elem => {
        if (counted.has(elem)) return;
        const text = elem.textContent || '';
        for (const kw of keywords) {
            if (text.includes(kw)) {
                elementsToRemove.push(elem);
                counted.add(elem);
                break;
            }
        }
    });

    for (const elem of elementsToRemove) {
        elem.remove();
        removedCount++;
    }
    return removedCount;
}

/**
 * 執筆者・メタ情報を削除
 * @param element - クレンジング対象のルート要素
 * @returns 削除した要素の数
 */
export function stripAuthorMetaElements(element: Element): number {
    let removedCount = 0;
    const elementsToRemove: Element[] = [];
    const counted = new Set<Element>();

    const patterns = [
        'author-profile', 'writer-bio', 'profile-card',
        'post-date', 'update-date', 'post-meta', 'entry-meta',
        'article-tag', 'post-tag', 'tag-list',
        'entry-footer', 'article-footer'
    ];

    element.querySelectorAll(buildClassIdSelectors(patterns)).forEach(elem => {
        if (!counted.has(elem)) {
            elementsToRemove.push(elem);
            counted.add(elem);
        }
    });

    const keywords = ['この記事書いた人', 'プロフィール', '投稿', '更新日', '著者'];
    const targets = element.querySelectorAll('p, div, span');
    targets.forEach(elem => {
        if (counted.has(elem)) return;
        const text = elem.textContent || '';
        if (text.length > 200) return;
        for (const kw of keywords) {
            if (text.includes(kw)) {
                elementsToRemove.push(elem);
                counted.add(elem);
                break;
            }
        }
    });

    for (const elem of elementsToRemove) {
        elem.remove();
        removedCount++;
    }
    return removedCount;
}