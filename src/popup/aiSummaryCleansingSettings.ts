/**
 * aiSummaryCleansingSettings.ts
 * AI要約クレンジング設定の管理
 */

import { StorageKeys, getSettings, saveSettings } from '../utils/storage.js';

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
        deepEnabled: settings[StorageKeys.AI_SUMMARY_CLEANSING_DEEP] ?? false
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

    if (enabledCheckbox) enabledCheckbox.checked = settings.enabled;
    if (altCheckbox) altCheckbox.checked = settings.altEnabled;
    if (metadataCheckbox) metadataCheckbox.checked = settings.metadataEnabled;
    if (adsCheckbox) adsCheckbox.checked = settings.adsEnabled;
    if (navCheckbox) navCheckbox.checked = settings.navEnabled;
    if (socialCheckbox) socialCheckbox.checked = settings.socialEnabled;
    if (deepCheckbox) deepCheckbox.checked = settings.deepEnabled;

    // 有効/無効に応じて子チェックボックスの状態を更新
    updateAiSummaryCleansingCheckboxStates(settings.enabled);
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

    return {
        enabled: enabledCheckbox?.checked ?? true,
        altEnabled: altCheckbox?.checked ?? true,
        metadataEnabled: metadataCheckbox?.checked ?? true,
        adsEnabled: adsCheckbox?.checked ?? true,
        navEnabled: navCheckbox?.checked ?? true,
        socialEnabled: socialCheckbox?.checked ?? true,
        deepEnabled: deepCheckbox?.checked ?? false
    };
}

/**
 * AI要約クレンジングチェックボックスの状態を更新
 * @param enabled AI要約クレンジングが有効かどうか
 */
export function updateAiSummaryCleansingCheckboxStates(enabled: boolean): void {
    const altCheckbox = document.getElementById('ai-summary-cleansing-alt') as HTMLInputElement;
    const metadataCheckbox = document.getElementById('ai-summary-cleansing-metadata') as HTMLInputElement;
    const adsCheckbox = document.getElementById('ai-summary-cleansing-ads') as HTMLInputElement;
    const navCheckbox = document.getElementById('ai-summary-cleansing-nav') as HTMLInputElement;
    const socialCheckbox = document.getElementById('ai-summary-cleansing-social') as HTMLInputElement;
    const deepCheckbox = document.getElementById('ai-summary-cleansing-deep') as HTMLInputElement;

    if (altCheckbox) altCheckbox.disabled = !enabled;
    if (metadataCheckbox) metadataCheckbox.disabled = !enabled;
    if (adsCheckbox) adsCheckbox.disabled = !enabled;
    if (navCheckbox) navCheckbox.disabled = !enabled;
    if (socialCheckbox) socialCheckbox.disabled = !enabled;
    if (deepCheckbox) deepCheckbox.disabled = !enabled;
}

/**
 * AI要約クレンジング設定のイベントリスナーを設定
 */
export function setupAiSummaryCleansingEventListeners(): void {
    const enabledCheckbox = document.getElementById('ai-summary-cleansing-enabled') as HTMLInputElement;
    if (enabledCheckbox) {
        enabledCheckbox.addEventListener('change', async (e) => {
            const enabled = (e.target as HTMLInputElement).checked;
            updateAiSummaryCleansingCheckboxStates(enabled);
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
        'ai-summary-cleansing-deep'
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
                console.error('Failed to save AI summary cleansing settings:', error);
                if (statusElement) {
                    statusElement.textContent = chrome.i18n.getMessage('settingsSaveError') || '設定の保存に失敗しました';
                    statusElement.className = 'status-message error';
                }
            }
        });
    }
}