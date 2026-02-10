/**
 * 設定保存と接続テストモジュール
 * 設定の保存と保存後の接続テストを行う
 */

import { saveSettingsWithAllowedUrls } from '../../utils/storage.js';
import { extractSettingsFromInputs } from '../settingsUiHelper.js';
import { getMessage } from '../i18n.js';
import { clearAllFieldErrors, validateAllFields } from './fieldValidation.js';

/**
 * 接続テスト結果
 * @typedef {Object} ConnectionTestResult
 * @property {boolean} obsidianSuccess - Obsidian接続成功フラグ
 * @property {string} obsidianMessage - Obsidian接続メッセージ
 * @property {boolean} aiSuccess - AI接続成功フラグ
 * @property {string} aiMessage - AI接続メッセージ
 */

/**
 * 接続テストを実行
 * @returns {Promise<ConnectionTestResult>} テスト結果
 */
async function runConnectionTest() {
    const testResult = await chrome.runtime.sendMessage({
        type: 'TEST_CONNECTIONS',
        payload: {}
    });

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
function addCertificateWarning(statusDiv, port) {
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
function displayConnectionResult(statusDiv, result, protocolInput, port) {
    const { obsidianSuccess, obsidianMessage, aiSuccess, aiMessage } = result;

    if (obsidianSuccess && aiSuccess) {
        statusDiv.textContent = getMessage('successAllConnected');
        statusDiv.className = 'success';
    } else if (obsidianSuccess && !aiSuccess) {
        statusDiv.textContent = getMessage('obsidianOkAiFailed', { message: aiMessage });
        statusDiv.className = 'error';
    } else if (!obsidianSuccess && aiSuccess) {
        statusDiv.textContent = getMessage('obsidianFailedAiOk', { message: obsidianMessage });
        statusDiv.className = 'error';
        if (obsidianMessage.includes('Failed to fetch') && protocolInput.value === 'https') {
            addCertificateWarning(statusDiv, port);
        }
    } else {
        statusDiv.textContent = getMessage('bothConnectionFailed', {
            obsidianMessage,
            aiMessage
        });
        statusDiv.className = 'error';
        if (obsidianMessage.includes('Failed to fetch') && protocolInput.value === 'https') {
            addCertificateWarning(statusDiv, port);
        }
    }
}

/**
 * 設定保存ボタンクリックハンドラ
 * @param {HTMLElement} statusDiv - ステータス表示要素
 * @param {HTMLInputElement} protocolInput - プロトコル入力
 * @param {HTMLInputElement} portInput - ポート入力
 * @param {HTMLInputElement} minVisitDurationInput - 最小訪問時間入力
 * @param {HTMLInputElement} minScrollDepthInput - 最小スクロール深度入力
 * @param {Object} settingsMapping - 設定マッピング
 * @param {Function} validateFn - バリデーション関数
 * @returns {Promise<void>}
 */
export async function handleSaveAndTest(
    statusDiv,
    protocolInput,
    portInput,
    minVisitDurationInput,
    minScrollDepthInput,
    settingsMapping,
    validateFn
) {
    statusDiv.textContent = getMessage('testingConnection');
    statusDiv.className = '';

    const errorPairs = [
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
    await saveSettingsWithAllowedUrls(newSettings);

    const port = parseInt(portInput.value.trim(), 10);
    const result = await runConnectionTest();
    displayConnectionResult(statusDiv, result, protocolInput, port);
}

/**
 * 保存ボタンにクリックイベントリスナーを設定
 * @param {HTMLElement} saveBtn - 保存ボタン
 * @param {HTMLElement} statusDiv - ステータス表示要素
 * @param {HTMLInputElement} protocolInput - プロトコル入力
 * @param {HTMLInputElement} portInput - ポート入力
 * @param {HTMLInputElement} minVisitDurationInput - 最小訪問時間入力
 * @param {HTMLInputElement} minScrollDepthInput - 最小スクロール深度入力
 * @param {Object} settingsMapping - 設定マッピング
 * @returns {() => void} リスナー削除関数
 */
export function setupSaveButtonListener(
    saveBtn,
    statusDiv,
    protocolInput,
    portInput,
    minVisitDurationInput,
    minScrollDepthInput,
    settingsMapping
) {
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