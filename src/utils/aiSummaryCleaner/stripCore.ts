/**
 * AI要約クレンジング — コア strip 関数群
 *
 * Selector-shaped rules live as rows in selectorRules.ts and run through
 * stripBySelectors. The historic per-rule names below are one-line delegates
 * to their rows, so existing callers and per-rule tests exercise the engine
 * directly. Only non-selector logic (alt attributes, legal text, link
 * density) stays implemented here.
 */

import { safeRemoveElement } from './helpers.js';
import { LEGAL_TEXT_PATTERNS } from './patterns.js';
import { SELECTOR_RULE_DEFS, stripBySelectors } from './selectorRules.js';

// Re-exported from patterns.ts (moved there with the other pattern constants
// so selectorRules.ts can own the card row without an import cycle).
// Existing importers keep working unchanged.
export { CARD_PATTERNS } from './patterns.js';

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
        if (safeRemoveElement(elem)) {
            removedCount++;
        }
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
        if (safeRemoveElement(elem)) {
            removedCount++;
        }
    }
    return removedCount;
}

// ---------------------------------------------------------------------------
// Engine-backed delegates (PBI 06)
// ---------------------------------------------------------------------------
// Each historic strip* name below used to own a ~20-line copy of the same
// shape (fresh Set, querySelectorAll, counted dedupe guard, safeRemoveElement
// loop). The loop now lives once in stripBySelectors; the row owns the
// selectors. These delegates preserve the public names so per-rule tests
// guard the engine without modification.

/** Removes metadata elements via the metadata selector row. */
export function stripMetadataElements(element: Element): number {
    return stripBySelectors(element, SELECTOR_RULE_DEFS.metadata);
}

/** Removes ad elements via the ads selector row. */
export function stripAdElements(element: Element): number {
    return stripBySelectors(element, SELECTOR_RULE_DEFS.ads);
}

/** Removes nav/footer elements via the nav selector row. */
export function stripNavElements(element: Element): number {
    return stripBySelectors(element, SELECTOR_RULE_DEFS.nav);
}

/** Removes comment/social widget elements via the social selector row. */
export function stripSocialElements(element: Element): number {
    return stripBySelectors(element, SELECTOR_RULE_DEFS.social);
}

/** Removes JSON-LD scripts via the jsonLd selector row. */
export function stripJsonLdScripts(element: Element): number {
    return stripBySelectors(element, SELECTOR_RULE_DEFS.jsonLd);
}

/** Removes lazy-load placeholders via the lazyLoad selector row. */
export function stripLazyLoadElements(element: Element): number {
    return stripBySelectors(element, SELECTOR_RULE_DEFS.lazyLoad);
}

/** Removes skip/accessibility links via the skipLink selector row. */
export function stripSkipLinks(element: Element): number {
    return stripBySelectors(element, SELECTOR_RULE_DEFS.skipLink);
}

/** Removes article-card/list items via the card selector row. */
export function stripCardElements(element: Element): number {
    return stripBySelectors(element, SELECTOR_RULE_DEFS.card);
}

/** Removes deep-cleansing targets via the deep selector row. */
export function stripDeepElements(element: Element): number {
    return stripBySelectors(element, SELECTOR_RULE_DEFS.deep);
}
