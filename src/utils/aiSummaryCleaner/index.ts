/**
 * AI要約クリーニング — メインエントリーポイント
 * 各_strip関数を統合し、オプションに基づいてクレンジングを実行する
 *
 * 【リファクタリング履歴】: 単一ファイル（2103行）からモジュール分割へ実装
 * 新しいモジュール構成:
 * - types.ts          - 型定義（AiSummaryCleanseOptions, AiSummaryCleanseResult）
 * - patterns.ts       - パターン定数（AD_CLASS_PATTERNS等）
 * - helpers.ts        - ヘルパー関数（buildClassIdSelectors等）
 * - stripCore.ts      - コア11個の_strip関数
 * - stripExtended.ts  - 拡張15個の_strip関数
 * - countTargets.ts   - カウント専用関数
 * - index.ts          - オーケストレーター（このファイル）+ 再エクスポート
 */

import { logDebug } from '../logger.js';
import type { AiSummaryCleanseOptions, AiSummaryCleanseResult } from './types.js';
import { markBodyElements, unmarkBodyElements } from './bodyProtection.js';

// コア_strip関数
import {
    stripAltAttributes,
    stripMetadataElements,
    stripAdElements,
    stripNavElements,
    stripLegalTextNodes,
    stripHighLinkDensityElements,
    stripSocialElements,
    stripJsonLdScripts,
    stripLazyLoadElements,
    stripSkipLinks,
    stripCardElements,
    stripDeepElements,
} from './stripCore.js';

// 拡張_strip関数
import {
    stripFixedElements,
    stripRecommendSections,
    stripPaginationElements,
    stripSnsPromoElements,
    stripPopupElements,
    stripPlatformNoise,
    stripTextDensityElements,
    stripShortSequenceElements,
    stripSymbolLineElements,
    stripLinkOnlyParagraphs,
    stripEnhancedHiddenElements,
    stripEmptyElements,
    stripJPLayoutPatterns,
    stripJPNavigationPatterns,
    stripAuthorMetaElements,
} from './stripExtended.js';

// 型とパターンを再エクスポート
export type { AiSummaryCleanseOptions, AiSummaryCleanseResult } from './types.js';
export { countAISummaryTargets } from './countTargets.js';
export { AD_CLASS_PATTERNS, SOCIAL_CLASS_PATTERNS, NAV_CLASS_PATTERNS, LEGAL_TEXT_PATTERNS, DEEP_CLASS_PATTERNS, DEEP_ROLES } from './patterns.js';
export { buildClassIdSelectors, isFixedOrSticky, isLikelyAd, isLikelyPopup, isPlatformNoise, safeRemoveElement } from './helpers.js';
export { markBodyElements, unmarkBodyElements, isBodyProtected } from './bodyProtection.js';

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
        // NEW: 6 つの新しいオプション
        fixedEnabled = false,
        recommendEnabled = true,
        paginationEnabled = false,
        snsPromoEnabled = false,
        popupEnabled = true,
        platformEnabled = false,
        // NEW: 9 つの追加オプション
        textDensityEnabled = false,
        shortSeqEnabled = false,
        symbolLineEnabled = false,
        linkParaEnabled = false,
        enhancedHiddenEnabled = false,
        emptyElemEnabled = false,
        jpLayoutEnabled = false,
        jpNavigationEnabled = false,
        authorEnabled = false,
        // Body protection options
        bodyProtectionEnabled = true,
        bodyProtectionThreshold = 200,
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
    // NEW: 6 つの新しいオプション
    let fixedRemoved = 0;
    let recommendRemoved = 0;
    let paginationRemoved = 0;
    let snsPromoRemoved = 0;
    let popupRemoved = 0;
    let platformRemoved = 0;
    // NEW: 9 つの追加オプション
    let textDensityRemoved = 0;
    let shortSeqRemoved = 0;
    let symbolLineRemoved = 0;
    let linkParaRemoved = 0;
    let enhancedHiddenRemoved = 0;
    let emptyElemRemoved = 0;
    let jpLayoutRemoved = 0;
    let jpNavigationRemoved = 0;
    let authorRemoved = 0;

    // Step 1: 本文要素にマーキング（本文保護が有効な場合）
    if (bodyProtectionEnabled) {
        markBodyElements(element, bodyProtectionThreshold);
    }

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

    // Step 3: マーカーを除去（本文保護が有効な場合）
    if (bodyProtectionEnabled) {
        unmarkBodyElements(element);
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