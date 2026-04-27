/**
 * aiSummaryCleansingSettings.ts
 * AI要約クレンジング設定の管理
 */

import { StorageKeys, getSettings, saveSettings } from '../utils/storage.js';
import { logError, ErrorCode } from '../utils/logger.js';

/**
 * AI要約クレンジング設定
 */
export interface AiSummaryCleansingSettings {
    enabled: boolean;
    altEnabled: boolean;
    metadataEnabled: boolean;
    adsEnabled: boolean;
    navEnabled: boolean;
    socialEnabled: boolean;
    deepEnabled: boolean;
    linkDensityEnabled: boolean;
    jsonLdEnabled: boolean;
    lazyLoadEnabled: boolean;
    skipLinkEnabled: boolean;
    cardEnabled: boolean;
    // NEW: 6つの新しいオプション
    fixedEnabled: boolean;        // 固定要素削除（デフォルト: false）
    recommendEnabled: boolean;   // 推荐セクション削除（デフォルト: true）
    paginationEnabled: boolean;  // ページネーション削除（デフォルト: false）
    snsPromoEnabled: boolean;    // SNSプロモ削除（デフォルト: false）
    popupEnabled: boolean;       // ポップアップ削除（デフォルト: true）
    platformEnabled: boolean;    // プラットフォーム噪声削除（デフォルト: false）
    // NEW: 9つの追加オプション
    textDensityEnabled: boolean;      // テキスト密度フィルタリング（デフォルト: false）
    shortSeqEnabled: boolean;        // 短文要素の連続削除（デフォルト: false）
    symbolLineEnabled: boolean;      // 特殊記号行の削除（デフォルト: false）
    linkParaEnabled: boolean;        // リンクのみ段落の削除（デフォルト: false）
    linkRatioThreshold: number;       // リンク密度閾値（デフォルト: 70）
    shortTextThreshold: number;       // 短文閾値文字数（デフォルト: 30）
    shortSeqCount: number;            // 短文連続数閾値（デフォルト: 5）
    linkParaThreshold: number;        // リンクのみ段落閾値（デフォルト: 50）
    enhancedHiddenEnabled: boolean;  // 非表示要素強化削除（デフォルト: true）
    emptyElemEnabled: boolean;       // 空要素の削除（デフォルト: true）
    jpLayoutEnabled: boolean;        // JP BEM系レイアウトパターン（デフォルト: false）
    jpNavigationEnabled: boolean;     // JP ナビ頻出語（デフォルト: false）
    authorEnabled: boolean;         // 執筆者・メタ情報（デフォルト: false）
    // Body protection settings
    bodyProtectionEnabled: boolean;  // 本文保護機能（デフォルト：true）
    bodyProtectionThreshold: number; // 本文スコア閾値（デフォルト：200）
}

/**
 * AI要約クレンジング設定を取得
 * @returns AI要約クレンジング設定
 */
export async function getAiSummaryCleansingSettings(): Promise<AiSummaryCleansingSettings> {
    const settings = await getSettings();
    return {
        enabled: settings[StorageKeys.AI_SUMMARY_CLEANSING_ENABLED] ?? true,
        altEnabled: settings[StorageKeys.AI_SUMMARY_CLEANSING_ALT] ?? true,
        metadataEnabled: settings[StorageKeys.AI_SUMMARY_CLEANSING_METADATA] ?? true,
        adsEnabled: settings[StorageKeys.AI_SUMMARY_CLEANSING_ADS] ?? true,
        navEnabled: settings[StorageKeys.AI_SUMMARY_CLEANSING_NAV] ?? true,
        socialEnabled: settings[StorageKeys.AI_SUMMARY_CLEANSING_SOCIAL] ?? true,
        deepEnabled: settings[StorageKeys.AI_SUMMARY_CLEANSING_DEEP] ?? false,
        linkDensityEnabled: settings[StorageKeys.AI_SUMMARY_CLEANSING_LINK_DENSITY] ?? true,
        jsonLdEnabled: settings[StorageKeys.AI_SUMMARY_CLEANSING_JSON_LD] ?? false,
        lazyLoadEnabled: settings[StorageKeys.AI_SUMMARY_CLEANSING_LAZY_LOAD] ?? false,
        skipLinkEnabled: settings[StorageKeys.AI_SUMMARY_CLEANSING_SKIP_LINK] ?? false,
        cardEnabled: settings[StorageKeys.AI_SUMMARY_CLEANSING_CARD] ?? false,
        // NEW
        fixedEnabled: settings[StorageKeys.AI_SUMMARY_CLEANSING_FIXED] ?? false,
        recommendEnabled: settings[StorageKeys.AI_SUMMARY_CLEANSING_RECOMMEND] ?? true,
        paginationEnabled: settings[StorageKeys.AI_SUMMARY_CLEANSING_PAGINATION] ?? false,
        snsPromoEnabled: settings[StorageKeys.AI_SUMMARY_CLEANSING_SNS_PROMO] ?? false,
        popupEnabled: settings[StorageKeys.AI_SUMMARY_CLEANSING_POPUP] ?? true,
        platformEnabled: settings[StorageKeys.AI_SUMMARY_CLEANSING_PLATFORM] ?? false,
        // NEW: 9つの追加オプション
        textDensityEnabled: settings[StorageKeys.AI_SUMMARY_CLEANSING_TEXT_DENSITY] ?? false,
        shortSeqEnabled: settings[StorageKeys.AI_SUMMARY_CLEANSING_SHORT_SEQ] ?? false,
        symbolLineEnabled: settings[StorageKeys.AI_SUMMARY_CLEANSING_SYMBOL_LINE] ?? false,
        linkParaEnabled: settings[StorageKeys.AI_SUMMARY_CLEANSING_LINK_PARA] ?? false,
        linkRatioThreshold: settings[StorageKeys.AI_SUMMARY_CLEANSING_LINK_RATIO_THRESHOLD] ?? 70,
        shortTextThreshold: settings[StorageKeys.AI_SUMMARY_CLEANSING_SHORT_TEXT_THRESHOLD] ?? 30,
        shortSeqCount: settings[StorageKeys.AI_SUMMARY_CLEANSING_SHORT_SEQ_COUNT] ?? 5,
        linkParaThreshold: settings[StorageKeys.AI_SUMMARY_CLEANSING_LINK_PARA_THRESHOLD] ?? 50,
        enhancedHiddenEnabled: settings[StorageKeys.AI_SUMMARY_CLEANSING_ENHANCED_HIDDEN] ?? true,
        emptyElemEnabled: settings[StorageKeys.AI_SUMMARY_CLEANSING_EMPTY_ELEM] ?? true,
        jpLayoutEnabled: settings[StorageKeys.AI_SUMMARY_CLEANSING_JP_LAYOUT] ?? false,
        jpNavigationEnabled: settings[StorageKeys.AI_SUMMARY_CLEANSING_JP_NAVIGATION] ?? false,
    authorEnabled: settings[StorageKeys.AI_SUMMARY_CLEANSING_AUTHOR] ?? false,
    // Body protection
    bodyProtectionEnabled: settings[StorageKeys.AI_SUMMARY_CLEANSING_BODY_PROTECTION_ENABLED] ?? true,
    bodyProtectionThreshold: settings[StorageKeys.AI_SUMMARY_CLEANSING_BODY_PROTECTION_THRESHOLD] ?? 200
    };
}

/**
 * AI要約クレンジング設定を保存
 * @param settings AI要約クレンジング設定
 */
export async function saveAiSummaryCleansingSettings(settings: AiSummaryCleansingSettings): Promise<void> {
    const currentSettings = await getSettings();
    currentSettings[StorageKeys.AI_SUMMARY_CLEANSING_ENABLED] = settings.enabled;
    currentSettings[StorageKeys.AI_SUMMARY_CLEANSING_ALT] = settings.altEnabled;
    currentSettings[StorageKeys.AI_SUMMARY_CLEANSING_METADATA] = settings.metadataEnabled;
    currentSettings[StorageKeys.AI_SUMMARY_CLEANSING_ADS] = settings.adsEnabled;
    currentSettings[StorageKeys.AI_SUMMARY_CLEANSING_NAV] = settings.navEnabled;
    currentSettings[StorageKeys.AI_SUMMARY_CLEANSING_SOCIAL] = settings.socialEnabled;
    currentSettings[StorageKeys.AI_SUMMARY_CLEANSING_DEEP] = settings.deepEnabled;
    currentSettings[StorageKeys.AI_SUMMARY_CLEANSING_LINK_DENSITY] = settings.linkDensityEnabled;
    currentSettings[StorageKeys.AI_SUMMARY_CLEANSING_JSON_LD] = settings.jsonLdEnabled;
    currentSettings[StorageKeys.AI_SUMMARY_CLEANSING_LAZY_LOAD] = settings.lazyLoadEnabled;
    currentSettings[StorageKeys.AI_SUMMARY_CLEANSING_SKIP_LINK] = settings.skipLinkEnabled;
    currentSettings[StorageKeys.AI_SUMMARY_CLEANSING_CARD] = settings.cardEnabled;
    // NEW
    currentSettings[StorageKeys.AI_SUMMARY_CLEANSING_FIXED] = settings.fixedEnabled;
    currentSettings[StorageKeys.AI_SUMMARY_CLEANSING_RECOMMEND] = settings.recommendEnabled;
    currentSettings[StorageKeys.AI_SUMMARY_CLEANSING_PAGINATION] = settings.paginationEnabled;
    currentSettings[StorageKeys.AI_SUMMARY_CLEANSING_SNS_PROMO] = settings.snsPromoEnabled;
    currentSettings[StorageKeys.AI_SUMMARY_CLEANSING_POPUP] = settings.popupEnabled;
    currentSettings[StorageKeys.AI_SUMMARY_CLEANSING_PLATFORM] = settings.platformEnabled;
    // NEW: 9つの追加オプション
    currentSettings[StorageKeys.AI_SUMMARY_CLEANSING_TEXT_DENSITY] = settings.textDensityEnabled;
    currentSettings[StorageKeys.AI_SUMMARY_CLEANSING_SHORT_SEQ] = settings.shortSeqEnabled;
    currentSettings[StorageKeys.AI_SUMMARY_CLEANSING_SYMBOL_LINE] = settings.symbolLineEnabled;
    currentSettings[StorageKeys.AI_SUMMARY_CLEANSING_LINK_PARA] = settings.linkParaEnabled;
    currentSettings[StorageKeys.AI_SUMMARY_CLEANSING_LINK_RATIO_THRESHOLD] = settings.linkRatioThreshold;
    currentSettings[StorageKeys.AI_SUMMARY_CLEANSING_SHORT_TEXT_THRESHOLD] = settings.shortTextThreshold;
    currentSettings[StorageKeys.AI_SUMMARY_CLEANSING_SHORT_SEQ_COUNT] = settings.shortSeqCount;
    currentSettings[StorageKeys.AI_SUMMARY_CLEANSING_LINK_PARA_THRESHOLD] = settings.linkParaThreshold;
    currentSettings[StorageKeys.AI_SUMMARY_CLEANSING_ENHANCED_HIDDEN] = settings.enhancedHiddenEnabled;
    currentSettings[StorageKeys.AI_SUMMARY_CLEANSING_EMPTY_ELEM] = settings.emptyElemEnabled;
    currentSettings[StorageKeys.AI_SUMMARY_CLEANSING_JP_LAYOUT] = settings.jpLayoutEnabled;
    currentSettings[StorageKeys.AI_SUMMARY_CLEANSING_JP_NAVIGATION] = settings.jpNavigationEnabled;
    currentSettings[StorageKeys.AI_SUMMARY_CLEANSING_AUTHOR] = settings.authorEnabled;
    currentSettings[StorageKeys.AI_SUMMARY_CLEANSING_BODY_PROTECTION_ENABLED] = settings.bodyProtectionEnabled;
    currentSettings[StorageKeys.AI_SUMMARY_CLEANSING_BODY_PROTECTION_THRESHOLD] = settings.bodyProtectionThreshold;
    await saveSettings(currentSettings);
}

/**
 * AI要約クレンジング設定をUIに反映
 * @param settings AI要約クレンジング設定
 */
export function applyAiSummaryCleansingSettingsToUI(settings: AiSummaryCleansingSettings): void {
    const enabledCheckbox = document.getElementById('ai-summary-cleansing-enabled') as HTMLInputElement;
    const altCheckbox = document.getElementById('ai-summary-cleansing-alt') as HTMLInputElement;
    const metadataCheckbox = document.getElementById('ai-summary-cleansing-metadata') as HTMLInputElement;
    const adsCheckbox = document.getElementById('ai-summary-cleansing-ads') as HTMLInputElement;
    const navCheckbox = document.getElementById('ai-summary-cleansing-nav') as HTMLInputElement;
    const socialCheckbox = document.getElementById('ai-summary-cleansing-social') as HTMLInputElement;
    const deepCheckbox = document.getElementById('ai-summary-cleansing-deep') as HTMLInputElement;
    const linkDensityCheckbox = document.getElementById('ai-summary-cleansing-link-density') as HTMLInputElement;
    const jsonLdCheckbox = document.getElementById('ai-summary-cleansing-json-ld') as HTMLInputElement;
    const lazyLoadCheckbox = document.getElementById('ai-summary-cleansing-lazy-load') as HTMLInputElement;
    const skipLinkCheckbox = document.getElementById('ai-summary-cleansing-skip-link') as HTMLInputElement;
    const cardCheckbox = document.getElementById('ai-summary-cleansing-card') as HTMLInputElement;
    // NEW
    const fixedCheckbox = document.getElementById('ai-summary-cleansing-fixed') as HTMLInputElement;
    const recommendCheckbox = document.getElementById('ai-summary-cleansing-recommend') as HTMLInputElement;
    const paginationCheckbox = document.getElementById('ai-summary-cleansing-pagination') as HTMLInputElement;
    const snsPromoCheckbox = document.getElementById('ai-summary-cleansing-sns-promo') as HTMLInputElement;
    const popupCheckbox = document.getElementById('ai-summary-cleansing-popup') as HTMLInputElement;
    const platformCheckbox = document.getElementById('ai-summary-cleansing-platform') as HTMLInputElement;
    // NEW: 9 additional options
    const textDensityCheckbox = document.getElementById('ai-summary-cleansing-text-density') as HTMLInputElement;
    const shortSeqCheckbox = document.getElementById('ai-summary-cleansing-short-seq') as HTMLInputElement;
    const symbolLineCheckbox = document.getElementById('ai-summary-cleansing-symbol-line') as HTMLInputElement;
    const linkParaCheckbox = document.getElementById('ai-summary-cleansing-link-para') as HTMLInputElement;
    const enhancedHiddenCheckbox = document.getElementById('ai-summary-cleansing-enhanced-hidden') as HTMLInputElement;
    const emptyElemCheckbox = document.getElementById('ai-summary-cleansing-empty-elem') as HTMLInputElement;
    const jpLayoutCheckbox = document.getElementById('ai-summary-cleansing-jp-layout') as HTMLInputElement;
    const jpNavigationCheckbox = document.getElementById('ai-summary-cleansing-jp-navigation') as HTMLInputElement;
    const authorCheckbox = document.getElementById('ai-summary-cleansing-author') as HTMLInputElement;
    const bodyProtectionEnabledCheckbox = document.getElementById('ai-summary-cleansing-body-protection-enabled') as HTMLInputElement;
    const bodyProtectionThresholdSlider = document.getElementById('ai-summary-cleansing-body-protection-threshold') as HTMLInputElement;
    const bodyProtectionThresholdValue = document.getElementById('ai-summary-cleansing-body-protection-threshold-value') as HTMLSpanElement;

    if (enabledCheckbox) enabledCheckbox.checked = settings.enabled;
    if (altCheckbox) altCheckbox.checked = settings.altEnabled;
    if (metadataCheckbox) metadataCheckbox.checked = settings.metadataEnabled;
    if (adsCheckbox) adsCheckbox.checked = settings.adsEnabled;
    if (navCheckbox) navCheckbox.checked = settings.navEnabled;
    if (socialCheckbox) socialCheckbox.checked = settings.socialEnabled;
    if (deepCheckbox) deepCheckbox.checked = settings.deepEnabled;
    if (linkDensityCheckbox) linkDensityCheckbox.checked = settings.linkDensityEnabled;
    if (jsonLdCheckbox) jsonLdCheckbox.checked = settings.jsonLdEnabled;
    if (lazyLoadCheckbox) lazyLoadCheckbox.checked = settings.lazyLoadEnabled;
    if (skipLinkCheckbox) skipLinkCheckbox.checked = settings.skipLinkEnabled;
    if (cardCheckbox) cardCheckbox.checked = settings.cardEnabled;
    // NEW: 6 options
    if (fixedCheckbox) fixedCheckbox.checked = settings.fixedEnabled;
    if (recommendCheckbox) recommendCheckbox.checked = settings.recommendEnabled;
    if (paginationCheckbox) paginationCheckbox.checked = settings.paginationEnabled;
    if (snsPromoCheckbox) snsPromoCheckbox.checked = settings.snsPromoEnabled;
    if (popupCheckbox) popupCheckbox.checked = settings.popupEnabled;
    if (platformCheckbox) platformCheckbox.checked = settings.platformEnabled;
    // NEW: 9 additional options
    if (textDensityCheckbox) textDensityCheckbox.checked = settings.textDensityEnabled;
    if (shortSeqCheckbox) shortSeqCheckbox.checked = settings.shortSeqEnabled;
    if (symbolLineCheckbox) symbolLineCheckbox.checked = settings.symbolLineEnabled;
    if (linkParaCheckbox) linkParaCheckbox.checked = settings.linkParaEnabled;
    if (enhancedHiddenCheckbox) enhancedHiddenCheckbox.checked = settings.enhancedHiddenEnabled;
    if (emptyElemCheckbox) emptyElemCheckbox.checked = settings.emptyElemEnabled;
    if (jpLayoutCheckbox) jpLayoutCheckbox.checked = settings.jpLayoutEnabled;
    if (jpNavigationCheckbox) jpNavigationCheckbox.checked = settings.jpNavigationEnabled;
    if (authorCheckbox) authorCheckbox.checked = settings.authorEnabled;
    // Body protection (dashboard)
    if (bodyProtectionEnabledCheckbox) bodyProtectionEnabledCheckbox.checked = settings.bodyProtectionEnabled;
    if (bodyProtectionThresholdSlider) {
        bodyProtectionThresholdSlider.value = settings.bodyProtectionThreshold.toString();
        if (bodyProtectionThresholdValue) bodyProtectionThresholdValue.textContent = settings.bodyProtectionThreshold.toString();
    }
    // Body protection (popup-specific elements)
    const popupBodyProtectionEnabledCheckbox = document.getElementById('popup-body-protection-enabled') as HTMLInputElement;
    const popupBodyProtectionThresholdSlider = document.getElementById('popup-body-protection-threshold') as HTMLInputElement;
    const popupBodyProtectionThresholdValue = document.getElementById('popup-body-protection-threshold-value') as HTMLSpanElement;
    if (popupBodyProtectionEnabledCheckbox) popupBodyProtectionEnabledCheckbox.checked = settings.bodyProtectionEnabled;
    if (popupBodyProtectionThresholdSlider) {
        popupBodyProtectionThresholdSlider.value = settings.bodyProtectionThreshold.toString();
        if (popupBodyProtectionThresholdValue) popupBodyProtectionThresholdValue.textContent = settings.bodyProtectionThreshold.toString();
    }

    const linkRatioThresholdInput = document.getElementById('ai-summary-cleansing-link-ratio-threshold') as HTMLInputElement;
    const shortTextThresholdInput = document.getElementById('ai-summary-cleansing-short-text-threshold') as HTMLInputElement;
    const shortSeqCountInput = document.getElementById('ai-summary-cleansing-short-seq-count') as HTMLInputElement;
    const linkParaThresholdInput = document.getElementById('ai-summary-cleansing-link-para-threshold') as HTMLInputElement;

    if (linkRatioThresholdInput) {
        linkRatioThresholdInput.value = settings.linkRatioThreshold.toString();
        const valElem = document.getElementById('link-ratio-threshold-value');
        if (valElem) valElem.textContent = settings.linkRatioThreshold.toString();
    }
    if (shortTextThresholdInput) {
        shortTextThresholdInput.value = settings.shortTextThreshold.toString();
        const valElem = document.getElementById('short-text-threshold-value');
        if (valElem) valElem.textContent = settings.shortTextThreshold.toString();
    }
    if (shortSeqCountInput) {
        shortSeqCountInput.value = settings.shortSeqCount.toString();
        const valElem = document.getElementById('short-seq-count-value');
        if (valElem) valElem.textContent = settings.shortSeqCount.toString();
    }
    if (linkParaThresholdInput) {
        linkParaThresholdInput.value = settings.linkParaThreshold.toString();
        const valElem = document.getElementById('link-para-threshold-value');
        if (valElem) valElem.textContent = settings.linkParaThreshold.toString();
    }

    // 有効/無効に応じて子チェックボックスの状態を更新
    updateAiSummaryCleansingCheckboxStates(settings.enabled);

    // サブグループの表示/非表示を初期化
    const subGroup = document.getElementById('aiSummaryCleansingSubGroup') as HTMLElement;
    if (subGroup) {
        subGroup.style.display = settings.enabled ? 'block' : 'none';
    }
}

/**
 * AI要約クレンジング設定をUIから取得
 * @returns AI要約クレンジング設定
 */
export function getAiSummaryCleansingSettingsFromUI(): AiSummaryCleansingSettings {
    const enabledCheckbox = document.getElementById('ai-summary-cleansing-enabled') as HTMLInputElement;
    const altCheckbox = document.getElementById('ai-summary-cleansing-alt') as HTMLInputElement;
    const metadataCheckbox = document.getElementById('ai-summary-cleansing-metadata') as HTMLInputElement;
    const adsCheckbox = document.getElementById('ai-summary-cleansing-ads') as HTMLInputElement;
    const navCheckbox = document.getElementById('ai-summary-cleansing-nav') as HTMLInputElement;
    const socialCheckbox = document.getElementById('ai-summary-cleansing-social') as HTMLInputElement;
    const deepCheckbox = document.getElementById('ai-summary-cleansing-deep') as HTMLInputElement;
    const linkDensityCheckbox = document.getElementById('ai-summary-cleansing-link-density') as HTMLInputElement;
    const jsonLdCheckbox = document.getElementById('ai-summary-cleansing-json-ld') as HTMLInputElement;
    const lazyLoadCheckbox = document.getElementById('ai-summary-cleansing-lazy-load') as HTMLInputElement;
    const skipLinkCheckbox = document.getElementById('ai-summary-cleansing-skip-link') as HTMLInputElement;
    const cardCheckbox = document.getElementById('ai-summary-cleansing-card') as HTMLInputElement;
    // NEW
    const fixedCheckbox = document.getElementById('ai-summary-cleansing-fixed') as HTMLInputElement;
    const recommendCheckbox = document.getElementById('ai-summary-cleansing-recommend') as HTMLInputElement;
    const paginationCheckbox = document.getElementById('ai-summary-cleansing-pagination') as HTMLInputElement;
    const snsPromoCheckbox = document.getElementById('ai-summary-cleansing-sns-promo') as HTMLInputElement;
    const popupCheckbox = document.getElementById('ai-summary-cleansing-popup') as HTMLInputElement;
    const platformCheckbox = document.getElementById('ai-summary-cleansing-platform') as HTMLInputElement;

    return {
        enabled: enabledCheckbox?.checked ?? true,
        altEnabled: altCheckbox?.checked ?? true,
        metadataEnabled: metadataCheckbox?.checked ?? true,
        adsEnabled: adsCheckbox?.checked ?? true,
        navEnabled: navCheckbox?.checked ?? true,
        socialEnabled: socialCheckbox?.checked ?? true,
        deepEnabled: deepCheckbox?.checked ?? false,
        linkDensityEnabled: linkDensityCheckbox?.checked ?? true,
        jsonLdEnabled: jsonLdCheckbox?.checked ?? false,
        lazyLoadEnabled: lazyLoadCheckbox?.checked ?? false,
        skipLinkEnabled: skipLinkCheckbox?.checked ?? false,
        cardEnabled: cardCheckbox?.checked ?? false,
        // NEW
        fixedEnabled: fixedCheckbox?.checked ?? false,
        recommendEnabled: recommendCheckbox?.checked ?? true,
        paginationEnabled: paginationCheckbox?.checked ?? false,
        snsPromoEnabled: snsPromoCheckbox?.checked ?? false,
        popupEnabled: popupCheckbox?.checked ?? true,
        platformEnabled: platformCheckbox?.checked ?? false,
        // NEW: 9つの追加オプション
        textDensityEnabled: (document.getElementById('ai-summary-cleansing-text-density') as HTMLInputElement)?.checked ?? false,
        shortSeqEnabled: (document.getElementById('ai-summary-cleansing-short-seq') as HTMLInputElement)?.checked ?? false,
        symbolLineEnabled: (document.getElementById('ai-summary-cleansing-symbol-line') as HTMLInputElement)?.checked ?? false,
        linkParaEnabled: (document.getElementById('ai-summary-cleansing-link-para') as HTMLInputElement)?.checked ?? false,
        linkRatioThreshold: parseInt((document.getElementById('ai-summary-cleansing-link-ratio-threshold') as HTMLInputElement)?.value || '70', 10),
        shortTextThreshold: parseInt((document.getElementById('ai-summary-cleansing-short-text-threshold') as HTMLInputElement)?.value || '30', 10),
        shortSeqCount: parseInt((document.getElementById('ai-summary-cleansing-short-seq-count') as HTMLInputElement)?.value || '5', 10),
        linkParaThreshold: parseInt((document.getElementById('ai-summary-cleansing-link-para-threshold') as HTMLInputElement)?.value || '50', 10),
        enhancedHiddenEnabled: (document.getElementById('ai-summary-cleansing-enhanced-hidden') as HTMLInputElement)?.checked ?? true,
        emptyElemEnabled: (document.getElementById('ai-summary-cleansing-empty-elem') as HTMLInputElement)?.checked ?? true,
        jpLayoutEnabled: (document.getElementById('ai-summary-cleansing-jp-layout') as HTMLInputElement)?.checked ?? false,
        jpNavigationEnabled: (document.getElementById('ai-summary-cleansing-jp-navigation') as HTMLInputElement)?.checked ?? false,
        authorEnabled: (document.getElementById('ai-summary-cleansing-author') as HTMLInputElement)?.checked ?? false,
        bodyProtectionEnabled: (document.getElementById('ai-summary-cleansing-body-protection-enabled') as HTMLInputElement)?.checked ?? true,
        bodyProtectionThreshold: parseInt((document.getElementById('ai-summary-cleansing-body-protection-threshold') as HTMLInputElement)?.value || '200', 10)
    };
}

/**
 * AI要約クレンジングチェックボックスの状態を更新
 * @param enabled AI要約クレンジングが有効かどうか
 */
export function updateAiSummaryCleansingCheckboxStates(enabled: boolean): void {
    const fieldset = document.getElementById('aiSummaryCleansingFieldset') as HTMLFieldSetElement;
    const altCheckbox = document.getElementById('ai-summary-cleansing-alt') as HTMLInputElement;
    const metadataCheckbox = document.getElementById('ai-summary-cleansing-metadata') as HTMLInputElement;
    const adsCheckbox = document.getElementById('ai-summary-cleansing-ads') as HTMLInputElement;
    const navCheckbox = document.getElementById('ai-summary-cleansing-nav') as HTMLInputElement;
    const socialCheckbox = document.getElementById('ai-summary-cleansing-social') as HTMLInputElement;
    const deepCheckbox = document.getElementById('ai-summary-cleansing-deep') as HTMLInputElement;
    const linkDensityCheckbox = document.getElementById('ai-summary-cleansing-link-density') as HTMLInputElement;
    const jsonLdCheckbox = document.getElementById('ai-summary-cleansing-json-ld') as HTMLInputElement;
    const lazyLoadCheckbox = document.getElementById('ai-summary-cleansing-lazy-load') as HTMLInputElement;
    const skipLinkCheckbox = document.getElementById('ai-summary-cleansing-skip-link') as HTMLInputElement;
    const cardCheckbox = document.getElementById('ai-summary-cleansing-card') as HTMLInputElement;
    const fixedCheckbox = document.getElementById('ai-summary-cleansing-fixed') as HTMLInputElement;
    const recommendCheckbox = document.getElementById('ai-summary-cleansing-recommend') as HTMLInputElement;
    const paginationCheckbox = document.getElementById('ai-summary-cleansing-pagination') as HTMLInputElement;
    const snsPromoCheckbox = document.getElementById('ai-summary-cleansing-sns-promo') as HTMLInputElement;
    const popupCheckbox = document.getElementById('ai-summary-cleansing-popup') as HTMLInputElement;
    const platformCheckbox = document.getElementById('ai-summary-cleansing-platform') as HTMLInputElement;
    // NEW: 9 additional options
    const textDensityCheckbox = document.getElementById('ai-summary-cleansing-text-density') as HTMLInputElement;
    const shortSeqCheckbox = document.getElementById('ai-summary-cleansing-short-seq') as HTMLInputElement;
    const symbolLineCheckbox = document.getElementById('ai-summary-cleansing-symbol-line') as HTMLInputElement;
    const linkParaCheckbox = document.getElementById('ai-summary-cleansing-link-para') as HTMLInputElement;
    const enhancedHiddenCheckbox = document.getElementById('ai-summary-cleansing-enhanced-hidden') as HTMLInputElement;
    const emptyElemCheckbox = document.getElementById('ai-summary-cleansing-empty-elem') as HTMLInputElement;
    const jpLayoutCheckbox = document.getElementById('ai-summary-cleansing-jp-layout') as HTMLInputElement;
    const jpNavigationCheckbox = document.getElementById('ai-summary-cleansing-jp-navigation') as HTMLInputElement;
    const authorCheckbox = document.getElementById('ai-summary-cleansing-author') as HTMLInputElement;

    // fieldset.disabled = !enabled; // Do not disable fieldset as it contains the main toggle checkbox

    if (altCheckbox) altCheckbox.disabled = !enabled;
    if (metadataCheckbox) metadataCheckbox.disabled = !enabled;
    if (adsCheckbox) adsCheckbox.disabled = !enabled;
    if (navCheckbox) navCheckbox.disabled = !enabled;
    if (socialCheckbox) socialCheckbox.disabled = !enabled;
    if (deepCheckbox) deepCheckbox.disabled = !enabled;
    if (linkDensityCheckbox) linkDensityCheckbox.disabled = !enabled;
    if (jsonLdCheckbox) jsonLdCheckbox.disabled = !enabled;
    if (lazyLoadCheckbox) lazyLoadCheckbox.disabled = !enabled;
    if (skipLinkCheckbox) skipLinkCheckbox.disabled = !enabled;
    if (cardCheckbox) cardCheckbox.disabled = !enabled;
    if (fixedCheckbox) fixedCheckbox.disabled = !enabled;
    if (recommendCheckbox) recommendCheckbox.disabled = !enabled;
    if (paginationCheckbox) paginationCheckbox.disabled = !enabled;
    if (snsPromoCheckbox) snsPromoCheckbox.disabled = !enabled;
    if (popupCheckbox) popupCheckbox.disabled = !enabled;
    if (platformCheckbox) platformCheckbox.disabled = !enabled;
    if (textDensityCheckbox) textDensityCheckbox.disabled = !enabled;
    if (shortSeqCheckbox) shortSeqCheckbox.disabled = !enabled;
    if (symbolLineCheckbox) symbolLineCheckbox.disabled = !enabled;
    if (linkParaCheckbox) linkParaCheckbox.disabled = !enabled;
    if (enhancedHiddenCheckbox) enhancedHiddenCheckbox.disabled = !enabled;
    if (emptyElemCheckbox) emptyElemCheckbox.disabled = !enabled;
    if (jpLayoutCheckbox) jpLayoutCheckbox.disabled = !enabled;
    if (jpNavigationCheckbox) jpNavigationCheckbox.disabled = !enabled;
    if (authorCheckbox) authorCheckbox.disabled = !enabled;
    // Body protection is independent of cleansing enabled/disabled
    const bodyProtectionEnabledCheckbox = document.getElementById('ai-summary-cleansing-body-protection-enabled') as HTMLInputElement;
    const bodyProtectionThresholdSlider = document.getElementById('ai-summary-cleansing-body-protection-threshold') as HTMLInputElement;
    const popupBodyProtectionEnabledCheckbox = document.getElementById('popup-body-protection-enabled') as HTMLInputElement;
    const popupBodyProtectionThresholdSlider = document.getElementById('popup-body-protection-threshold') as HTMLInputElement;
    if (bodyProtectionEnabledCheckbox) bodyProtectionEnabledCheckbox.disabled = false;
    if (bodyProtectionThresholdSlider) bodyProtectionThresholdSlider.disabled = false;
    if (popupBodyProtectionEnabledCheckbox) popupBodyProtectionEnabledCheckbox.disabled = false;
    if (popupBodyProtectionThresholdSlider) popupBodyProtectionThresholdSlider.disabled = false;
}

/**
 * AI要約クレンジング設定のイベントリスナーを設定
 */
export function setupAiSummaryCleansingEventListeners(): void {
    const enabledCheckbox = document.getElementById('ai-summary-cleansing-enabled') as HTMLInputElement;
    const subGroup = document.getElementById('aiSummaryCleansingSubGroup') as HTMLElement;
    
    const updateSubGroupVisibility = (enabled: boolean) => {
        if (subGroup) {
            subGroup.style.display = enabled ? 'block' : 'none';
        }
    };
    
    if (enabledCheckbox) {
        enabledCheckbox.addEventListener('change', async (e) => {
            const enabled = (e.target as HTMLInputElement).checked;
            updateAiSummaryCleansingCheckboxStates(enabled);
            updateSubGroupVisibility(enabled);
            const settings = await getAiSummaryCleansingSettings();
            settings.enabled = enabled;
            await saveAiSummaryCleansingSettings(settings);
        });
    }

    const checkboxes = [
        'ai-summary-cleansing-alt',
        'ai-summary-cleansing-metadata',
        'ai-summary-cleansing-ads',
        'ai-summary-cleansing-nav',
        'ai-summary-cleansing-social',
        'ai-summary-cleansing-deep',
        'ai-summary-cleansing-link-density',
        'ai-summary-cleansing-json-ld',
        'ai-summary-cleansing-lazy-load',
        'ai-summary-cleansing-skip-link',
        'ai-summary-cleansing-card',
        // NEW: 6 options
        'ai-summary-cleansing-fixed',
        'ai-summary-cleansing-recommend',
        'ai-summary-cleansing-pagination',
        'ai-summary-cleansing-sns-promo',
        'ai-summary-cleansing-popup',
        'ai-summary-cleansing-platform',
        // NEW: 9 additional options
        'ai-summary-cleansing-text-density',
        'ai-summary-cleansing-short-seq',
        'ai-summary-cleansing-symbol-line',
        'ai-summary-cleansing-link-para',
        'ai-summary-cleansing-enhanced-hidden',
        'ai-summary-cleansing-empty-elem',
        'ai-summary-cleansing-jp-layout',
        'ai-summary-cleansing-jp-navigation',
        'ai-summary-cleansing-author'
    ];

    for (const id of checkboxes) {
        const checkbox = document.getElementById(id) as HTMLInputElement;
        if (checkbox) {
            checkbox.addEventListener('change', async () => {
                const settings = getAiSummaryCleansingSettingsFromUI();
                await saveAiSummaryCleansingSettings(settings);
            });
        }
    }

    // Body protection checkboxes (dashboard + popup)
    const bodyProtectionIds = [
        'ai-summary-cleansing-body-protection-enabled',
        'popup-body-protection-enabled'
    ];
    for (const id of bodyProtectionIds) {
        const checkbox = document.getElementById(id) as HTMLInputElement;
        if (checkbox) {
            checkbox.addEventListener('change', async () => {
                const settings = getAiSummaryCleansingSettingsFromUI();
                await saveAiSummaryCleansingSettings(settings);
            });
        }
    }

    const rangeConfigs = [
        { id: 'ai-summary-cleansing-link-ratio-threshold', valId: 'link-ratio-threshold-value' },
        { id: 'ai-summary-cleansing-short-text-threshold', valId: 'short-text-threshold-value' },
        { id: 'ai-summary-cleansing-short-seq-count', valId: 'short-seq-count-value' },
        { id: 'ai-summary-cleansing-link-para-threshold', valId: 'link-para-threshold-value' },
        { id: 'ai-summary-cleansing-body-protection-threshold', valId: 'ai-summary-cleansing-body-protection-threshold-value' },
        { id: 'popup-body-protection-threshold', valId: 'popup-body-protection-threshold-value' }
    ];

    for (const conf of rangeConfigs) {
        const input = document.getElementById(conf.id) as HTMLInputElement;
        const valElem = document.getElementById(conf.valId);
        if (input) {
            if (valElem) {
                input.addEventListener('input', () => {
                    valElem.textContent = input.value;
                });
            }
            input.addEventListener('change', async () => {
                const settings = getAiSummaryCleansingSettingsFromUI();
                await saveAiSummaryCleansingSettings(settings);
            });
        }
    }

    // 保存ボタンのイベントリスナーを設定
    const saveButton = document.getElementById('saveAiSummaryCleansingSettings') as HTMLButtonElement;
    const statusElement = document.getElementById('aiSummaryCleansingSettingsStatus') as HTMLElement;
    if (saveButton) {
        saveButton.addEventListener('click', async () => {
            try {
                const settings = getAiSummaryCleansingSettingsFromUI();
                await saveAiSummaryCleansingSettings(settings);
                
                // ステータスメッセージを表示
                if (statusElement) {
                    statusElement.textContent = chrome.i18n.getMessage('settingsSaved') || '設定を保存しました';
                    statusElement.className = 'status-message success';
                    setTimeout(() => {
                        statusElement.textContent = '';
                        statusElement.className = 'status-message';
                    }, 3000);
                }
            } catch (error) {
                logError('Failed to save AI summary cleansing settings', { cause: error }, ErrorCode.STORAGE_WRITE_FAILURE);
                if (statusElement) {
                    statusElement.textContent = chrome.i18n.getMessage('settingsSaveError') || '設定の保存に失敗しました';
                    statusElement.className = 'status-message error';
                }
            }
        });
    }
}