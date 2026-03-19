/**
 * contentSettings.ts
 * Content cleansing settings functionality for the dashboard UI.
 */

import { StorageKeys, saveSettings, getSettings } from '../utils/storage.js';
import { showStatus } from './settingsUiHelper.js';
import { getMessage } from './i18n.js';

// デフォルトキーワードリスト
const DEFAULT_KEYWORDS = ['balance', 'account', 'meisai', 'login', 'card-number', 'keiyaku', 'password', 'payment', 'transaction', 'billing', 'invoice', 'receipt', 'rireki', 'torihiki', 'zandaka', 'hoken', 'address'];

const saveBtn = document.getElementById('saveContentSettings');
const hardEnabledCheckbox = document.getElementById('contentStripHardEnabled') as HTMLInputElement | null;
const keywordEnabledCheckbox = document.getElementById('contentStripKeywordEnabled') as HTMLInputElement | null;
const keywordsTextarea = document.getElementById('contentStripKeywords') as HTMLTextAreaElement | null;
const resetBtn = document.getElementById('contentStripResetKeywords');

export async function loadContentSettings(): Promise<void> {
    const settings = await getSettings();

    // Hard Strip 有効化
    if (hardEnabledCheckbox) {
        hardEnabledCheckbox.checked = settings[StorageKeys.CONTENT_STRIP_HARD_ENABLED] !== false; // Default true
    }

    // Keyword Strip 有効化
    if (keywordEnabledCheckbox) {
        keywordEnabledCheckbox.checked = settings[StorageKeys.CONTENT_STRIP_KEYWORD_ENABLED] !== false; // Default true
    }

    // キーワードリスト
    if (keywordsTextarea) {
        const keywords = settings[StorageKeys.CONTENT_STRIP_KEYWORDS] || DEFAULT_KEYWORDS;
        keywordsTextarea.value = keywords.join('\n');
    }
}

async function saveContentSettings(): Promise<void> {
    try {
        const settings = await getSettings();

        // Hard Strip 有効化
        if (hardEnabledCheckbox) {
            settings[StorageKeys.CONTENT_STRIP_HARD_ENABLED] = hardEnabledCheckbox.checked;
        }

        // Keyword Strip 有効化
        if (keywordEnabledCheckbox) {
            settings[StorageKeys.CONTENT_STRIP_KEYWORD_ENABLED] = keywordEnabledCheckbox.checked;
        }

        // キーワードリスト
        if (keywordsTextarea) {
            const rawText = keywordsTextarea.value.trim();
            const keywords = rawText
                .split('\n')
                .map(k => k.trim())
                .filter(k => k.length > 0); // 空行を除外

            settings[StorageKeys.CONTENT_STRIP_KEYWORDS] = keywords.length > 0 ? keywords : DEFAULT_KEYWORDS;
        }

        // 設定を保存
        await saveSettings(settings);

        // 成功メッセージを表示
        showStatus('contentSettingsStatus', getMessage('settingsSaved') || '設定を保存しました', 'success');
    } catch (error: any) {
        console.error('[ContentSettings] Save error:', error);
        showStatus('contentSettingsStatus', getMessage('settingsSaveError') || '設定の保存に失敗しました', 'error');
    }
}

export function init(): void {
    // 保存ボタン
    if (saveBtn) {
        saveBtn.addEventListener('click', saveContentSettings);
    }

    // リセットボタン
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            // 全ての設定をデフォルトに戻す
            if (hardEnabledCheckbox) {
                hardEnabledCheckbox.checked = true; // Default: ON
            }
            if (keywordEnabledCheckbox) {
                keywordEnabledCheckbox.checked = true; // Default: ON
            }
            if (keywordsTextarea) {
                keywordsTextarea.value = DEFAULT_KEYWORDS.join('\n');
            }
            showStatus('contentSettingsStatus', getMessage('contentStripResetKeywords') || 'デフォルトに戻しました', 'success');
        });
    }

    // 設定をロード
    loadContentSettings();
}