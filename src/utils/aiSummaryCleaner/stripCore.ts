/**
 * AI要約クレンジング — コア_strip関数群
 * 元の11個のクレンジング関数（alt属性〜ディープクレンジング）
 */

import { escapeCssSelector } from '../cssUtils.js';
import { buildClassIdSelectors } from './helpers.js';
import { AD_CLASS_PATTERNS, SOCIAL_CLASS_PATTERNS, NAV_CLASS_PATTERNS, LEGAL_TEXT_PATTERNS, DEEP_CLASS_PATTERNS, DEEP_ROLES } from './patterns.js';

/**
 * 画像alt属性を削除
 * @param element - クレンジング対象のルート要素
 * @returns 削除したalt属性の数
 */
export function stripAltAttributes(element: Element): number {
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
export function stripMetadataElements(element: Element): number {
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
export function stripAdElements(element: Element): number {
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
export function stripNavElements(element: Element): number {
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
 * 法的テキストを含む要素を削除（クラス名に依存しないテキストベース削除）
 * @param element - クレンジング対象のルート要素
 * @returns 削除した要素の数
 */
export function stripLegalTextNodes(element: Element): number {
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
export function stripHighLinkDensityElements(element: Element): number {
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
export function stripSocialElements(element: Element): number {
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
 * JSON-LD構造化データパターンを削除する
 * @param element - クレンジング対象のルート要素
 * @returns 削除したスクリプトの数
 */
export function stripJsonLdScripts(element: Element): number {
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
export function stripLazyLoadElements(element: Element): number {
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
export function stripSkipLinks(element: Element): number {
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
 * 関連記事、人気記事、おすすめ記事等のリストアイテムを削除
 * @param element - クレンジング対象のルート要素
 * @returns 削除した要素の数
 */
export const CARD_PATTERNS = [
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

export function stripCardElements(element: Element): number {
    let removedCount = 0;
    const elementsToRemove: Element[] = [];
    const counted = new Set<Element>();
    
    // 全パターンを結合して1回のクエリーに
    element.querySelectorAll(buildClassIdSelectors(CARD_PATTERNS)).forEach(elem => {
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
export function stripDeepElements(element: Element): number {
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