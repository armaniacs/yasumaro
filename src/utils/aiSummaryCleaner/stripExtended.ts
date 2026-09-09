/**
 * AI要約クレンジング — 拡張_strip関数群
 * セレクター形状のルールは selectorRules.ts の表へ移行済み。
 * ここには非セレクター系（位置・密度・テキスト抽出）および
 * テキスト系 cookie 同意検出の bespoke 関数のみ残る。
 */

import { buildClassIdSelectors, isFixedOrSticky, safeRemoveElement, safeReplaceWithText } from './helpers.js';
import { SELECTOR_RULE_DEFS, isCookieConsentText, stripBySelectors } from './selectorRules.js';

const AFFILIATE_PATTERNS = [
    // Rinker (SWELL bundled) — container-level only
    'yyi-rinker-contents', 'yyi-rinker-box',
    // カエレバ / ヨマレバ
    'kaerebalink-box', 'yomerebalink-box', 'booklink-box',
    // もしもアフィリエイト
    'moshimo-style-single', 'moshimo-style', 'moshimo-affiliate',
    // ポチップ (Pochipp)
    'pochipp-box', 'pochi-contents', 'pochipp-card',
];
const AFFILIATE_SELECTOR = buildClassIdSelectors(AFFILIATE_PATTERNS);

const SPEECH_BUBBLE_META_PATTERNS = [
    'balloon-meta', 'balloon-avatar', 'talk-name',
    'balloon-icon', 'character-name', 'talk-avatar',
    'comment-name', 'speaker-name', 'chara-name',
];
const SPEECH_BUBBLE_META_SELECTOR = buildClassIdSelectors(SPEECH_BUBBLE_META_PATTERNS);

const SPEECH_BUBBLE_TEXT_PATTERNS = [
    'balloon-text', 'talk-comment', 'comment-text',
    'balloon-body', 'talk-body', 'speech-text',
];
const SPEECH_BUBBLE_TEXT_SELECTOR = buildClassIdSelectors(SPEECH_BUBBLE_TEXT_PATTERNS);

/**
 * Shared helper for text-based cookie consent detection.
 * Matching logic lives in selectorRules.isCookieConsentText so the cookie
 * rule and the popup selector row test the same elements.
 */
function collectCookieConsentElements(root: Element, counted: Set<Element>): Element[] {
    const elementsToRemove: Element[] = [];
    const candidates = root.querySelectorAll('p, div, span, small, footer, section');
    candidates.forEach(elem => {
        if (counted.has(elem)) return;
        if (isCookieConsentText(elem)) {
            elementsToRemove.push(elem);
            counted.add(elem);
        }
    });
    return elementsToRemove;
}

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
        if (safeRemoveElement(elem)) {
            removedCount++;
        }
    }

    return removedCount;
}

export function stripCookieConsentElements(element: Element): number {
    let removedCount = 0;
    const counted = new Set<Element>();
    const elementsToRemove = collectCookieConsentElements(element, counted);
    for (const elem of elementsToRemove) {
        if (safeRemoveElement(elem)) removedCount++;
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
        if (safeRemoveElement(elem)) { removedCount++; }
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
        if (safeRemoveElement(elem)) {
            removedCount++;
        }
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
        if (safeRemoveElement(elem)) { removedCount++; }
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
            if (!child) continue;
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
            if (!child) continue;
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
        if (safeRemoveElement(elem)) { removedCount++; }
    }
    return removedCount;
}

/**
 * アフィリエイトプラグイン要素をプレーンテキスト化（A-2）
 * Rinker / カエレバ / もしも / ポチップの商品ボックスから
 * 商品名と価格テキストのみを抽出し、要素全体をテキストノードに差し替える
 * @param element - クレンジング対象のルート要素
 * @returns 処理した要素の数
 */
export function stripAffiliateElements(element: Element): number {
    let processedCount = 0;
    const elementsToProcess: Element[] = [];
    const counted = new Set<Element>();

    element.querySelectorAll(AFFILIATE_SELECTOR).forEach(elem => {
        // Skip elements whose ancestor already matched (process only top-level containers)
        if (counted.has(elem)) return;
        // Check if any ancestor of this element is already in the counted set
        let ancestor = elem.parentElement;
        let hasMatchingAncestor = false;
        while (ancestor && ancestor !== element) {
            if (counted.has(ancestor)) {
                hasMatchingAncestor = true;
                break;
            }
            ancestor = ancestor.parentElement;
        }
        if (!hasMatchingAncestor) {
            elementsToProcess.push(elem);
            counted.add(elem);
        }
    });

    for (const elem of elementsToProcess) {
        // Extract product name and price text, skip other noise
        const textParts: string[] = [];
        const titleEl = elem.querySelector('.yyi-rinker-title, .kaerebalink-name, [class*="title"]');
        const textEl = elem.querySelector('.yyi-rinker-text, [class*="detail"], [class*="text"]');
        const priceEl = elem.querySelector('[class*="price"], [class*="yen"], [class*="cost"]');

        if (titleEl?.textContent?.trim()) textParts.push(titleEl.textContent.trim());
        if (textEl?.textContent?.trim()) textParts.push(textEl.textContent.trim());
        if (priceEl?.textContent?.trim()) textParts.push(priceEl.textContent.trim());

        const extractedText = textParts.join(' | ');

        if (extractedText) {
            if (safeReplaceWithText(elem, extractedText)) { processedCount++; }
        } else {
            // No extractable text found, remove entirely
            if (safeRemoveElement(elem)) { processedCount++; }
        }
    }
    return processedCount;
}

/**
 * 吹き出し（会話風）要素をクレンジング（A-7）
 * キャラ名・アバター部分を削除し、発言テキストのみを保持する
 * @param element - クレンジング対象のルート要素
 * @returns 処理した吹き出しコンテナの数
 */
export function stripSpeechBubbles(element: Element): number {
    let processedCount = 0;

    const CONTAINER_SELECTORS = [
        '.speech-balloon', '.balloon-box', '.talk-balloon',
        '.balloon', '.talk-box', '.chat-bubble',
        '.comment-balloon', '.message-balloon',
    ];

    const containers = element.querySelectorAll(CONTAINER_SELECTORS.join(', '));

    containers.forEach(container => {
        // Remove character names and avatars
        const metaElements = container.querySelectorAll(SPEECH_BUBBLE_META_SELECTOR);
        metaElements.forEach(meta => {
            safeRemoveElement(meta);
        });

        // Keep speech text — extract and replace container with text
        let speechText = '';
        const textElements = container.querySelectorAll(SPEECH_BUBBLE_TEXT_SELECTOR);
        if (textElements.length > 0) {
            const parts: string[] = [];
            textElements.forEach(el => {
                const t = (el.textContent || '').trim();
                if (t) parts.push(t);
            });
            speechText = parts.join(' ');
        }

        if (speechText) {
            if (safeReplaceWithText(container as Element, speechText)) { processedCount++; }
        } else {
            // No speech text matched — fallback: extract all text from the balloon
            const fallbackText = (container.textContent || '').trim();
            if (fallbackText) {
                if (safeReplaceWithText(container as Element, fallbackText)) { processedCount++; }
            } else {
                // Empty balloon, remove entirely
                if (safeRemoveElement(container as Element)) { processedCount++; }
            }
        }
    });

    return processedCount;
}

// ---------------------------------------------------------------------------
// Engine-backed delegates (PBI 06)
// ---------------------------------------------------------------------------
// Each historic strip* name below used to own a ~20-line copy of the same
// shape (fresh Set, querySelectorAll, counted dedupe guard, safeRemoveElement
// loop). The loop now lives once in stripBySelectors; the row owns the
// selectors. These delegates preserve the public names so per-rule tests
// guard the engine without modification.

/** Removes recommend sections via the recommend selector row. */
export function stripRecommendSections(element: Element): number {
    return stripBySelectors(element, SELECTOR_RULE_DEFS.recommend);
}

/** Removes pagination elements via the pagination selector row. */
export function stripPaginationElements(element: Element): number {
    return stripBySelectors(element, SELECTOR_RULE_DEFS.pagination);
}

/** Removes SNS/promo elements via the snsPromo selector row. */
export function stripSnsPromoElements(element: Element): number {
    return stripBySelectors(element, SELECTOR_RULE_DEFS.snsPromo);
}

/** Removes popup/modal elements via the popup selector row. */
export function stripPopupElements(element: Element): number {
    return stripBySelectors(element, SELECTOR_RULE_DEFS.popup);
}

/** Removes platform-specific noise via the platform selector row. */
export function stripPlatformNoise(element: Element): number {
    return stripBySelectors(element, SELECTOR_RULE_DEFS.platform);
}

/** Removes hidden elements via the enhancedHidden selector row. */
export function stripEnhancedHiddenElements(element: Element): number {
    return stripBySelectors(element, SELECTOR_RULE_DEFS.enhancedHidden);
}

/** Removes empty elements via the emptyElem selector row. */
export function stripEmptyElements(element: Element): number {
    return stripBySelectors(element, SELECTOR_RULE_DEFS.emptyElem);
}

/** Removes JP layout patterns via the jpLayout selector row. */
export function stripJPLayoutPatterns(element: Element, customPatterns: string[] = []): number {
    return stripBySelectors(element, SELECTOR_RULE_DEFS.jpLayout, customPatterns);
}

/** Removes JP navigation patterns via the jpNavigation selector row. */
export function stripJPNavigationPatterns(element: Element): number {
    return stripBySelectors(element, SELECTOR_RULE_DEFS.jpNavigation);
}

/** Removes author/meta elements via the author selector row. */
export function stripAuthorMetaElements(element: Element): number {
    return stripBySelectors(element, SELECTOR_RULE_DEFS.author);
}

/** Removes news-media patterns via the newsMedia selector row. */
export function stripNewsMediaPatterns(element: Element): number {
    return stripBySelectors(element, SELECTOR_RULE_DEFS.newsMedia);
}

/** Removes EC-site patterns via the ecSite selector row. */
export function stripEcSitePatterns(element: Element): number {
    return stripBySelectors(element, SELECTOR_RULE_DEFS.ecSite);
}

/** Removes Q&A-site patterns via the qaSite selector row. */
export function stripQaSitePatterns(element: Element): number {
    return stripBySelectors(element, SELECTOR_RULE_DEFS.qaSite);
}

/** Removes video-site patterns via the videoSite selector row. */
export function stripVideoSitePatterns(element: Element): number {
    return stripBySelectors(element, SELECTOR_RULE_DEFS.videoSite);
}
