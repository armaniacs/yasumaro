/**
 * 設定保存と接続テストモジュール
 * 設定の保存と保存後の接続テストを行う
 */

import { saveSettingsWithAllowedUrls, getSettings, Settings } from '../../utils/storage.js';
import { extractSettingsFromInputs } from '../settingsUiHelper.js';
import { getMessage } from '../i18n.js';
import { clearAllFieldErrors, validateAllFields, ErrorPair } from './fieldValidation.js';

interface ConnectionTestResult {
    obsidianSuccess: boolean;
    obsidianMessage: string;
    aiSuccess: boolean;
    aiMessage: string;
}

interface TestResponse {
    obsidian?: { success: boolean; message: string };
    ai?: { success: boolean; message: string };
}

/**
 * 接続テストを実行
 * @returns {Promise<ConnectionTestResult>} テスト結果
 */
async function runConnectionTest(): Promise<ConnectionTestResult> {
    const testResult = await chrome.runtime.sendMessage({
        type: 'TEST_CONNECTIONS',
        payload: {}
    }) as TestResponse;

    const obsidianResult = testResult?.obsidian || { success: false, message: 'No response' };
    const aiResult = testResult?.ai || { success: false, message: 'No response' };

    return {
        obsidianSuccess: obsidianResult.success,
        obsidianMessage: obsidianResult.message,
        aiSuccess: aiResult.success,
        aiMessage: aiResult.message
    };
}

/**
 * HTTPS自己署名証明書の警告リンクを追加
 * @param {HTMLElement} statusDiv - ステータス表示要素
 * @param {number} port - ポート番号
 */
function addCertificateWarning(statusDiv: HTMLElement, port: number): void {
    const url = `https://127.0.0.1:${port}/`;
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.textContent = getMessage('acceptCertificate');
    link.rel = 'noopener noreferrer';

    statusDiv.appendChild(document.createElement('br'));
    statusDiv.appendChild(link);
}

/**
 * 接続テスト結果を表示
 * @param {HTMLElement} statusDiv - ステータス表示要素
 * @param {ConnectionTestResult} result - テスト結果
 * @param {HTMLInputElement} protocolInput - プロトコル入力
 * @param {number} port - ポート番号
 */
function displayConnectionResult(statusDiv: HTMLElement, result: ConnectionTestResult, protocolInput: HTMLInputElement, port: number): void {
    const { obsidianSuccess, obsidianMessage, aiSuccess, aiMessage } = result;

    // ステータスエリアをクリア
    statusDiv.innerHTML = '';

    // Obsidian接続結果
    const obsidianStatus = document.createElement('div');
    obsidianStatus.style.marginBottom = '8px';
    const obsidianLabel = document.createElement('strong');
    obsidianLabel.textContent = '📦 Obsidian: ';
    obsidianStatus.appendChild(obsidianLabel);

    const obsidianResult = document.createElement('span');
    if (obsidianSuccess) {
        obsidianResult.textContent = '✅ ' + getMessage('connectionSuccess');
        obsidianResult.style.color = '#2E7D32';
    } else {
        obsidianResult.textContent = '❌ ' + obsidianMessage;
        obsidianResult.style.color = '#D32F2F';
    }
    obsidianStatus.appendChild(obsidianResult);
    statusDiv.appendChild(obsidianStatus);

    // HTTPS証明書警告の追加
    if (!obsidianSuccess && obsidianMessage.includes('Failed to fetch') && protocolInput.value === 'https') {
        addCertificateWarning(statusDiv, port);
    }

    // AI接続結果
    const aiStatus = document.createElement('div');
    aiStatus.style.marginBottom = '8px';
    const aiLabel = document.createElement('strong');
    aiLabel.textContent = '🤖 AI: ';
    aiStatus.appendChild(aiLabel);

    const aiResult = document.createElement('span');
    if (aiSuccess) {
        aiResult.textContent = '✅ ' + getMessage('connectionSuccess');
        aiResult.style.color = '#2E7D32';
    } else {
        aiResult.textContent = '❌ ' + aiMessage;
        aiResult.style.color = '#D32F2F';
    }
    aiStatus.appendChild(aiResult);
    statusDiv.appendChild(aiStatus);

    // 全体のステータスクラスを設定
    if (obsidianSuccess && aiSuccess) {
        statusDiv.className = 'success';
    } else {
        statusDiv.className = 'error';
    }
}

/**
 * 設定保存ボタンクリックハンドラ
 * @param {HTMLElement} statusDiv - ステータス表示要素
 * @param {HTMLInputElement} protocolInput - プロトコル入力
 * @param {HTMLInputElement} portInput - ポート入力
 * @param {HTMLInputElement} minVisitDurationInput - 最小訪問時間入力
 * @param {HTMLInputElement} minScrollDepthInput - 最小スクロール深度入力
 * @param {Record<string, HTMLInputElement | HTMLSelectElement>} settingsMapping - 設定マッピング
 * @param {Function} validateFn - バリデーション関数
 * @returns {Promise<void>}
 */
export async function handleSaveAndTest(
    statusDiv: HTMLElement,
    protocolInput: HTMLInputElement,
    portInput: HTMLInputElement,
    minVisitDurationInput: HTMLInputElement,
    minScrollDepthInput: HTMLInputElement,
    settingsMapping: Record<string, HTMLInputElement | HTMLSelectElement>,
    validateFn: (p1: HTMLInputElement, p2: HTMLInputElement, p3: HTMLInputElement, p4: HTMLInputElement) => boolean
): Promise<void> {
    statusDiv.textContent = getMessage('testingConnection');
    statusDiv.className = '';

    const errorPairs: ErrorPair[] = [
        [protocolInput, 'protocolError'],
        [portInput, 'portError'],
        [minVisitDurationInput, 'minVisitDurationError'],
        [minScrollDepthInput, 'minScrollDepthError']
    ];
    clearAllFieldErrors(errorPairs);

    if (!validateFn(protocolInput, portInput, minVisitDurationInput, minScrollDepthInput)) {
        statusDiv.textContent = '';
        statusDiv.className = '';
        return;
    }

    const newSettings = extractSettingsFromInputs(settingsMapping);
    console.log('[SettingsSaver] Extracted settings:', {
        hasObsidianKey: !!newSettings['obsidian_api_key'],
        hasGeminiKey: !!newSettings['gemini_api_key'],
        hasOpenaiKey: !!newSettings['openai_api_key']
    });

    // 既存の設定を取得して、空のAPIキーフィールドは既存の値を保持
    const currentSettings = await getSettings();
    console.log('[SettingsSaver] Current settings from storage:', {
        hasObsidianKey: !!currentSettings['obsidian_api_key'],
        obsidianKeyLength: (typeof currentSettings['obsidian_api_key'] === 'string' ? currentSettings['obsidian_api_key'].length : 0),
        hasGeminiKey: !!currentSettings['gemini_api_key'],
        hasOpenaiKey: !!currentSettings['openai_api_key']
    });

    const mergedSettings = { ...currentSettings, ...newSettings };
    console.log('[SettingsSaver] Merged with current settings:', {
        hasObsidianKey: !!mergedSettings['obsidian_api_key'],
        obsidianKeyLength: (typeof mergedSettings['obsidian_api_key'] === 'string' ? mergedSettings['obsidian_api_key'].length : 0),
        hasGeminiKey: !!mergedSettings['gemini_api_key'],
        hasOpenaiKey: !!mergedSettings['openai_api_key']
    });

    await saveSettingsWithAllowedUrls(mergedSettings);
    console.log('[SettingsSaver] Settings saved successfully');

    // 設定が完全に保存されるまで少し待つ
    await new Promise(resolve => setTimeout(resolve, 100));

    // 保存後の確認
    const verifySettings = await getSettings();
    console.log('[SettingsSaver] Verification after save:', {
        hasObsidianKey: !!verifySettings['obsidian_api_key'],
        obsidianKeyLength: (typeof verifySettings['obsidian_api_key'] === 'string' ? verifySettings['obsidian_api_key'].length : 0),
        obsidianKeyType: typeof verifySettings['obsidian_api_key'],
        hasGeminiKey: !!verifySettings['gemini_api_key'],
        hasOpenaiKey: !!verifySettings['openai_api_key']
    });

    const port = parseInt(portInput.value.trim(), 10);
    console.log('[SettingsSaver] Running connection test...');
    const result = await runConnectionTest();
    console.log('[SettingsSaver] Connection test result:', result);
    displayConnectionResult(statusDiv, result, protocolInput, port);
}

/**
 * 保存ボタンにクリックイベントリスナーを設定
 * @param {HTMLButtonElement} saveBtn - 保存ボタン
 * @param {HTMLElement} statusDiv - ステータス表示要素
 * @param {HTMLInputElement} protocolInput - プロトコル入力
 * @param {HTMLInputElement} portInput - ポート入力
 * @param {HTMLInputElement} minVisitDurationInput - 最小訪問時間入力
 * @param {HTMLInputElement} minScrollDepthInput - 最小スクロール深度入力
 * @param {Record<string, HTMLInputElement | HTMLSelectElement>} settingsMapping - 設定マッピング
 * @returns {() => void} リスナー削除関数
 */
export function setupSaveButtonListener(
    saveBtn: HTMLButtonElement,
    statusDiv: HTMLElement,
    protocolInput: HTMLInputElement,
    portInput: HTMLInputElement,
    minVisitDurationInput: HTMLInputElement,
    minScrollDepthInput: HTMLInputElement,
    settingsMapping: Record<string, HTMLInputElement | HTMLSelectElement>
): () => void {
    const handler = async () => {
        await handleSaveAndTest(
            statusDiv,
            protocolInput,
            portInput,
            minVisitDurationInput,
            minScrollDepthInput,
            settingsMapping,
            (p1, p2, p3, p4) => {
                // デフォルトバリデーション
                return validateAllFields(p1, p2, p3, p4);
            }
        );
    };

    saveBtn.addEventListener('click', handler);
    return () => saveBtn.removeEventListener('click', handler);
}