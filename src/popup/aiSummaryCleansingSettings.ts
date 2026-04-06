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
    // NEW
    fixedEnabled: boolean;        // 固定要素削除（デフォルト: false）
    recommendEnabled: boolean;   // 推荐セクション削除（デフォルト: true）
    paginationEnabled: boolean;  // ページネーション削除（デフォルト: false）
    snsPromoEnabled: boolean;    // SNSプロモ削除（デフォルト: false）
    popupEnabled: boolean;       // ポップアップ削除（デフォルト: true）
    platformEnabled: boolean;    // プラットフォーム噪声削除（デフォルト: false）
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
        linkDensityEnabled: settings[StorageKeys.AI_SUMMARY_CLEANSING_LINK_DENSITY] ?? false,
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
        platformEnabled: settings[StorageKeys.AI_SUMMARY_CLEANSING_PLATFORM] ?? false
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
    // NEW
    if (fixedCheckbox) fixedCheckbox.checked = settings.fixedEnabled;
    if (recommendCheckbox) recommendCheckbox.checked = settings.recommendEnabled;
    if (paginationCheckbox) paginationCheckbox.checked = settings.paginationEnabled;
    if (snsPromoCheckbox) snsPromoCheckbox.checked = settings.snsPromoEnabled;
    if (popupCheckbox) popupCheckbox.checked = settings.popupEnabled;
    if (platformCheckbox) platformCheckbox.checked = settings.platformEnabled;

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
        linkDensityEnabled: linkDensityCheckbox?.checked ?? false,
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
        platformEnabled: platformCheckbox?.checked ?? false
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

    if (fieldset) {
        fieldset.disabled = !enabled;
    }

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
        // NEW
        'ai-summary-cleansing-fixed',
        'ai-summary-cleansing-recommend',
        'ai-summary-cleansing-pagination',
        'ai-summary-cleansing-sns-promo',
        'ai-summary-cleansing-popup',
        'ai-summary-cleansing-platform'
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