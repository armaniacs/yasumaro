/**
 * aiSummaryCleansingSettingsV2.ts
 * AI要約クレンジング設定の管理（V2 — 後方互換のためV1は削除済み）
 */

import { settingsRepository } from '../../utils/storage/SettingsRepository.js';
import { StorageKeys } from '../../utils/storage/types.js';
import { ErrorCode } from '../../utils/logger/types.js';
import { logError } from '../../utils/logger/api.js';
import { getMessageOr } from '../../utils/i18n.js';
import { CLEANSING_RULES, type CleansingRule } from '../../utils/aiSummaryCleaner/rules.js';
import { type RuleKey } from '../../utils/aiSummaryCleaner/types.js';
import { type PresetId } from '../../utils/aiSummaryCleaner/presets.js';
import { createCleansingPresetStore } from './cleansingPresetStore.js';

// The preset store owns the ordering constraints (apply epoch, dual write,
// busy windows) that used to leak into this file's module state. migrateTo
// Preset/detectPreset moved there too — re-exported for backward compat.
export { migrateToPreset, detectPreset } from './cleansingPresetStore.js';

export const presetStore = createCleansingPresetStore();
// Guard window: module load → setup + 300ms (replaces _initialRenderGuard).
presetStore.holdBusy();

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

// ---------------------------------------------------------------------------
// Preset handling — 32トグルの view として機能、保存形式は壊さない。
// 順序制約（epoch・二重書き込み・busy 窓）は cleansingPresetStore.ts が所有。
// ---------------------------------------------------------------------------

/**
 * 初回起動時に cleansing_preset がなければ migrate して保存。
 * 順序制約（epoch・再チェック・busy 窓）は cleansingPresetStore が所有。
 */
export async function ensureCleansingPresetMigrated(): Promise<void> {
    await presetStore.ensureMigrated();
}

/**
 * プリセットを適用: PRESETS[presetId] の値で 32値と preset キーを更新し、UI を反映。
 * 反映（applyToUI + select 同期）は busy 窓の中で runReflecting 経由で行う。
 */
export async function applyPreset(presetId: PresetId): Promise<void> {
    await presetStore.runReflecting(async () => {
        await presetStore.applyPreset(presetId);
        const settings = await getAiSummaryCleansingSettings();
        applyAiSummaryCleansingSettingsToUI(settings);
    });
}

/**
 * 手動トグルで custom へ遷移（busy 窓中はスキップ — ガードは store 内部）
 */
async function switchToCustomIfNeeded(): Promise<void> {
    await presetStore.markCustomOnManualEdit();
}

/**
 * AI要約クレンジング設定 — RuleKey から導出する mapped type で SSOT 化
 * 手書き列挙ではなく CLEANSING_RULES の key から自動導出するため、ルール追加で型が自動追従する
 */
export type AiSummaryCleansingSettings = {
    enabled: boolean;
} & {
    [K in RuleKey as `${K}Enabled`]: boolean;
} & {
    linkRatioThreshold: number;       // リンク密度閾値（デフォルト: 70）
    shortTextThreshold: number;       // 短文閾値文字数（デフォルト: 30）
    shortSeqCount: number;            // 短文連続数閾値（デフォルト: 5）
    linkParaThreshold: number;        // リンクのみ段落閾値（デフォルト: 50）
    // Domain Whitelist Extraction Mode
    whitelistExtractionEnabled: boolean; // ホワイトリスト抽出モード（デフォルト: true）
    // Body protection settings
    bodyProtectionEnabled: boolean;  // 本文保護機能（デフォルト：true）
    bodyProtectionThreshold: number; // 本文スコア閾値（デフォルト：200）
    // Over-cleansed fallback settings
    fallbackRatio: number;           // 過剰削減フォールバック比率閾値（デフォルト: 0.20）
    fallbackMinBytes: number;        // 過剰削減フォールバック絶対量閾値（デフォルト: 300）
    // PBI 05 overcut guards
    fallbackMinChars: number;        // ①②絶対量閾値（文字数・デフォルト: 100）
    candidateGuardEnabled: boolean;  // ①候補選択フロアガード（デフォルト: true）
    cleanseGuardEnabled: boolean;    // ②Content Cleansing過剰削減ガード（デフォルト: true）
};

/**
 * AI要約クレンジング設定を取得
 * @returns AI要約クレンジング設定
 */
export async function getAiSummaryCleansingSettings(): Promise<AiSummaryCleansingSettings> {
    const settings = await settingsRepository.getAll();

    // The 32 rule flags, derived from CLEANSING_RULES.defaultEnabled instead
    // of restating each fallback. Two of these (enhancedHidden/emptyElem) had
    // drifted to `?? true` here while CLEANSING_RULES / DEFAULT_SETTINGS both
    // say false; that only mattered when settingsRepository.getAll() omitted the key (it
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
        fallbackMinBytes: settings[StorageKeys.AI_SUMMARY_CLEANSING_FALLBACK_MIN_BYTES] ?? 300,
        // PBI 05 overcut guards
        fallbackMinChars: settings[StorageKeys.AI_SUMMARY_CLEANSING_FALLBACK_MIN_CHARS] ?? 100,
        candidateGuardEnabled: settings[StorageKeys.EXTRACTION_GUARD_CANDIDATE_ENABLED] ?? true,
        cleanseGuardEnabled: settings[StorageKeys.EXTRACTION_GUARD_CONTENT_CLEANSE_ENABLED] ?? true
    } as AiSummaryCleansingSettings;
}

/**
 * AI要約クレンジング設定を保存
 * @param settings AI要約クレンジング設定
 */
export async function saveAiSummaryCleansingSettings(settings: AiSummaryCleansingSettings): Promise<void> {
    const currentSettings = await settingsRepository.getAll();
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
    // PBI 05 overcut guards
    currentSettings[StorageKeys.AI_SUMMARY_CLEANSING_FALLBACK_MIN_CHARS] = settings.fallbackMinChars;
    currentSettings[StorageKeys.EXTRACTION_GUARD_CANDIDATE_ENABLED] = settings.candidateGuardEnabled;
    currentSettings[StorageKeys.EXTRACTION_GUARD_CONTENT_CLEANSE_ENABLED] = settings.cleanseGuardEnabled;
    await settingsRepository.setAll(currentSettings);
}

/**
 * AI要約クレンジング設定をUIに反映
 * @param settings AI要約クレンジング設定
 */
export function applyAiSummaryCleansingSettingsToUI(settings: AiSummaryCleansingSettings): void {
    // UI 反映は busy 窓の中で行う（presetStore.runReflecting 経由の呼び出し
    // では窓が延長され、直打ちの呼び出しでも窓が開く — 旧 _isApplyingPreset 相当）。
    // Guard window: presetStore.holdBusy() at module scope covers module load →
    // setup + 300ms; callers use presetStore.runReflecting for scoped windows.
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
    // PBI 05 overcut guard UI elements
    const fallbackMinCharsSlider = document.getElementById('ai-summary-cleansing-fallback-min-chars') as HTMLInputElement;
    const fallbackMinCharsValue = document.getElementById('ai-summary-cleansing-fallback-min-chars-value') as HTMLSpanElement;
    const guardCandidateCheckbox = document.getElementById('extraction-guard-candidate-enabled') as HTMLInputElement;
    const guardCleanseCheckbox = document.getElementById('extraction-guard-content-cleanse-enabled') as HTMLInputElement;

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
    // PBI 05 overcut guards
    if (fallbackMinCharsSlider) {
        fallbackMinCharsSlider.value = settings.fallbackMinChars.toString();
        if (fallbackMinCharsValue) fallbackMinCharsValue.textContent = settings.fallbackMinChars.toString();
    }
    if (guardCandidateCheckbox) guardCandidateCheckbox.checked = settings.candidateGuardEnabled;
    if (guardCleanseCheckbox) guardCleanseCheckbox.checked = settings.cleanseGuardEnabled;

    // 有効/無効に応じて子チェックボックスの状態を更新
    updateAiSummaryCleansingCheckboxStates(settings.enabled);

    // サブグループの表示/非表示を初期化
    const subGroup = document.getElementById('aiSummaryCleansingSubGroup') as HTMLElement;
    if (subGroup) {
        subGroup.style.display = settings.enabled ? 'block' : 'none';
    }

    // The select's initial value is restored by the wiring block below; callers
    // that change the preset set select.value explicitly. The busy window is
    // closed by presetStore.runReflecting's finally (replaces the setTimeout
    // guards that used to clear _isApplyingPreset/_initialRenderGuard here).
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
        fallbackMinBytes: parseInt((document.getElementById('ai-summary-cleansing-fallback-min-bytes') as HTMLInputElement)?.value || '300', 10),
        // PBI 05 overcut guards
        fallbackMinChars: parseInt((document.getElementById('ai-summary-cleansing-fallback-min-chars') as HTMLInputElement)?.value || '100', 10),
        candidateGuardEnabled: (document.getElementById('extraction-guard-candidate-enabled') as HTMLInputElement)?.checked ?? true,
        cleanseGuardEnabled: (document.getElementById('extraction-guard-content-cleanse-enabled') as HTMLInputElement)?.checked ?? true
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

    // プリセットセレクトのイベント
    const presetSelect = document.getElementById('cleansing-preset') as HTMLSelectElement | null;
    if (presetSelect) {
        // 初期値をストレージから復元。復元完了まで disabled にする —
        // 復元前のユーザー選択を後から来た古い値で上書きする競合を防ぐ。
        presetSelect.disabled = true;
        void (async () => {
            try {
                presetSelect.value = await presetStore.getPreset();
            } catch {
                // fall through to enabling the select below
            } finally {
                presetSelect.disabled = false;
            }
        })();
        presetSelect.addEventListener('change', async (e) => {
            const pid = (e.target as HTMLSelectElement).value as PresetId;
            // UI 反映（applyToUI + select 同期）を busy 窓の中で実行 —
            // 反映中の checkbox change が custom 遷移を起こさないようガードする。
            await presetStore.runReflecting(async () => {
                await presetStore.applyPreset(pid);
                const settings = await getAiSummaryCleansingSettings();
                applyAiSummaryCleansingSettingsToUI(settings);
            });
        });
        // プリセット変更を select に反映（store 購読 — 手動 custom 遷移もカバー）
        presetStore.subscribe((pid) => { presetSelect.value = pid; });
    } else {
        // select がない環境でもマイグレーションは実行
        void presetStore.ensureMigrated();
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
                await switchToCustomIfNeeded();
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

    // PBI 05 overcut guard checkboxes (live-save like body protection;
    // NOT preset-rule edits → no switchToCustomIfNeeded)
    const guardIds = [
        'extraction-guard-candidate-enabled',
        'extraction-guard-content-cleanse-enabled'
    ];
    for (const id of guardIds) {
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
        { id: 'popup-body-protection-threshold', valId: 'popup-body-protection-threshold-value' },
        // PBI 05 char floor
        { id: 'ai-summary-cleansing-fallback-min-chars', valId: 'ai-summary-cleansing-fallback-min-chars-value' }
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

    // 初期描画窓の解除（preset適用直後の checkbox 変更は custom にしない —
    // 旧 _initialRenderGuard の 300ms 相当。presetStore.holdBusy() と対になる）
    presetStore.releaseInitialRenderWindow();

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
                    statusElement.textContent = getMessageOr('settingsSaved', '設定を保存しました');
                    statusElement.className = 'status-message success';
                    setTimeout(() => {
                        statusElement.textContent = '';
                        statusElement.className = 'status-message';
                    }, 3000);
                }
            } catch (error) {
                logError('Failed to save AI summary cleansing settings', { cause: error }, ErrorCode.STORAGE_WRITE_FAILURE);
                if (statusElement) {
                    statusElement.textContent = getMessageOr('settingsSaveError', '設定の保存に失敗しました');
                    statusElement.className = 'status-message error';
                }
            }
        });
    }
}