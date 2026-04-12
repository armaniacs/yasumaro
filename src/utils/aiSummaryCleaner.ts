/**
 * AI要約クリーニング
 * 【機能概要】: AI要約に不要な情報を含む要素を削除する
 * 【設計方針】:
 *   - AI要約（generateSummary）に渡す前に適用
 *   - 画像alt属性、メタデータ、广告、ナビゲーション、ソーシャルウィジェットを削除
 *   - JSON-LD構造化データ、遅延読み込みコンテンツ、スキップリンク等的削除
 *   - 外部ライブラリ不使用（バンドルサイズ抑止）
 * 🟢
 */

import { escapeCssSelector } from './cssUtils.js';
import { logDebug } from './logger.js';

/**
 * パターン配列から [class*="..."], [id*="..."] を結合したCSSセレクター文字列を生成する
 */
function buildClassIdSelectors(patterns: string[]): string {
    return patterns.map(p => {
        const kw = escapeCssSelector(p.toLowerCase());
        return `[class*="${kw}"], [id*="${kw}"]`;
    }).join(', ');
}

/**
 * AI要約クレンジングオプション
 */
export interface AiSummaryCleanseOptions {
    altEnabled?: boolean;           // 画像alt属性削除
    metadataEnabled?: boolean;      // メタデータ削除
    adsEnabled?: boolean;           // 广告関連要素削除
    navEnabled?: boolean;          // ナビゲーション・フッター削除
    socialEnabled?: boolean;       // コメント・ソーシャルウィジェット削除
    deepEnabled?: boolean;         // ディープクレンジング（aside/form/cookie/関連記事等）
    jsonLdEnabled?: boolean;       // JSON-LD構造化データ削除
    lazyLoadEnabled?: boolean;     // 遅延読み込みコンテンツ削除
    skipLinkEnabled?: boolean;     // スキップリンク削除
    cardEnabled?: boolean;         // 記事カード・リストアイテム削除
    linkDensityEnabled?: boolean;  // リンク密度の高いブロック削除（デフォルト: false）
    // NEW: 6つの新しいオプション
    fixedEnabled?: boolean;        // 固定要素削除（デフォルト: false）
    recommendEnabled?: boolean;   // 推荐セクション削除（デフォルト: true）
    paginationEnabled?: boolean;  // ページネーション削除（デフォルト: false）
    snsPromoEnabled?: boolean;    // SNSプロモ削除（デフォルト: false）
    popupEnabled?: boolean;       // ポップアップ削除（デフォルト: true）
    platformEnabled?: boolean;    // プラットフォーム噪声削除（デフォルト: false）
    // NEW: 9つの追加オプション
    textDensityEnabled?: boolean;      // テキスト密度フィルタリング（デフォルト: false）
    shortSeqEnabled?: boolean;        // 短文要素の連続削除（デフォルト: false）
    symbolLineEnabled?: boolean;      // 特殊記号行の削除（デフォルト: false）
    linkParaEnabled?: boolean;        // リンクのみ段落の削除（デフォルト: false）
    linkParaThreshold?: number;       // リンクのみ段落閾値（デフォルト: 50）
    enhancedHiddenEnabled?: boolean;  // 非表示要素強化削除（デフォルト: true）
    emptyElemEnabled?: boolean;       // 空要素の削除（デフォルト: true）
    jpLayoutEnabled?: boolean;        // JP BEM系レイアウトパターン（デフォルト: false）
    jpNavigationEnabled?: boolean;     // JP ナビ頻出語（デフォルト: false）
    authorEnabled?: boolean;         // 執筆者・メタ情報（デフォルト: false）
    // Threshold settings
    linkRatioThreshold?: number;      // リンク密度閾値（デフォルト: 70）
    shortTextThreshold?: number;       // 短文閾値文字数（デフォルト: 30）
    shortSeqCount?: number;           // 短文連続数閾値（デフォルト: 5）
    // Custom patterns
    customPatterns?: string[];        // カスタムパターン列表
}

/**
 * AI要約クレンジング結果
 */
export interface AiSummaryCleanseResult {
    altRemoved: number;             // 画像alt属性削除数
    metadataRemoved: number;        // メタデータ削除数
    adsRemoved: number;             // 广告関連要素削除数
    navRemoved: number;             // ナビゲーション・フッター削除数
    socialRemoved: number;          // ソーシャルウィジェット削除数
    deepRemoved: number;            // ディープクレンジング削除数
    jsonLdRemoved?: number;         // JSON-LD構造化データ削除数
    lazyLoadRemoved?: number;       // 遅延読み込みコンテンツ削除数
    skipLinkRemoved?: number;       // スキップリンク削除数
    cardRemoved?: number;          // 記事カード・リストアイテム削除数
    linkDensityRemoved?: number;    // リンク密度ブロック削除数
    // NEW: 6つの新しいオプション
    fixedRemoved?: number;         // 固定要素削除数
    recommendRemoved?: number;     // 推荐セクション削除数
    paginationRemoved?: number;     // ページネーション削除数
    snsPromoRemoved?: number;       // SNSプロモ削除数
    popupRemoved?: number;          // ポップアップ削除数
    platformRemoved?: number;       // プラットフォーム噪声削除数
    // NEW: 9つの追加オプション
    textDensityRemoved?: number;        // テキスト密度削除数
    shortSeqRemoved?: number;            // 短文連続削除数
    symbolLineRemoved?: number;          // 特殊記号行削除数
    linkParaRemoved?: number;            // リンクのみ段落削除数
    linkParaThreshold?: number;          // リンクのみ段落閾値
    enhancedHiddenRemoved?: number;     // 非表示要素強化削除数
    emptyElemRemoved?: number;           // 空要素削除数
    jpLayoutRemoved?: number;            // JP BEMレイアウト削除数
    jpNavigationRemoved?: number;       // JP ナビ削除数
    authorRemoved?: number;              // 執筆者・メタ削除数
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
    'bottombar',
    // 法的・著作権テキスト（deepEnabled不要でデフォルト削除）
    'copyright',
    'legal',
    'disclaimer',
    'terms',
    'license',
    'site-info',
    'common-footer',
    // 汎用フッターパターン
    'l-footer',
    'entry-footer',
    'post-footer',
    'article-footer',
    // 日本語サイト
    'corp-info',
    'site-footer',
    'global-footer',
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
    
    // 広告データ属性で検索
    const adDataAttrElements = element.querySelectorAll(
        '[data-ad], [data-ad-slot], [data-ad-client], [data-dfp], [data-gpt-ad], ' +
        'ins.adsbygoogle, [class*="sponsored-content"], [class*="native-ad"]'
    );
    adDataAttrElements.forEach(elem => {
        if (!counted.has(elem)) {
            elementsToRemove.push(elem);
            counted.add(elem);
        }
    });
    
    // クラス名パターンで検索（全パターンを結合して1回のクエリーに）
    element.querySelectorAll(buildClassIdSelectors(AD_CLASS_PATTERNS)).forEach(elem => {
        if (!counted.has(elem)) {
            elementsToRemove.push(elem);
            counted.add(elem);
        }
    });

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
    
    // role="contentinfo" (フッターのARIA role — Qiita等CSS-in-JS対策)
    const contentInfoElements = element.querySelectorAll('[role="contentinfo"]');
    contentInfoElements.forEach(elem => {
        if (!counted.has(elem)) {
            elementsToRemove.push(elem);
            counted.add(elem);
        }
    });

    // SPA属性パターン (data-testid / aria-label)
    const spaNavElements = element.querySelectorAll(
        '[data-testid*="footer"], [data-testid*="nav"], ' +
        '[aria-label*="advertisement"], [aria-label*="navigation"], [aria-label*="footer"]'
    );
    spaNavElements.forEach(elem => {
        if (!counted.has(elem)) {
            elementsToRemove.push(elem);
            counted.add(elem);
        }
    });
    
    // クラス名パターンで検索（全パターンを結合して1回のクエリーに）
    element.querySelectorAll(buildClassIdSelectors(NAV_CLASS_PATTERNS)).forEach(elem => {
        if (!counted.has(elem)) {
            elementsToRemove.push(elem);
            counted.add(elem);
        }
    });

    // 削除実行
    for (const elem of elementsToRemove) {
        elem.remove();
        removedCount++;
    }

    return removedCount;
}

/**
 * 法的テキストパターン（著作権・免責事項等）
 * テキストコンテンツベースで要素を削除する（クラス名に依存しない）
 */
const LEGAL_TEXT_PATTERNS: RegExp[] = [
    /©\s*\d{4}/,
    /copyright\s+\d{4}/i,
    /all rights reserved/i,
    /無断転載禁止/,
    /著作権.*株式会社/,
    /著作権.*有限会社/,
];

/**
 * 法的テキストを含む要素を削除（クラス名に依存しないテキストベース削除）
 * @param element - クレンジング対象のルート要素
 * @returns 削除した要素の数
 */
function stripLegalTextNodes(element: Element): number {
    let removedCount = 0;
    const elementsToRemove: Element[] = [];
    const counted = new Set<Element>();

    // p, div, span, small, footer, section を対象（500文字以下のみ）
    const candidates = element.querySelectorAll('p, div, span, small, footer, section');
    candidates.forEach(elem => {
        if (counted.has(elem)) return;
        const text = (elem.textContent || '').trim();
        // 500文字超は本文の可能性が高いためスキップ
        if (text.length > 500) return;
        // 子に p/article/section が複数あればコンテナなのでスキップ
        const contentChildren = elem.querySelectorAll('p, article, section');
        if (contentChildren.length >= 2) return;
        // テキストパターンマッチ
        for (const pattern of LEGAL_TEXT_PATTERNS) {
            if (pattern.test(text)) {
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
 * リンク密度の高いブロックを削除（関連記事リスト・もっと見るリンク群等）
 * @param element - クレンジング対象のルート要素
 * @returns 削除した要素の数
 */
function stripHighLinkDensityElements(element: Element): number {
    let removedCount = 0;
    const elementsToRemove: Element[] = [];
    const counted = new Set<Element>();

    // ul, ol, div, section を対象
    const candidates = element.querySelectorAll('ul, ol, div, section');
    candidates.forEach(elem => {
        if (counted.has(elem)) return;
        const totalText = (elem.textContent || '').length;
        // 100文字未満は除外（空・短すぎる要素）
        if (totalText < 100) return;
        // 直接の親が p/article/section なら本文内コンテンツとして保護
        const parent = elem.parentElement;
        if (parent && ['p', 'article', 'section'].includes(parent.tagName.toLowerCase())) return;
        // リンク密度計算
        let linkText = 0;
        elem.querySelectorAll('a').forEach(a => {
            linkText += (a.textContent || '').length;
        });
        if (totalText > 0 && linkText / totalText >= 0.7) {
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
    
    // クラス名パターンで検索（全パターンを結合して1回のクエリーに）
    element.querySelectorAll(buildClassIdSelectors(SOCIAL_CLASS_PATTERNS)).forEach(elem => {
        if (!counted.has(elem)) {
            elementsToRemove.push(elem);
            counted.add(elem);
        }
    });


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
 * JSON-LD構造化データパターンを削除する
 * @param element - クレンジング対象のルート要素
 * @returns 削除したスクリプトの数
 */
function stripJsonLdScripts(element: Element): number {
    let removedCount = 0;
    const scripts = element.querySelectorAll('script[type="application/ld+json"]');
    
    scripts.forEach(script => {
        script.remove();
        removedCount++;
    });
    
    return removedCount;
}

/**
 * 遅延読み込みコンテンツパターンを削除
 * loading="lazy" や data-src を持つ画像、iframe 等を削除
 * @param element - クレンジング対象のルート要素
 * @returns 削除した要素の数
 */
function stripLazyLoadElements(element: Element): number {
    let removedCount = 0;
    const elementsToRemove: Element[] = [];
    const counted = new Set<Element>();
    
    // loading="lazy" を持つ要素
    const lazyElements = element.querySelectorAll('[loading="lazy"]');
    lazyElements.forEach(elem => {
        if (!counted.has(elem)) {
            elementsToRemove.push(elem);
            counted.add(elem);
        }
    });
    
    // data-src を持つ画像/iframe（遅延読み込みの実装）
    const dataSrcElements = element.querySelectorAll('img[data-src], iframe[data-src], video[data-src]');
    dataSrcElements.forEach(elem => {
        if (!counted.has(elem)) {
            elementsToRemove.push(elem);
            counted.add(elem);
        }
    });
    
    // class に lazy, skeleton, placeholder を含む要素（全パターンを結合して1回のクエリーに）
    const lazyClassSelectors = ['lazy', 'skeleton', 'placeholder', 'loading']
        .map(p => `[class*="${escapeCssSelector(p)}"]`).join(', ');
    element.querySelectorAll(lazyClassSelectors).forEach(elem => {
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
 * スキップリンク・アクセシビリティリンクを削除
 * @param element - クレンジング対象のルート要素
 * @returns 削除した要素の数
 */
function stripSkipLinks(element: Element): number {
    let removedCount = 0;
    const elementsToRemove: Element[] = [];
    const counted = new Set<Element>();
    
    // href="#..." や href="javascript:..." のリンク
    const skipLinks = element.querySelectorAll('a[href^="#"], a[href^="javascript:"]');
    skipLinks.forEach(elem => {
        if (!counted.has(elem)) {
            elementsToRemove.push(elem);
            counted.add(elem);
        }
    });
    
    // role="button" のリンク（CTAボタン等）
    const roleButtonLinks = element.querySelectorAll('a[role="button"]');
    roleButtonLinks.forEach(elem => {
        if (!counted.has(elem)) {
            elementsToRemove.push(elem);
            counted.add(elem);
        }
    });
    
    // class に skip, sr-only, visually-hidden を含む要素（全パターンを結合して1回のクエリーに）
    const srClassSelectors = ['skip', 'sr-only', 'visually-hidden', 'screen-reader']
        .map(p => `[class*="${escapeCssSelector(p)}"]`).join(', ');
    element.querySelectorAll(srClassSelectors).forEach(elem => {
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
 * 記事カード・リストアイテムを削除
 * 関連記事、 популярные статьи、おすすめ記事等のリストアイテムを削除
 * @param element - クレンジング対象のルート要素
 * @returns 削除した要素の数
 */
function stripCardElements(element: Element): number {
    let removedCount = 0;
    const elementsToRemove: Element[] = [];
    const counted = new Set<Element>();
    
    // カード・リストアイテムのパターン
    const cardPatterns = [
        'card', 'article-card', 'post-card', 'entry-card',
        'item-card', 'product-card', 'recipe-card',
        'list-item', 'entry-item', 'post-item',
        'ranking-item', 'popular-item', 'trending-item',
        'recommend-item', 'pickup-item', 'feature-item',
        'related-item', 'sns-post', 'timeline-item',
        // 日本語
        'kiji', 'article-list__item', 'post-list__item',
        'recommend-list', 'pickup-list', 'ranking-list'
    ];
    
    // 全パターンを結合して1回のクエリーに
    element.querySelectorAll(buildClassIdSelectors(cardPatterns)).forEach(elem => {
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

    // クラス/IDパターンで削除（全パターンを結合して1回のクエリーに）
    element.querySelectorAll(buildClassIdSelectors(DEEP_CLASS_PATTERNS)).forEach(elem => {
        if (!counted.has(elem)) {
            elementsToRemove.push(elem);
            counted.add(elem);
        }
    });

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
 * 固定要素を削除（position:fixed/sticky）
 * @param element - クレンジング対象のルート要素
 * @returns 削除した要素の数
 */
function stripFixedElements(element: Element): number {
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
 * 要素がposition: fixed/stickyかを判定
 */
function isFixedOrSticky(elem: Element): boolean {
    const style = elem.getAttribute('style') || '';
    return style.includes('position: fixed') || style.includes('position:fixed') ||
           style.includes('position: sticky') || style.includes('position:sticky');
}

/**
 * 推荐セクションを削除
 * @param element - クレンジング対象のルート要素
 * @returns 削除した要素の数
 */
function stripRecommendSections(element: Element): number {
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
        // 聆
        'contents--contents-recommend', 'pickup-content',
        'recommend -list'
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
function stripPaginationElements(element: Element): number {
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
function stripSnsPromoElements(element: Element): number {
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
 * 要素が広告かどうかを判定
 * 「 ad 」は単語境界レベルでマッチし、header/loaded 等の誤マッチを防ぐ
 */
function isLikelyAd(elem: Element): boolean {
    const className = (elem.className || '').toLowerCase();
    const id = (elem.id || '').toLowerCase();
    const text = (elem.textContent || '').toLowerCase();
    // \bはハイフンを認識しないため、CSSクラス向けに (^|[-_\s])ad([-_\s]|$) を使用
    const AD_WORD_RE = /(^|[-_\s])ad([-_\s]|$)/;
    return AD_WORD_RE.test(className) || AD_WORD_RE.test(id) ||
           text.includes('sponsored') || text.includes('promoted') ||
           text.includes('Advertise');
}

/**
 * ポップアップ/モーダル/通知-estを削除
 * @param element - クレンジング対象のルート要素
 * @returns 削除した要素の数
 */
function stripPopupElements(element: Element): number {
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
 * 要素がポップアップかどうかを判定
 */
function isLikelyPopup(elem: Element): boolean {
    const className = (elem.className || '').toLowerCase();
    const id = (elem.id || '').toLowerCase();
    const style = elem.getAttribute('style') || '';
    return className.includes('popup') || className.includes('modal') ||
           className.includes('overlay') || className.includes('cookie') ||
           className.includes('consent') || className.includes('banner') ||
           id.includes('popup') || id.includes('modal') ||
           (style.includes('position: fixed') && className.length < 50);
}

/**
 * プラットフォーム固有の噪声を削除
 * @param element - クレンジング対象のルート要素
 * @returns 削除した要素の数
 */
function stripPlatformNoise(element: Element): number {
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

/**
 * 要素がプラットフォームノイズかどうかを判定
 * 「 ad 」は単語境界レベルでマッチし、header/loaded 等の誤マッチを防ぐ
 */
function isPlatformNoise(elem: Element): boolean {
    const className = (elem.className || '').toLowerCase();
    const id = (elem.id || '').toLowerCase();
    // \bはハイフンを認識しないため、CSSクラス向けに (^|[-_\s])ad([-_\s]|$) を使用
    const AD_WORD_RE = /(^|[-_\s])ad([-_\s]|$)/;
    return AD_WORD_RE.test(className) || AD_WORD_RE.test(id) ||
           className.includes('comment') && className.includes('youtube') ||
           id.includes('comment') || id.includes('related');
}

// ============================================================================
// 9つの新しいクレンジング関数
// ============================================================================

/**
 * テキスト密度が高い要素を削除（リンク文字が70%以上の要素）
 * @param element - クレンジング対象のルート要素
 * @param threshold - リンク密度閾値（デフォルト: 70%）
 * @returns 削除した要素の数
 */
function stripTextDensityElements(element: Element, threshold: number = 70): number {
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
function stripShortSequenceElements(element: Element, shortThreshold: number = 30, seqCount: number = 5): number {
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
function stripSymbolLineElements(element: Element): number {
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
function stripLinkOnlyParagraphs(element: Element, maxLength: number = 50): number {
    let removedCount = 0;
    const elementsToRemove: Element[] = [];
    const counted = new Set<Element>();

    const paragraphs = element.querySelectorAll('p');
    paragraphs.forEach(p => {
        if (counted.has(p)) return;
        const text = (p.textContent || '').trim();
        if (text.length > maxLength) return;

        const children = p.children;
        let hasOnlyLinks = true;
        let hasNonLinkText = false;

        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            if (child.tagName.toLowerCase() === 'a') {
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

        if (hasOnlyLinks && !hasNonLinkText && text.length > 0) {
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
function stripEnhancedHiddenElements(element: Element): number {
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
function stripEmptyElements(element: Element): number {
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
function stripJPLayoutPatterns(element: Element, customPatterns: string[] = []): number {
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
function stripJPNavigationPatterns(element: Element): number {
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
function stripAuthorMetaElements(element: Element): number {
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
        deepEnabled = false,
        jsonLdEnabled = false,
        lazyLoadEnabled = false,
        skipLinkEnabled = false,
        cardEnabled = false,
        linkDensityEnabled = false,
        // NEW: 6つの新しいオプション
        fixedEnabled = false,
        recommendEnabled = true,
        paginationEnabled = false,
        snsPromoEnabled = false,
        popupEnabled = true,
        platformEnabled = false,
        // NEW: 9つの追加オプション
        textDensityEnabled = false,
        shortSeqEnabled = false,
        symbolLineEnabled = false,
        linkParaEnabled = false,
        enhancedHiddenEnabled = false,
        emptyElemEnabled = false,
        jpLayoutEnabled = false,
        jpNavigationEnabled = false,
        authorEnabled = false,
        // Threshold settings
        linkRatioThreshold = 70,
        shortTextThreshold = 30,
        shortSeqCount = 5,
        linkParaThreshold = 50,
        // Custom patterns
        customPatterns = [],
    } = options;

    const bytesBefore = new Blob([element.outerHTML || '']).size;

    let altRemoved = 0;
    let metadataRemoved = 0;
    let adsRemoved = 0;
    let navRemoved = 0;
    let socialRemoved = 0;
    let deepRemoved = 0;
    let jsonLdRemoved = 0;
    let lazyLoadRemoved = 0;
    let skipLinkRemoved = 0;
    let cardRemoved = 0;
    let linkDensityRemoved = 0;
    // NEW: 6つの新しいオプション
    let fixedRemoved = 0;
    let recommendRemoved = 0;
    let paginationRemoved = 0;
    let snsPromoRemoved = 0;
    let popupRemoved = 0;
    let platformRemoved = 0;
    // NEW: 9つの追加オプション
    let textDensityRemoved = 0;
    let shortSeqRemoved = 0;
    let symbolLineRemoved = 0;
    let linkParaRemoved = 0;
    let enhancedHiddenRemoved = 0;
    let emptyElemRemoved = 0;
    let jpLayoutRemoved = 0;
    let jpNavigationRemoved = 0;
    let authorRemoved = 0;

    if (altEnabled) {
        altRemoved = stripAltAttributes(element);
    }

    if (metadataEnabled) {
        metadataRemoved = stripMetadataElements(element);
    }

    if (adsEnabled) {
        adsRemoved = stripAdElements(element);
    }

    if (navEnabled) {
        navRemoved = stripNavElements(element);
        navRemoved += stripLegalTextNodes(element);
    }

    if (socialEnabled) {
        socialRemoved = stripSocialElements(element);
    }

    if (deepEnabled) {
        deepRemoved = stripDeepElements(element);
    }

    if (jsonLdEnabled) {
        jsonLdRemoved = stripJsonLdScripts(element);
    }

    if (lazyLoadEnabled) {
        lazyLoadRemoved = stripLazyLoadElements(element);
    }

    if (skipLinkEnabled) {
        skipLinkRemoved = stripSkipLinks(element);
    }

    if (cardEnabled) {
        cardRemoved = stripCardElements(element);
    }

    if (linkDensityEnabled) {
        linkDensityRemoved = stripHighLinkDensityElements(element);
    }

    // NEW: 6つの新しいクレンジングオプション
    if (fixedEnabled) {
        fixedRemoved = stripFixedElements(element);
    }

    if (recommendEnabled) {
        recommendRemoved = stripRecommendSections(element);
    }

    if (paginationEnabled) {
        paginationRemoved = stripPaginationElements(element);
    }

    if (snsPromoEnabled) {
        snsPromoRemoved = stripSnsPromoElements(element);
    }

    if (popupEnabled) {
        popupRemoved = stripPopupElements(element);
    }

    if (platformEnabled) {
        platformRemoved = stripPlatformNoise(element);
    }

    // NEW: 9つの追加クレンジングオプション
    if (textDensityEnabled) {
        textDensityRemoved = stripTextDensityElements(element, linkRatioThreshold);
    }

    if (shortSeqEnabled) {
        shortSeqRemoved = stripShortSequenceElements(element, shortTextThreshold, shortSeqCount);
    }

    if (symbolLineEnabled) {
        symbolLineRemoved = stripSymbolLineElements(element);
    }

    if (linkParaEnabled) {
        linkParaRemoved = stripLinkOnlyParagraphs(element, linkParaThreshold);
    }

    if (enhancedHiddenEnabled) {
        enhancedHiddenRemoved = stripEnhancedHiddenElements(element);
    }

    if (emptyElemEnabled) {
        emptyElemRemoved = stripEmptyElements(element);
    }

    if (jpLayoutEnabled) {
        jpLayoutRemoved = stripJPLayoutPatterns(element, customPatterns);
    }

    if (jpNavigationEnabled) {
        jpNavigationRemoved = stripJPNavigationPatterns(element);
    }

    if (authorEnabled) {
        authorRemoved = stripAuthorMetaElements(element);
    }

    const bytesAfter = new Blob([element.outerHTML || '']).size;

    const total = altRemoved + metadataRemoved + adsRemoved + navRemoved +
        socialRemoved + deepRemoved + jsonLdRemoved + lazyLoadRemoved +
        skipLinkRemoved + cardRemoved + linkDensityRemoved +
        fixedRemoved + recommendRemoved + paginationRemoved +
        snsPromoRemoved + popupRemoved + platformRemoved +
        textDensityRemoved + shortSeqRemoved + symbolLineRemoved +
        linkParaRemoved + enhancedHiddenRemoved + emptyElemRemoved +
        jpLayoutRemoved + jpNavigationRemoved + authorRemoved;

    logDebug('AI Summary Cleansing executed', {
        totalRemoved: total,
        bytesBefore,
        bytesAfter,
        compressionRatio: bytesBefore > 0
            ? ((bytesBefore - bytesAfter) / bytesBefore * 100).toFixed(1) + '%'
            : '0%',
        breakdown: {
            alt: altRemoved,
            metadata: metadataRemoved,
            ads: adsRemoved,
            nav: navRemoved,
            social: socialRemoved,
            deep: deepRemoved,
            jsonLd: jsonLdRemoved,
            lazyLoad: lazyLoadRemoved,
            skipLink: skipLinkRemoved,
            card: cardRemoved,
            linkDensity: linkDensityRemoved,
            // NEW: 6 options
            fixed: fixedRemoved,
            recommend: recommendRemoved,
            pagination: paginationRemoved,
            snsPromo: snsPromoRemoved,
            popup: popupRemoved,
            platform: platformRemoved,
            // NEW: 9 options
            textDensity: textDensityRemoved,
            shortSeq: shortSeqRemoved,
            symbolLine: symbolLineRemoved,
            linkPara: linkParaRemoved,
            enhancedHidden: enhancedHiddenRemoved,
            emptyElem: emptyElemRemoved,
            jpLayout: jpLayoutRemoved,
            jpNavigation: jpNavigationRemoved,
            author: authorRemoved,
        }
    }, 'aiSummaryCleaner');

    return {
        altRemoved,
        metadataRemoved,
        adsRemoved,
        navRemoved,
        socialRemoved,
        deepRemoved,
        jsonLdRemoved,
        lazyLoadRemoved,
        skipLinkRemoved,
        cardRemoved,
        linkDensityRemoved,
        // NEW: 6 options
        fixedRemoved,
        recommendRemoved,
        paginationRemoved,
        snsPromoRemoved,
        popupRemoved,
        platformRemoved,
        // NEW: 9 options
        textDensityRemoved,
        shortSeqRemoved,
        symbolLineRemoved,
        linkParaRemoved,
        enhancedHiddenRemoved,
        emptyElemRemoved,
        jpLayoutRemoved,
        jpNavigationRemoved,
        authorRemoved,
        totalRemoved: total,
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
        deepEnabled = false,
        jsonLdEnabled = false,
        lazyLoadEnabled = false,
        skipLinkEnabled = false,
        cardEnabled = false,
        linkDensityEnabled = false,
    } = options;

    let altCount = 0;
    let metadataCount = 0;
    let adsCount = 0;
    let navCount = 0;
    let socialCount = 0;
    let deepCount = 0;
    let jsonLdCount = 0;
    let lazyLoadCount = 0;
    let skipLinkCount = 0;
    let cardCount = 0;
    let linkDensityCount = 0;
    
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
        
        const contentInfoElements = element.querySelectorAll('[role="contentinfo"]');
        contentInfoElements.forEach(elem => {
            if (!counted.has(elem)) {
                navCount++;
                counted.add(elem);
            }
        });

        element.querySelectorAll(
            '[data-testid*="footer"], [data-testid*="nav"], ' +
            '[aria-label*="advertisement"], [aria-label*="navigation"], [aria-label*="footer"]'
        ).forEach(elem => {
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

        // 空要素のカount（テキストコンテンツが空のdiv/span/p）
        element.querySelectorAll('div, span, p').forEach(elem => {
            if (!counted.has(elem) && (elem.textContent || '').trim() === '') {
                deepCount++; counted.add(elem);
            }
        });
    }

    if (jsonLdEnabled) {
        jsonLdCount = element.querySelectorAll('script[type="application/ld+json"]').length;
    }

    if (lazyLoadEnabled) {
        const counted = new Set<Element>();
        
        element.querySelectorAll('[loading="lazy"]').forEach(elem => {
            if (!counted.has(elem)) { lazyLoadCount++; counted.add(elem); }
        });
        element.querySelectorAll('img[data-src], iframe[data-src], video[data-src]').forEach(elem => {
            if (!counted.has(elem)) { lazyLoadCount++; counted.add(elem); }
        });
        const lazyPatterns = ['lazy', 'skeleton', 'placeholder', 'loading'];
        for (const pattern of lazyPatterns) {
            const kw = escapeCssSelector(pattern);
            element.querySelectorAll(`[class*="${kw}"]`).forEach(elem => {
                if (!counted.has(elem)) { lazyLoadCount++; counted.add(elem); }
            });
        }
    }

    if (skipLinkEnabled) {
        const counted = new Set<Element>();
        
        element.querySelectorAll('a[href^="#"], a[href^="javascript:"]').forEach(elem => {
            if (!counted.has(elem)) { skipLinkCount++; counted.add(elem); }
        });
        element.querySelectorAll('a[role="button"]').forEach(elem => {
            if (!counted.has(elem)) { skipLinkCount++; counted.add(elem); }
        });
        const srPatterns = ['skip', 'sr-only', 'visually-hidden', 'screen-reader'];
        for (const pattern of srPatterns) {
            const kw = escapeCssSelector(pattern);
            element.querySelectorAll(`[class*="${kw}"]`).forEach(elem => {
                if (!counted.has(elem)) { skipLinkCount++; counted.add(elem); }
            });
        }
    }

    if (cardEnabled) {
        const counted = new Set<Element>();
        
        const cardPatterns = [
            'card', 'article-card', 'post-card', 'entry-card',
            'item-card', 'product-card', 'recipe-card',
            'list-item', 'entry-item', 'post-item',
            'ranking-item', 'popular-item', 'trending-item',
            'recommend-item', 'pickup-item', 'feature-item',
            'related-item', 'sns-post', 'timeline-item',
            'kiji', 'article-list__item', 'post-list__item',
            'recommend-list', 'pickup-list', 'ranking-list'
        ];
        for (const pattern of cardPatterns) {
            const kw = escapeCssSelector(pattern.toLowerCase());
            element.querySelectorAll(`[class*="${kw}"]`).forEach(elem => {
                if (!counted.has(elem)) { cardCount++; counted.add(elem); }
            });
            element.querySelectorAll(`[id*="${kw}"]`).forEach(elem => {
                if (!counted.has(elem)) { cardCount++; counted.add(elem); }
            });
        }
    }

    if (linkDensityEnabled) {
        const counted = new Set<Element>();
        element.querySelectorAll('ul, ol, div, section').forEach(elem => {
            if (counted.has(elem)) return;
            const totalText = (elem.textContent || '').trim().length;
            if (totalText < 100) return;
            const parent = elem.parentElement;
            if (parent && ['p', 'article', 'section'].includes(parent.tagName.toLowerCase())) return;
            let linkText = 0;
            elem.querySelectorAll('a').forEach(a => { linkText += (a.textContent || '').trim().length; });
            if (totalText > 0 && linkText / totalText >= 0.7) {
                linkDensityCount++;
                counted.add(elem);
            }
        });
    }

    const total = altCount + metadataCount + adsCount + navCount + socialCount +
        deepCount + jsonLdCount + lazyLoadCount + skipLinkCount + cardCount + linkDensityCount;

    return {
        altRemoved: altCount,
        metadataRemoved: metadataCount,
        adsRemoved: adsCount,
        navRemoved: navCount,
        socialRemoved: socialCount,
        deepRemoved: deepCount,
        jsonLdRemoved: jsonLdCount,
        lazyLoadRemoved: lazyLoadCount,
        skipLinkRemoved: skipLinkCount,
        cardRemoved: cardCount,
        linkDensityRemoved: linkDensityCount,
        totalRemoved: total,
        bytesBefore: 0,
        bytesAfter: 0
    };
}