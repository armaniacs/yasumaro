/**
 * AIプロバイダー UI 表示制御モジュール
 * AIプロバイダーの選択に応じて、各プロバイダー設定パネルの表示/非表示を切り替える
 */

import { getMessage } from '../i18n.js';

/**
 * AIプロバイダー項目
 * @typedef {Object} AIProviderElements
 * @property {HTMLSelectElement} select - プロバイダー選択フォーム
 * @property {HTMLElement} geminiSettings - Gemini設定パネル
 * @property {HTMLElement} openaiSettings - OpenAI設定パネル
 * @property {HTMLElement} openai2Settings - OpenAI 2設定パネル
 */

/**
 * AIプロバイダー UI 表示を更新
 * @param {AIProviderElements} elements - DOM要素
 * @param {string} provider - AIプロバイダー名
 */
export function updateAIProviderVisibility(elements) {
    const provider = elements.select.value;
    elements.geminiSettings.style.display = 'none';
    elements.openaiSettings.style.display = 'none';
    elements.openai2Settings.style.display = 'none';

    if (provider === 'gemini') {
        elements.geminiSettings.style.display = 'block';
    } else if (provider === 'openai') {
        elements.openaiSettings.style.display = 'block';
    } else if (provider === 'openai2') {
        elements.openai2Settings.style.display = 'block';
    }
}

/**
 * AIプロバイダー選択時に表示を切り替えるイベントリスナーを設定
 * @param {AIProviderElements} elements - DOM要素
 */
export function setupAIProviderChangeListener(elements) {
    elements.select.addEventListener('change', () => {
        updateAIProviderVisibility(elements);
    });
}