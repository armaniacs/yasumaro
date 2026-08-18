/**
 * aiSummaryCleansingSettingsV2.ts
 * AI要約クレンジング設定の管理（V2 — 後方互換のためV1は削除済み）
 */

import { StorageKeys, getSettings, saveSettings } from '../../utils/storage.js';
import { logError, ErrorCode } from '../../utils/logger.js';
import { CLEANSING_RULES, type CleansingRule } from '../../utils/aiSummaryCleaner/rules.js';

/**
 * Rule key -> checkbox element id, e.g. `jsonLd` -> `ai-summary-cleansing-json-ld`.
 *
 * Kept separate from CLEANSING_RULES (rather than adding an `htmlId` field
 * there) because that table is also imported by the content script bundle,
 * which has no use for dashboard DOM ids.
 *
 * This map is the single place that ties a rule to its checkbox; the
 * settings type, get/save/apply/read functions, the disable-toggle, and the
 * event-listener id list below are all derived from it instead of each
 * restating the same 32 ids by hand.
 */
function ruleHtmlId(rule: CleansingRule): string {
    return `ai-summary-cleansing-${rule.key.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}`;
}

function ruleOptionKey(rule: CleansingRule): string {
    return `${rule.key}Enabled`;
}

/**
 * AI要約クレンジング設定
 */
export interface AiSummaryCleansingSettings {
    enabled: boolean;
    // The 32 per-rule flags below are declared individually (not via a
    // mapped type over CLEANSING_RULES) so callers keep named, autocompleted
    // properties — see getAiSummaryCleansingSettings for how they are filled.
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
    fixedEnabled: boolean;
    recommendEnabled: boolean;
    paginationEnabled: boolean;
    snsPromoEnabled: boolean;
    popupEnabled: boolean;
    platformEnabled: boolean;
    textDensityEnabled: boolean;
    shortSeqEnabled: boolean;
    symbolLineEnabled: boolean;
    linkParaEnabled: boolean;
    linkRatioThreshold: number;       // リンク密度閾値（デフォルト: 70）
    shortTextThreshold: number;       // 短文閾値文字数（デフォルト: 30）
    shortSeqCount: number;            // 短文連続数閾値（デフォルト: 5）
    linkParaThreshold: number;        // リンクのみ段落閾値（デフォルト: 50）
    enhancedHiddenEnabled: boolean;
    emptyElemEnabled: boolean;
    jpLayoutEnabled: boolean;
    jpNavigationEnabled: boolean;
    authorEnabled: boolean;
    affiliateEnabled: boolean;
    speechBubbleEnabled: boolean;
    newsMediaEnabled: boolean;
    ecSiteEnabled: boolean;
    qaSiteEnabled: boolean;
    videoSiteEnabled: boolean;
    // Domain Whitelist Extraction Mode
    whitelistExtractionEnabled: boolean; // ホワイトリスト抽出モード（デフォルト: true）
    // Body protection settings
    bodyProtectionEnabled: boolean;  // 本文保護機能（デフォルト：true）
    bodyProtectionThreshold: number; // 本文スコア閾値（デフォルト：200）
    // Over-cleansed fallback settings
    fallbackRatio: number;           // 過剰削減フォールバック比率閾値（デフォルト: 0.20）
    fallbackMinBytes: number;        // 過剰削減フォールバック絶対量閾値（デフォルト: 300）
}

/**
 * AI要約クレンジング設定を取得
 * @returns AI要約クレンジング設定
 */
export async function getAiSummaryCleansingSettings(): Promise<AiSummaryCleansingSettings> {
    const settings = await getSettings();

    // The 32 rule flags, derived from CLEANSING_RULES.defaultEnabled instead
    // of restating each fallback. Two of these (enhancedHidden/emptyElem) had
    // drifted to `?? true` here while CLEANSING_RULES / DEFAULT_SETTINGS both
    // say false; that only mattered when getSettings() omitted the key (it
    // never does in production, since it merges DEFAULT_SETTINGS), so this
    // fixes a latent inconsistency without changing observed behaviour — see
    // pbi/2026-08-09-20.
    const ruleFlags: Record<string, boolean> = Object.fromEntries(
        CLEANSING_RULES.map(rule => [
            ruleOptionKey(rule),
            ((settings as Record<string, unknown>)[rule.storageKey] as boolean | undefined) ?? rule.defaultEnabled,
        ]),
    );

    return {
        enabled: settings[StorageKeys.AI_SUMMARY_CLEANSING_ENABLED] ?? true,
        ...ruleFlags,
        linkRatioThreshold: settings[StorageKeys.AI_SUMMARY_CLEANSING_LINK_RATIO_THRESHOLD] ?? 70,
        shortTextThreshold: settings[StorageKeys.AI_SUMMARY_CLEANSING_SHORT_TEXT_THRESHOLD] ?? 30,
        shortSeqCount: settings[StorageKeys.AI_SUMMARY_CLEANSING_SHORT_SEQ_COUNT] ?? 5,
        linkParaThreshold: settings[StorageKeys.AI_SUMMARY_CLEANSING_LINK_PARA_THRESHOLD] ?? 50,
        whitelistExtractionEnabled: settings[StorageKeys.WHITELIST_EXTRACTION_ENABLED] ?? true,
        // Body protection
        bodyProtectionEnabled: settings[StorageKeys.AI_SUMMARY_CLEANSING_BODY_PROTECTION_ENABLED] ?? true,
        bodyProtectionThreshold: settings[StorageKeys.AI_SUMMARY_CLEANSING_BODY_PROTECTION_THRESHOLD] ?? 200,
        // Over-cleansed fallback
        fallbackRatio: settings[StorageKeys.AI_SUMMARY_CLEANSING_FALLBACK_RATIO] ?? 0.20,
        fallbackMinBytes: settings[StorageKeys.AI_SUMMARY_CLEANSING_FALLBACK_MIN_BYTES] ?? 300
    } as AiSummaryCleansingSettings;
}

/**
 * AI要約クレンジング設定を保存
 * @param settings AI要約クレンジング設定
 */
export async function saveAiSummaryCleansingSettings(settings: AiSummaryCleansingSettings): Promise<void> {
    const currentSettings = await getSettings();
    currentSettings[StorageKeys.AI_SUMMARY_CLEANSING_ENABLED] = settings.enabled;
    for (const rule of CLEANSING_RULES) {
        (currentSettings as Record<string, boolean>)[rule.storageKey] =
        // WHY: dynamic property access on settings object; rule keys are generated at runtime
        (settings as unknown as Record<string, boolean>)[ruleOptionKey(rule)] ?? false;
    }
    currentSettings[StorageKeys.AI_SUMMARY_CLEANSING_LINK_RATIO_THRESHOLD] = settings.linkRatioThreshold;
    currentSettings[StorageKeys.AI_SUMMARY_CLEANSING_SHORT_TEXT_THRESHOLD] = settings.shortTextThreshold;
    currentSettings[StorageKeys.AI_SUMMARY_CLEANSING_SHORT_SEQ_COUNT] = settings.shortSeqCount;
    currentSettings[StorageKeys.AI_SUMMARY_CLEANSING_LINK_PARA_THRESHOLD] = settings.linkParaThreshold;
    currentSettings[StorageKeys.WHITELIST_EXTRACTION_ENABLED] = settings.whitelistExtractionEnabled;
    currentSettings[StorageKeys.AI_SUMMARY_CLEANSING_BODY_PROTECTION_ENABLED] = settings.bodyProtectionEnabled;
    currentSettings[StorageKeys.AI_SUMMARY_CLEANSING_BODY_PROTECTION_THRESHOLD] = settings.bodyProtectionThreshold;
    currentSettings[StorageKeys.AI_SUMMARY_CLEANSING_FALLBACK_RATIO] = settings.fallbackRatio;
    currentSettings[StorageKeys.AI_SUMMARY_CLEANSING_FALLBACK_MIN_BYTES] = settings.fallbackMinBytes;
    await saveSettings(currentSettings);
}

/**
 * AI要約クレンジング設定をUIに反映
 * @param settings AI要約クレンジング設定
 */
export function applyAiSummaryCleansingSettingsToUI(settings: AiSummaryCleansingSettings): void {
    const enabledCheckbox = document.getElementById('ai-summary-cleansing-enabled') as HTMLInputElement;
    const whitelistExtractionCheckbox = document.getElementById('whitelist-extraction-enabled') as HTMLInputElement;
    const bodyProtectionEnabledCheckbox = document.getElementById('ai-summary-cleansing-body-protection-enabled') as HTMLInputElement;
    const bodyProtectionThresholdSlider = document.getElementById('ai-summary-cleansing-body-protection-threshold') as HTMLInputElement;
    const bodyProtectionThresholdValue = document.getElementById('ai-summary-cleansing-body-protection-threshold-value') as HTMLSpanElement;
    // Over-cleansed fallback UI elements
    const fallbackRatioSlider = document.getElementById('ai-summary-cleansing-fallback-ratio') as HTMLInputElement;
    const fallbackRatioValue = document.getElementById('ai-summary-cleansing-fallback-ratio-value') as HTMLSpanElement;
    const fallbackMinBytesSlider = document.getElementById('ai-summary-cleansing-fallback-min-bytes') as HTMLInputElement;
    const fallbackMinBytesValue = document.getElementById('ai-summary-cleansing-fallback-min-bytes-value') as HTMLSpanElement;

    if (enabledCheckbox) enabledCheckbox.checked = settings.enabled;
    // The 32 rule checkboxes are looked up and set from CLEANSING_RULES via
    // ruleHtmlId()/ruleOptionKey() instead of 32 named lookups + 32 assignments.
    for (const rule of CLEANSING_RULES) {
        const checkbox = document.getElementById(ruleHtmlId(rule)) as HTMLInputElement | null;
        // WHY: dynamic property access on settings object; rule keys are generated at runtime
        if (checkbox) checkbox.checked = (settings as unknown as Record<string, boolean>)[ruleOptionKey(rule)] ?? false;
    }
    if (whitelistExtractionCheckbox) whitelistExtractionCheckbox.checked = settings.whitelistExtractionEnabled;
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

    // Over-cleansed fallback thresholds
    if (fallbackRatioSlider) {
        const ratioPercent = Math.round(settings.fallbackRatio * 100);
        fallbackRatioSlider.value = ratioPercent.toString();
        if (fallbackRatioValue) fallbackRatioValue.textContent = ratioPercent.toString();
    }
    if (fallbackMinBytesSlider) {
        fallbackMinBytesSlider.value = settings.fallbackMinBytes.toString();
        if (fallbackMinBytesValue) fallbackMinBytesValue.textContent = settings.fallbackMinBytes.toString();
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

    // The 32 rule flags: a missing checkbox falls back to newUserDefault, not
    // defaultEnabled — this mirrors getAiSummaryCleansingSettings(), which
    // reads storage the same way. Both describe "no value present yet".
    const ruleFlags: Record<string, boolean> = Object.fromEntries(
        CLEANSING_RULES.map(rule => [
            ruleOptionKey(rule),
            (document.getElementById(ruleHtmlId(rule)) as HTMLInputElement | null)?.checked ?? rule.newUserDefault,
        ]),
    );

    return {
        enabled: enabledCheckbox?.checked ?? true,
        ...ruleFlags,
        linkRatioThreshold: parseInt((document.getElementById('ai-summary-cleansing-link-ratio-threshold') as HTMLInputElement)?.value || '70', 10),
        shortTextThreshold: parseInt((document.getElementById('ai-summary-cleansing-short-text-threshold') as HTMLInputElement)?.value || '30', 10),
        shortSeqCount: parseInt((document.getElementById('ai-summary-cleansing-short-seq-count') as HTMLInputElement)?.value || '5', 10),
        linkParaThreshold: parseInt((document.getElementById('ai-summary-cleansing-link-para-threshold') as HTMLInputElement)?.value || '50', 10),
        whitelistExtractionEnabled: (document.getElementById('whitelist-extraction-enabled') as HTMLInputElement)?.checked ?? true,
        bodyProtectionEnabled: (document.getElementById('ai-summary-cleansing-body-protection-enabled') as HTMLInputElement)?.checked ?? true,
        bodyProtectionThreshold: parseInt((document.getElementById('ai-summary-cleansing-body-protection-threshold') as HTMLInputElement)?.value || '200', 10),
        fallbackRatio: parseInt((document.getElementById('ai-summary-cleansing-fallback-ratio') as HTMLInputElement)?.value || '20', 10) / 100,
        fallbackMinBytes: parseInt((document.getElementById('ai-summary-cleansing-fallback-min-bytes') as HTMLInputElement)?.value || '300', 10)
    } as AiSummaryCleansingSettings;
}

/**
 * AI要約クレンジングチェックボックスの状態を更新
 * @param enabled AI要約クレンジングが有効かどうか
 */
export function updateAiSummaryCleansingCheckboxStates(enabled: boolean): void {
    const _fieldset = document.getElementById('aiSummaryCleansingFieldset') as HTMLFieldSetElement;
    const whitelistExtractionCheckbox = document.getElementById('whitelist-extraction-enabled') as HTMLInputElement;

    // fieldset.disabled = !enabled; // Do not disable fieldset as it contains the main toggle checkbox

    for (const rule of CLEANSING_RULES) {
        const checkbox = document.getElementById(ruleHtmlId(rule)) as HTMLInputElement | null;
        if (checkbox) checkbox.disabled = !enabled;
    }
    if (whitelistExtractionCheckbox) whitelistExtractionCheckbox.disabled = !enabled;
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
        ...CLEANSING_RULES.map(ruleHtmlId),
        // Domain Whitelist Extraction Mode
        'whitelist-extraction-enabled'
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