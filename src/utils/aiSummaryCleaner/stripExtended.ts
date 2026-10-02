/**
 * AI要約クレンジング — 拡張_strip関数群
 * セレクター形状のルールは selectorRules.ts の表へ移行済み。
 * ここには非セレクター系（位置・密度・テキスト抽出）および
 * テキスト系 cookie 同意検出の bespoke 関数のみ残る。
 */

import { buildClassIdSelectors, isFixedOrSticky, isLinkDenseBlock, safeRemoveElement, safeReplaceWithText } from './helpers.js';
import { SELECTOR_RULE_DEFS, isCookieConsentText, removeCollected, stripBySelectors, stripCollected } from './selectorRules.js';

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
 * 固定要素を削除（position:fixed/sticky）
 * @param element - クレンジング対象のルート要素
 * @returns 削除した要素の数
 */
export function stripFixedElements(element: Element): number {
    return stripCollected(element, [
        { css: '[style*="position: fixed"], [style*="position:fixed"]' },
        { css: '[style*="position: sticky"], [style*="position:sticky"]' },
        { css: '[class*="fixed-video"], [class*="sticky-player"]' },
        // Yahoo! News 固定ヘッダー
        {
            css: '[class*="yahoo-news"], [id*="headerWrap"], [class*="Topics"], [class*="IssueTop"]',
            predicate: isFixedOrSticky,
        },
        // Game8 固定メニュー
        {
            css: '[class*="game8"], [class*="headerMenu"], [class*="SideBar"], [id*="SideBar"]',
            predicate: isFixedOrSticky,
        },
    ]);
}

/**
 * Cookie 同意テキストの要素を削除
 * 判定は selectorRules.isCookieConsentText に置き、popup 行と同じ要素を拾う
 * @param element - クレンジング対象のルート要素
 * @returns 削除した要素の数
 */
export function stripCookieConsentElements(element: Element): number {
    return stripCollected(element, [{
        css: 'p, div, span, small, footer, section',
        predicate: isCookieConsentText,
    }]);
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
    const ratio = threshold / 100;
    return stripCollected(element, [{
        css: 'ul, ol, div, nav',
        // 50文字未満は対象外
        predicate: (elem) => isLinkDenseBlock(elem, 50, ratio),
    }]);
}

/**
 * 短文要素の連続を削除
 * @param element - クレンジング対象のルート要素
 * @param shortThreshold - 短文閾値文字数（デフォルト: 30）
 * @param seqCount - 連続数閾値（デフォルト: 5）
 * @returns 削除した要素の数
 */
export function stripShortSequenceElements(element: Element, shortThreshold: number = 30, seqCount: number = 5): number {
    const targets = element.querySelectorAll('p, span, li, div');
    const shortElements: Element[] = [];

    targets.forEach(elem => {
        const text = (elem.textContent || '').trim();
        if (text.length > 0 && text.length <= shortThreshold) {
            shortElements.push(elem);
        }
    });

    const collected: Element[] = [];
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
            collected.push(elem);
        }
    }

    return removeCollected(collected);
}

const SYMBOL_LINE_PATTERN = /^[|\►◀▶«»•·]+$/;

/** 記号のみで構成される行かどうか */
function isSymbolLine(elem: Element): boolean {
    const text = (elem.textContent || '').trim();
    return text.length > 0 && SYMBOL_LINE_PATTERN.test(text);
}

/**
 * 特殊記号行を削除
 * @param element - クレンジング対象のルート要素
 * @returns 削除した要素の数
 */
export function stripSymbolLineElements(element: Element): number {
    return stripCollected(element, [{
        css: 'p, span, div, li',
        predicate: isSymbolLine,
    }]);
}

/** リンク要素と br 以外がすべて空で、リンクを1つ以上含む段落かどうか */
function isLinkOnlyParagraph(p: Element, maxLength: number): boolean {
    const text = (p.textContent || '').trim();
    if (text.length > maxLength) return false;

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

    return hasLinks && hasOnlyLinks && !hasNonLinkText && text.length > 0;
}

/**
 * リンクのみ段落を削除（50文字以下のリンクのみ段落）
 * @param element - クレンジング対象のルート要素
 * @param maxLength - 最大文字数閾値（デフォルト: 50）
 * @returns 削除した要素の数
 */
export function stripLinkOnlyParagraphs(element: Element, maxLength: number = 50): number {
    return stripCollected(element, [{
        css: 'p',
        predicate: (p) => isLinkOnlyParagraph(p, maxLength),
    }]);
}

/** 祖先が既に採用済みなら入れ子のアフィリエイトボックスなので対象外 */
function isTopLevelAffiliateBox(elem: Element, claimed: ReadonlySet<Element>): boolean {
    // cleanse root の上で打ち切らない: claimed は root の直下孫しか含まない
    // ので、それより上の祖先が claimed に入ることはない
    for (let ancestor = elem.parentElement; ancestor !== null; ancestor = ancestor.parentElement) {
        if (claimed.has(ancestor)) {
            return false;
        }
    }
    return true;
}

/** 商品名と価格テキストを要素に差し替える。抽出できない場合は要素ごと削除する */
function extractAffiliateText(elem: Element): boolean {
    const textParts: string[] = [];
    const titleEl = elem.querySelector('.yyi-rinker-title, .kaerebalink-name, [class*="title"]');
    const textEl = elem.querySelector('.yyi-rinker-text, [class*="detail"], [class*="text"]');
    const priceEl = elem.querySelector('[class*="price"], [class*="yen"], [class*="cost"]');

    if (titleEl?.textContent?.trim()) textParts.push(titleEl.textContent.trim());
    if (textEl?.textContent?.trim()) textParts.push(textEl.textContent.trim());
    if (priceEl?.textContent?.trim()) textParts.push(priceEl.textContent.trim());

    const extractedText = textParts.join(' | ');

    if (extractedText) {
        return safeReplaceWithText(elem, extractedText);
    }
    // No extractable text found, remove entirely
    return safeRemoveElement(elem);
}

/**
 * アフィリエイトプラグイン要素をプレーンテキスト化（A-2）
 * Rinker / カエレバ / もしも / ポチップの商品ボックスから
 * 商品名と価格テキストのみを抽出し、要素全体をテキストノードに差し替える
 * @param element - クレンジング対象のルート要素
 * @returns 処理した要素の数
 */
export function stripAffiliateElements(element: Element): number {
    return stripCollected(
        element,
        [{ css: AFFILIATE_SELECTOR, predicate: isTopLevelAffiliateBox }],
        extractAffiliateText,
    );
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
