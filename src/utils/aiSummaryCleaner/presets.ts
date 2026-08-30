/**
 * presets.ts — クレンジングプリセット定義
 *
 * 32トグルの view として機能。保存形式は既存 32キーそのままで、
 * プリセットは UI から 32値を一括で埋めるショートカット。
 *
 * E2E 手動検証手順（Playwright）:
 *   1. npm run build && Chrome で dist/chromium-mv3 を Load unpacked
 *   2. Dashboard → AI Summary Cleansing で preset "Aggressive" を選択
 *   3. chrome.storage.local.get で 32キーが 25 ON になったことを確認
 *   4. リロード → preset select が "aggressive" のまま、checkbox も維持されていることを確認
 *   5. いずれかの checkbox を手動で toggle → preset が "custom" に切り替わることを確認
 *   6. preset "Minimal" を選択 → 3 ON のみに変わることを確認
 */

import type { AiSummaryCleanseOptions } from './types.js';

export type PresetId = 'minimal' | 'balanced' | 'aggressive' | 'custom';

/**
 * CleansingConfig は AiSummaryCleanseOptions のルールフラグ部分。
 * 32キーの Enabled フラグで構成される。
 */
export type CleansingConfig = AiSummaryCleanseOptions;

/**
 * 各プリセットのフラグマップ。
 * - minimal: 3 ON (ads, alt, nav)
 * - balanced: 9 ON (minimal + metadata, social, recommend, popup, cookie, newsMedia)
 * - aggressive: 25 ON (ほぼ全 ON、7つだけ OFF)
 * - custom: 空（個別調整）
 *
 * すべての PresetId が含まれることを型で保証するため Partial ではなく
 * Partial<CleansingConfig> を使うが、minimal/balanced/aggressive は 32キー全てを明示。
 */
export const PRESETS: Record<PresetId, Partial<CleansingConfig>> = {
    minimal: {
        altEnabled: true,
        metadataEnabled: false,
        adsEnabled: true,
        navEnabled: true,
        socialEnabled: false,
        deepEnabled: false,
        jsonLdEnabled: false,
        lazyLoadEnabled: false,
        skipLinkEnabled: false,
        cardEnabled: false,
        linkDensityEnabled: false,
        fixedEnabled: false,
        recommendEnabled: false,
        paginationEnabled: false,
        snsPromoEnabled: false,
        popupEnabled: false,
        cookieEnabled: false,
        platformEnabled: false,
        textDensityEnabled: false,
        shortSeqEnabled: false,
        symbolLineEnabled: false,
        linkParaEnabled: false,
        enhancedHiddenEnabled: false,
        emptyElemEnabled: false,
        jpLayoutEnabled: false,
        jpNavigationEnabled: false,
        authorEnabled: false,
        affiliateEnabled: false,
        speechBubbleEnabled: false,
        newsMediaEnabled: false,
        ecSiteEnabled: false,
        qaSiteEnabled: false,
        videoSiteEnabled: false,
    },
    balanced: {
        altEnabled: true,
        metadataEnabled: true,
        adsEnabled: true,
        navEnabled: true,
        socialEnabled: true,
        deepEnabled: false,
        jsonLdEnabled: false,
        lazyLoadEnabled: false,
        skipLinkEnabled: false,
        cardEnabled: false,
        linkDensityEnabled: false,
        fixedEnabled: false,
        recommendEnabled: true,
        paginationEnabled: false,
        snsPromoEnabled: false,
        popupEnabled: true,
        cookieEnabled: true,
        platformEnabled: false,
        textDensityEnabled: false,
        shortSeqEnabled: false,
        symbolLineEnabled: false,
        linkParaEnabled: false,
        enhancedHiddenEnabled: false,
        emptyElemEnabled: false,
        jpLayoutEnabled: false,
        jpNavigationEnabled: false,
        authorEnabled: false,
        affiliateEnabled: false,
        speechBubbleEnabled: false,
        newsMediaEnabled: true,
        ecSiteEnabled: false,
        qaSiteEnabled: false,
        videoSiteEnabled: false,
    },
    aggressive: {
        altEnabled: true,
        metadataEnabled: true,
        adsEnabled: true,
        navEnabled: true,
        socialEnabled: true,
        deepEnabled: true,
        jsonLdEnabled: false,
        lazyLoadEnabled: false,
        skipLinkEnabled: false,
        cardEnabled: false,
        linkDensityEnabled: true,
        fixedEnabled: false,
        recommendEnabled: true,
        paginationEnabled: false,
        snsPromoEnabled: true,
        popupEnabled: true,
        cookieEnabled: true,
        platformEnabled: false,
        textDensityEnabled: true,
        shortSeqEnabled: true,
        symbolLineEnabled: true,
        linkParaEnabled: true,
        enhancedHiddenEnabled: true,
        emptyElemEnabled: true,
        jpLayoutEnabled: true,
        jpNavigationEnabled: true,
        authorEnabled: false,
        affiliateEnabled: true,
        speechBubbleEnabled: true,
        newsMediaEnabled: true,
        ecSiteEnabled: true,
        qaSiteEnabled: true,
        videoSiteEnabled: true,
    },
    custom: {},
};

/**
 * プリセットの ON 数を数える（テスト用）
 */
export function countPresetEnabled(presetId: PresetId): number {
    const preset = PRESETS[presetId];
    return Object.values(preset).filter(v => v === true).length;
}

/**
 * config が preset と完全一致するか判定
 */
export function isPresetMatch(config: Partial<CleansingConfig>, presetId: PresetId): boolean {
    const preset = PRESETS[presetId];
    if (presetId === 'custom') return Object.keys(preset).length === 0;
    for (const [key, expected] of Object.entries(preset)) {
        if ((config as Record<string, unknown>)[key] !== expected) return false;
    }
    return true;
}
