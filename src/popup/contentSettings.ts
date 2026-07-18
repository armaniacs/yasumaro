/**
 * contentSettings.ts
 * Content cleansing settings functionality for the dashboard UI.
 */

import { StorageKeys, saveSettings, getSettings } from '../utils/storage.js';
import { errorMessage } from '../utils/errorUtils.js';
import { showStatus } from './settingsUiHelper.js';
import { getMessage } from '../utils/i18n.js';
import { logError, ErrorCode } from '../utils/logger.js';

// デフォルトキーワードリスト
const DEFAULT_KEYWORDS = ['balance', 'account', 'meisai', 'login', 'card-number', 'keiyaku', 'password', 'payment', 'transaction', 'billing', 'invoice', 'receipt', 'rireki', 'torihiki', 'zandaka', 'hoken', 'address'];

// DOM Elements (lazily resolved for testability)
function getSaveBtn(): HTMLElement | null { return document.getElementById('saveContentSettings'); }
function getHardEnabledCheckbox(): HTMLInputElement | null { return document.getElementById('contentStripHardEnabled') as HTMLInputElement; }
function getKeywordEnabledCheckbox(): HTMLInputElement | null { return document.getElementById('contentStripKeywordEnabled') as HTMLInputElement; }
function getKeywordsTextarea(): HTMLTextAreaElement | null { return document.getElementById('contentStripKeywords') as HTMLTextAreaElement; }
function getResetBtn(): HTMLElement | null { return document.getElementById('contentStripResetKeywords'); }
function getDedupEnabledCheckbox(): HTMLInputElement | null { return document.getElementById('content-dedup-enabled') as HTMLInputElement; }
function getDedupThresholdSlider(): HTMLInputElement | null { return document.getElementById('content-dedup-threshold') as HTMLInputElement; }
function getDedupThresholdValue(): HTMLElement | null { return document.getElementById('contentDedupThresholdValue'); }
function getNormalizeEnabledCheckbox(): HTMLInputElement | null { return document.getElementById('summary-normalize-enabled') as HTMLInputElement; }

export async function loadContentSettings(): Promise<void> {
    const settings = await getSettings();

    const hardCb = getHardEnabledCheckbox();
    const keywordCb = getKeywordEnabledCheckbox();
    const kwTextarea = getKeywordsTextarea();
    const dedupCb = getDedupEnabledCheckbox();
    const dedupSlider = getDedupThresholdSlider();
    const dedupValue = getDedupThresholdValue();
    const normCb = getNormalizeEnabledCheckbox();

    // Hard Strip 有効化
    if (hardCb) {
        hardCb.checked = settings[StorageKeys.CONTENT_STRIP_HARD_ENABLED] !== false; // Default true
    }

    // Keyword Strip 有効化
    if (keywordCb) {
        keywordCb.checked = settings[StorageKeys.CONTENT_STRIP_KEYWORD_ENABLED] !== false; // Default true
    }

    // キーワードリスト
    if (kwTextarea) {
        const keywords = settings[StorageKeys.CONTENT_STRIP_KEYWORDS] || DEFAULT_KEYWORDS;
        kwTextarea.value = keywords.join('\n');
    }

    // テキスト品質設定
    if (dedupCb) {
        dedupCb.checked = settings[StorageKeys.CONTENT_DEDUP_ENABLED] ?? true;
    }
    if (dedupSlider) {
        const threshold = String(settings[StorageKeys.CONTENT_DEDUP_THRESHOLD] ?? 0.7);
        dedupSlider.value = threshold;
        if (dedupValue) dedupValue.textContent = threshold;
    }
    if (normCb) {
        normCb.checked = settings[StorageKeys.SUMMARY_NORMALIZE_ENABLED] ?? true;
    }
}

async function saveContentSettings(): Promise<void> {
    try {
        const settings = await getSettings();

        const hardCb = getHardEnabledCheckbox();
        const keywordCb = getKeywordEnabledCheckbox();
        const kwTextarea = getKeywordsTextarea();

        // Hard Strip 有効化
        if (hardCb) {
            settings[StorageKeys.CONTENT_STRIP_HARD_ENABLED] = hardCb.checked;
        }

        // Keyword Strip 有効化
        if (keywordCb) {
            settings[StorageKeys.CONTENT_STRIP_KEYWORD_ENABLED] = keywordCb.checked;
        }

        // キーワードリスト
        if (kwTextarea) {
            const rawText = kwTextarea.value.trim();
            const keywords = rawText
                .split('\n')
                .map(k => k.trim())
                .filter(k => k.length > 0); // 空行を除外

            settings[StorageKeys.CONTENT_STRIP_KEYWORDS] = keywords.length > 0 ? keywords : DEFAULT_KEYWORDS;
        }

        // テキスト品質設定
        settings[StorageKeys.CONTENT_DEDUP_ENABLED] = getDedupEnabledCheckbox()?.checked ?? true;
        settings[StorageKeys.CONTENT_DEDUP_THRESHOLD] = parseFloat(getDedupThresholdSlider()?.value ?? '0.7');
        settings[StorageKeys.SUMMARY_NORMALIZE_ENABLED] = getNormalizeEnabledCheckbox()?.checked ?? true;

        // 設定を保存
        await saveSettings(settings);

        // 成功メッセージを表示
        showStatus('contentSettingsStatus', getMessage('settingsSaved') || '設定を保存しました', 'success');
    } catch (error: unknown) {
        logError('[ContentSettings] Save error', { cause: errorMessage(error) }, ErrorCode.STORAGE_WRITE_FAILURE);
        showStatus('contentSettingsStatus', getMessage('settingsSaveError') || '設定の保存に失敗しました', 'error');
    }
}

export function init(): void {
    const saveBtn = getSaveBtn();
    const resetBtn = getResetBtn();

    // 保存ボタン
    if (saveBtn) {
        saveBtn.addEventListener('click', saveContentSettings);
    }

    // リセットボタン
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            const hardCb = getHardEnabledCheckbox();
            const keywordCb = getKeywordEnabledCheckbox();
            const kwTextarea = getKeywordsTextarea();

            // 全ての設定をデフォルトに戻す
            if (hardCb) {
                hardCb.checked = true; // Default: ON
            }
            if (keywordCb) {
                keywordCb.checked = true; // Default: ON
            }
            if (kwTextarea) {
                kwTextarea.value = DEFAULT_KEYWORDS.join('\n');
            }
            showStatus('contentSettingsStatus', getMessage('contentStripResetKeywords') || 'デフォルトに戻しました', 'success');
        });
    }

    // スライダーのリアルタイム表示
    const dedupSlider = getDedupThresholdSlider();
    const dedupValue = getDedupThresholdValue();
    if (dedupSlider && dedupValue) {
        dedupSlider.addEventListener('input', () => {
            dedupValue.textContent = dedupSlider.value;
        });
    }

    // 設定をロード
    loadContentSettings();
}