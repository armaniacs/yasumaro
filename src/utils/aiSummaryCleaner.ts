/**
 * aiSummaryCleaner.ts
 * 【機能概要】: AI要約に不要な情報を含む要素を削除する
 * 【設計方針】:
 *   - AI要約（generateSummary）に渡す前に適用
 *   - 画像alt属性、メタデータ、広告、ナビゲーション、ソーシャルウィジェットを削除
 *   - 外部ライブラリ不使用（バンドルサイズ抑止）
 * 🟢
 */

import { escapeCssSelector } from './cssUtils.js';

/**
 * AI要約クレンジングオプション
 */
export interface AiSummaryCleanseOptions {
    altEnabled?: boolean;           // 画像alt属性削除
    metadataEnabled?: boolean;      // メタデータ削除
    adsEnabled?: boolean;           // 広告関連要素削除
    navEnabled?: boolean;           // ナビゲーション・フッター削除
    socialEnabled?: boolean;        // コメント・ソーシャルウィジェット削除
    deepEnabled?: boolean;          // ディープクレンジング（aside/form/cookie/関連記事等）
}

/**
 * AI要約クレンジング結果
 */
export interface AiSummaryCleanseResult {
    altRemoved: number;             // 画像alt属性削除数
    metadataRemoved: number;        // メタデータ削除数
    adsRemoved: number;             // 広告関連要素削除数
    navRemoved: number;             // ナビゲーション・フッター削除数
    socialRemoved: number;          // ソーシャルウィジェット削除数
    deepRemoved: number;            // ディープクレンジング削除数
    totalRemoved: number;           // 合計削除数
    bytesBefore: number;            // クレンジング前のバイト数
    bytesAfter: number;             // クレンジング後のバイト数
}

/**
 * 広告関連のクラス名パターン
 */
const AD_CLASS_PATTERNS = [
    'ad-',
    'advertisement',
    'sponsor',
    'sponsored',
    'promo',
    'promotion',
    'banner-ad',
    'ad-banner',
    'ad-container',
    'ad-wrapper',
    'ad-slot',
    'ad-unit'
];

/**
 * ソーシャルメディア関連のクラス名パターン
 */
const SOCIAL_CLASS_PATTERNS = [
    'facebook',
    'twitter',
    'x-',
    'linkedin',
    'instagram',
    'youtube',
    'tiktok',
    'pinterest',
    'share',
    'social',
    'social-share',
    'share-buttons',
    'fb-',
    'tw-',
    'ig-'
];

/**
 * ナビゲーション関連のクラス名パターン
 */
const NAV_CLASS_PATTERNS = [
    'breadcrumb',
    'menu',
    'nav',
    'navigation',
    'footer',
    'header',
    'sidebar',
    'topbar',
    'bottombar'
];

/**
 * 画像alt属性を削除
 * @param element - クレンジング対象のルート要素
 * @returns 削除したalt属性の数
 */
function stripAltAttributes(element: Element): number {
    let removedCount = 0;
    const images = element.querySelectorAll('img[alt]');
    
    images.forEach(img => {
        img.removeAttribute('alt');
        removedCount++;
    });
    
    return removedCount;
}

/**
 * メタデータ要素を削除
 * @param element - クレンジング対象のルート要素
 * @returns 削除した要素の数
 */
function stripMetadataElements(element: Element): number {
    let removedCount = 0;
    const elementsToRemove: Element[] = [];
    
    // metaタグ
    const metaElements = element.querySelectorAll('meta');
    metaElements.forEach(elem => elementsToRemove.push(elem));
    
    // titleタグ
    const titleElements = element.querySelectorAll('title');
    titleElements.forEach(elem => elementsToRemove.push(elem));
    
    // linkタグ（icon, stylesheet, canonicalなど）
    const linkElements = element.querySelectorAll('link[rel="icon"], link[rel="stylesheet"], link[rel="canonical"]');
    linkElements.forEach(elem => elementsToRemove.push(elem));
    
    // 削除実行
    for (const elem of elementsToRemove) {
        elem.remove();
        removedCount++;
    }
    
    return removedCount;
}

/**
 * 広告関連要素を削除
 * @param element - クレンジング対象のルート要素
 * @returns 削除した要素の数
 */
function stripAdElements(element: Element): number {
    let removedCount = 0;
    const elementsToRemove: Element[] = [];
    const counted = new Set<Element>();
    
    // クラス名パターンで検索
    for (const pattern of AD_CLASS_PATTERNS) {
        const kw = escapeCssSelector(pattern.toLowerCase());
        
        // クラスにパターンを含む要素
        const classSelector = `[class*="${kw}"]`;
        const classElements = element.querySelectorAll(classSelector);
        classElements.forEach(elem => {
            if (!counted.has(elem)) {
                elementsToRemove.push(elem);
                counted.add(elem);
            }
        });
        
        // IDにパターンを含む要素
        const idSelector = `[id*="${kw}"]`;
        const idElements = element.querySelectorAll(idSelector);
        idElements.forEach(elem => {
            if (!counted.has(elem)) {
                elementsToRemove.push(elem);
                counted.add(elem);
            }
        });
    }
    
    // 削除実行
    for (const elem of elementsToRemove) {
        elem.remove();
        removedCount++;
    }
    
    return removedCount;
}

/**
 * ナビゲーション・フッター要素を削除
 * @param element - クレンジング対象のルート要素
 * @returns 削除した要素の数
 */
function stripNavElements(element: Element): number {
    let removedCount = 0;
    const elementsToRemove: Element[] = [];
    const counted = new Set<Element>();
    
    // navタグ
    const navElements = element.querySelectorAll('nav');
    navElements.forEach(elem => {
        if (!counted.has(elem)) {
            elementsToRemove.push(elem);
            counted.add(elem);
        }
    });
    
    // footerタグ
    const footerElements = element.querySelectorAll('footer');
    footerElements.forEach(elem => {
        if (!counted.has(elem)) {
            elementsToRemove.push(elem);
            counted.add(elem);
        }
    });
    
    // role="navigation"
    const roleNavElements = element.querySelectorAll('[role="navigation"]');
    roleNavElements.forEach(elem => {
        if (!counted.has(elem)) {
            elementsToRemove.push(elem);
            counted.add(elem);
        }
    });
    
    // クラス名パターンで検索
    for (const pattern of NAV_CLASS_PATTERNS) {
        const kw = escapeCssSelector(pattern.toLowerCase());
        
        // クラスにパターンを含む要素
        const classSelector = `[class*="${kw}"]`;
        const classElements = element.querySelectorAll(classSelector);
        classElements.forEach(elem => {
            if (!counted.has(elem)) {
                elementsToRemove.push(elem);
                counted.add(elem);
            }
        });
        
        // IDにパターンを含む要素
        const idSelector = `[id*="${kw}"]`;
        const idElements = element.querySelectorAll(idSelector);
        idElements.forEach(elem => {
            if (!counted.has(elem)) {
                elementsToRemove.push(elem);
                counted.add(elem);
            }
        });
    }
    
    // 削除実行
    for (const elem of elementsToRemove) {
        elem.remove();
        removedCount++;
    }
    
    return removedCount;
}

/**
 * コメント・ソーシャルウィジェット要素を削除
 * @param element - クレンジング対象のルート要素
 * @returns 削除した要素の数
 */
function stripSocialElements(element: Element): number {
    let removedCount = 0;
    const elementsToRemove: Element[] = [];
    const counted = new Set<Element>();
    
    // #comments
    const commentsElements = element.querySelectorAll('#comments, .comments, .comment-section');
    commentsElements.forEach(elem => {
        if (!counted.has(elem)) {
            elementsToRemove.push(elem);
            counted.add(elem);
        }
    });
    
    // クラス名パターンで検索
    for (const pattern of SOCIAL_CLASS_PATTERNS) {
        const kw = escapeCssSelector(pattern.toLowerCase());
        
        // クラスにパターンを含む要素
        const classSelector = `[class*="${kw}"]`;
        const classElements = element.querySelectorAll(classSelector);
        classElements.forEach(elem => {
            if (!counted.has(elem)) {
                elementsToRemove.push(elem);
                counted.add(elem);
            }
        });
        
        // IDにパターンを含む要素
        const idSelector = `[id*="${kw}"]`;
        const idElements = element.querySelectorAll(idSelector);
        idElements.forEach(elem => {
            if (!counted.has(elem)) {
                elementsToRemove.push(elem);
                counted.add(elem);
            }
        });
    }
    
    // 削除実行
    for (const elem of elementsToRemove) {
        elem.remove();
        removedCount++;
    }
    
    return removedCount;
}

/**
 * ディープクレンジング対象のクラス/IDパターン
 */
const DEEP_CLASS_PATTERNS = [
    // クッキー・同意バナー
    'cookie', 'consent', 'gdpr', 'privacy-notice',
    // ポップアップ・モーダル・オーバーレイ
    'popup', 'modal', 'overlay', 'dialog', 'lightbox',
    // 通知・トースト・リボン
    'toast', 'notification', 'ribbon', 'alert', 'snackbar',
    // 関連記事・レコメンド
    'related', 'recommend', 'ranking', 'popular', 'trending', 'pickup',
    // ページネーション
    'pagination', 'pager', 'page-nav',
    // 目次
    'toc', 'table-of-contents',
    // タグ・カテゴリ
    'tag-list', 'category-list', 'label-list',
    // 著者情報
    'author', 'byline', 'profile-card',
    // メルマガ・購読
    'subscribe', 'newsletter', 'signup-form',
    // CTA・プロモーション
    'cta', 'call-to-action', 'promo-box',
    // ウィジェット
    'widget', 'sidebar-widget',
    // 固定・フローティング要素
    'sticky', 'fixed-bar', 'floating',
    // SNS埋め込み
    'embed', 'twitter-tweet', 'instagram-media',
    // 日本語サイト
    'kanren', 'osusume', 'rankinglist', 'newlist',
    // 法的・ポリシー
    'copyright', 'terms', 'privacy-policy', 'license', 'disclaimer', 'legal', 'site-info',
    // ナビゲーション強化
    'breadcrumb', 'topic-path', 'search-form', 'site-search', 'global-nav', 'utility-nav', 'menu-button', 'hamburger',
    // ソーシャル・コミュニティ
    'reaction', 'clap', 'like-button', 'share-box', 'sns-follow', 'comment-list', 'thread', 'response',
    // 著者・メタ情報
    'author-profile', 'writer-bio', 'post-date', 'update-date', 'post-meta', 'entry-footer', 'article-tag',
    // マーケティング
    'offer', 'campaign', 'lead-capture', 'download-link', 'banner-area', 'promotion', 'ad-slot',
    // 日本語BEM系
    'l-footer', 'l-header', 'l-sidebar', 'p-entry__footer', 'p-entry__header', 'c-button', 'c-label', 'common-footer', 'sub-column'
];

/**
 * ディープクレンジング対象のrole属性
 */
const DEEP_ROLES = [
    'banner',
    'complementary',
    'contentinfo',
    'search',
    'toolbar'
];

/**
 * ディープクレンジング — aside/form/script等のタグ、role属性、クッキー/ポップアップ/関連記事等を削除
 * @param element - クレンジング対象のルート要素
 * @returns 削除した要素の数
 */
function stripDeepElements(element: Element): number {
    let removedCount = 0;
    const elementsToRemove: Element[] = [];
    const counted = new Set<Element>();

    // タグ直接削除
    const directTags = element.querySelectorAll('aside, figure, figcaption, form, dialog, iframe, video, audio, script, style, noscript, button, input, select, details');
    directTags.forEach(elem => {
        if (!counted.has(elem)) {
            elementsToRemove.push(elem);
            counted.add(elem);
        }
    });

    // role属性で削除
    for (const role of DEEP_ROLES) {
        const roleElements = element.querySelectorAll(`[role="${role}"]`);
        roleElements.forEach(elem => {
            if (!counted.has(elem)) {
                elementsToRemove.push(elem);
                counted.add(elem);
            }
        });
    }

    // クラス/IDパターンで削除
    for (const pattern of DEEP_CLASS_PATTERNS) {
        const kw = escapeCssSelector(pattern.toLowerCase());

        const classElements = element.querySelectorAll(`[class*="${kw}"]`);
        classElements.forEach(elem => {
            if (!counted.has(elem)) {
                elementsToRemove.push(elem);
                counted.add(elem);
            }
        });

        const idElements = element.querySelectorAll(`[id*="${kw}"]`);
        idElements.forEach(elem => {
            if (!counted.has(elem)) {
                elementsToRemove.push(elem);
                counted.add(elem);
            }
        });
    }

    // リンク密度の高いリスト（ul/ol内のテキストの80%以上がリンク）
    const lists = element.querySelectorAll('ul, ol');
    lists.forEach(list => {
        if (counted.has(list)) return;
        const totalText = (list.textContent || '').trim().length;
        if (totalText === 0) return;
        let linkText = 0;
        list.querySelectorAll('a').forEach(a => {
            linkText += (a.textContent || '').length;
        });
        if (linkText / totalText > 0.7) {
            elementsToRemove.push(list);
            counted.add(list);
        }
    });

    // 非表示要素の削除
    const hiddenElements = element.querySelectorAll('[hidden], [aria-hidden="true"], [style*="display:none"], [style*="display: none"]');
    hiddenElements.forEach(elem => {
        if (!counted.has(elem)) {
            elementsToRemove.push(elem);
            counted.add(elem);
        }
    });

    // 空要素の削除（テキストコンテンツが空のdiv/span/p）
    const emptyContainers = element.querySelectorAll('div, span, p');
    emptyContainers.forEach(elem => {
        if (!counted.has(elem) && (elem.textContent || '').trim() === '') {
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
 * DOMからAI要約に不要な要素を削除する
 * @param element - クレンジング対象のルート要素
 * @param options - クレンジングオプション
 * @returns クレンジング結果
 */
export function cleanseAISummaryContent(
    element: Element,
    options: AiSummaryCleanseOptions = {}
): AiSummaryCleanseResult {
    const {
        altEnabled = true,
        metadataEnabled = true,
        adsEnabled = true,
        navEnabled = true,
        socialEnabled = true,
        deepEnabled = false
    } = options;

    // クレンジング前のバイト数を計算（outerHTMLで削除されたDOM要素のサイズ変化を正確に反映）
    const bytesBefore = new Blob([element.outerHTML || '']).size;

    let altRemoved = 0;
    let metadataRemoved = 0;
    let adsRemoved = 0;
    let navRemoved = 0;
    let socialRemoved = 0;
    let deepRemoved = 0;

    // 画像alt属性削除
    if (altEnabled) {
        altRemoved = stripAltAttributes(element);
    }

    // メタデータ削除
    if (metadataEnabled) {
        metadataRemoved = stripMetadataElements(element);
    }

    // 広告関連要素削除
    if (adsEnabled) {
        adsRemoved = stripAdElements(element);
    }

    // ナビゲーション・フッター削除
    if (navEnabled) {
        navRemoved = stripNavElements(element);
    }

    // ソーシャルウィジェット削除
    if (socialEnabled) {
        socialRemoved = stripSocialElements(element);
    }

    // ディープクレンジング
    if (deepEnabled) {
        deepRemoved = stripDeepElements(element);
    }

    // クレンジング後のバイト数を計算（outerHTMLで削除されたDOM要素のサイズ変化を正確に反映）
    const bytesAfter = new Blob([element.outerHTML || '']).size;

    return {
        altRemoved,
        metadataRemoved,
        adsRemoved,
        navRemoved,
        socialRemoved,
        deepRemoved,
        totalRemoved: altRemoved + metadataRemoved + adsRemoved + navRemoved + socialRemoved + deepRemoved,
        bytesBefore,
        bytesAfter
    };
}

/**
 * DOMのAI要約クレンジング対象要素数をカウントする（削除は行わない）
 * @param element - カウント対象のルート要素
 * @param options - クレンジングオプション
 * @returns カウント結果
 */
export function countAISummaryTargets(
    element: Element,
    options: AiSummaryCleanseOptions = {}
): AiSummaryCleanseResult {
    const {
        altEnabled = true,
        metadataEnabled = true,
        adsEnabled = true,
        navEnabled = true,
        socialEnabled = true,
        deepEnabled = false
    } = options;

    let altCount = 0;
    let metadataCount = 0;
    let adsCount = 0;
    let navCount = 0;
    let socialCount = 0;
    let deepCount = 0;
    
    // 画像alt属性カウント
    if (altEnabled) {
        altCount = element.querySelectorAll('img[alt]').length;
    }
    
    // メタデータカウント
    if (metadataEnabled) {
        const metaElements = element.querySelectorAll('meta').length;
        const titleElements = element.querySelectorAll('title').length;
        const linkElements = element.querySelectorAll('link[rel="icon"], link[rel="stylesheet"], link[rel="canonical"]').length;
        metadataCount = metaElements + titleElements + linkElements;
    }
    
    // 広告関連要素カウント
    if (adsEnabled) {
        const counted = new Set<Element>();
        
        for (const pattern of AD_CLASS_PATTERNS) {
            const kw = escapeCssSelector(pattern.toLowerCase());
            
            const classElements = element.querySelectorAll(`[class*="${kw}"]`);
            classElements.forEach(elem => {
                if (!counted.has(elem)) {
                    adsCount++;
                    counted.add(elem);
                }
            });
            
            const idElements = element.querySelectorAll(`[id*="${kw}"]`);
            idElements.forEach(elem => {
                if (!counted.has(elem)) {
                    adsCount++;
                    counted.add(elem);
                }
            });
        }
    }
    
    // ナビゲーション・フッターカウント
    if (navEnabled) {
        const counted = new Set<Element>();
        
        const navElements = element.querySelectorAll('nav');
        navElements.forEach(elem => {
            if (!counted.has(elem)) {
                navCount++;
                counted.add(elem);
            }
        });
        
        const footerElements = element.querySelectorAll('footer');
        footerElements.forEach(elem => {
            if (!counted.has(elem)) {
                navCount++;
                counted.add(elem);
            }
        });
        
        const roleNavElements = element.querySelectorAll('[role="navigation"]');
        roleNavElements.forEach(elem => {
            if (!counted.has(elem)) {
                navCount++;
                counted.add(elem);
            }
        });
        
        for (const pattern of NAV_CLASS_PATTERNS) {
            const kw = escapeCssSelector(pattern.toLowerCase());
            
            const classElements = element.querySelectorAll(`[class*="${kw}"]`);
            classElements.forEach(elem => {
                if (!counted.has(elem)) {
                    navCount++;
                    counted.add(elem);
                }
            });
            
            const idElements = element.querySelectorAll(`[id*="${kw}"]`);
            idElements.forEach(elem => {
                if (!counted.has(elem)) {
                    navCount++;
                    counted.add(elem);
                }
            });
        }
    }
    
    // ソーシャルウィジェットカウント
    if (socialEnabled) {
        const counted = new Set<Element>();
        
        const commentsElements = element.querySelectorAll('#comments, .comments, .comment-section');
        commentsElements.forEach(elem => {
            if (!counted.has(elem)) {
                socialCount++;
                counted.add(elem);
            }
        });
        
        for (const pattern of SOCIAL_CLASS_PATTERNS) {
            const kw = escapeCssSelector(pattern.toLowerCase());
            
            const classElements = element.querySelectorAll(`[class*="${kw}"]`);
            classElements.forEach(elem => {
                if (!counted.has(elem)) {
                    socialCount++;
                    counted.add(elem);
                }
            });
            
            const idElements = element.querySelectorAll(`[id*="${kw}"]`);
            idElements.forEach(elem => {
                if (!counted.has(elem)) {
                    socialCount++;
                    counted.add(elem);
                }
            });
        }
    }

    // ディープクレンジング対象カウント
    if (deepEnabled) {
        const counted = new Set<Element>();

        const directTags = element.querySelectorAll('aside, figure, figcaption, form, dialog, iframe, video, audio, script, style, noscript, button, input, select, details');
        directTags.forEach(elem => {
            if (!counted.has(elem)) { deepCount++; counted.add(elem); }
        });

        for (const role of DEEP_ROLES) {
            element.querySelectorAll(`[role="${role}"]`).forEach(elem => {
                if (!counted.has(elem)) { deepCount++; counted.add(elem); }
            });
        }

        for (const pattern of DEEP_CLASS_PATTERNS) {
            const kw = escapeCssSelector(pattern.toLowerCase());
            element.querySelectorAll(`[class*="${kw}"]`).forEach(elem => {
                if (!counted.has(elem)) { deepCount++; counted.add(elem); }
            });
            element.querySelectorAll(`[id*="${kw}"]`).forEach(elem => {
                if (!counted.has(elem)) { deepCount++; counted.add(elem); }
            });
        }

        element.querySelectorAll('ul, ol').forEach(list => {
            if (counted.has(list)) return;
            const totalText = (list.textContent || '').trim().length;
            if (totalText === 0) return;
            let linkText = 0;
            list.querySelectorAll('a').forEach(a => { linkText += (a.textContent || '').length; });
            if (linkText / totalText > 0.7) { deepCount++; counted.add(list); }
        });

        // 非表示要素のカウント
        element.querySelectorAll('[hidden], [aria-hidden="true"], [style*="display:none"], [style*="display: none"]').forEach(elem => {
            if (!counted.has(elem)) { deepCount++; counted.add(elem); }
        });

        // 空要素のカウント（テキストコンテンツが空のdiv/span/p）
        element.querySelectorAll('div, span, p').forEach(elem => {
            if (!counted.has(elem) && (elem.textContent || '').trim() === '') {
                deepCount++; counted.add(elem);
            }
        });
    }

    return {
        altRemoved: altCount,
        metadataRemoved: metadataCount,
        adsRemoved: adsCount,
        navRemoved: navCount,
        socialRemoved: socialCount,
        deepRemoved: deepCount,
        totalRemoved: altCount + metadataCount + adsCount + navCount + socialCount + deepCount,
        bytesBefore: 0,
        bytesAfter: 0
    };
}