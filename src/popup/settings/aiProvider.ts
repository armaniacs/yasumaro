/**
 * AIプロバイダー UI 表示制御モジュール
 * AIプロバイダーの選択に応じて、各プロバイダー設定パネルの表示/非表示を切り替える
 */

import { PermissionManager } from '../../utils/permissionManager.js';
import { errorMessage } from '../../utils/errorUtils.js';
import { logWarn } from '../../utils/logger.js';

/**
 * AIプロバイダー項目
 */
export interface AIProviderElements {
    select: HTMLSelectElement;
    geminiSettings: HTMLElement;
    openaiSettings: HTMLElement;
    openai2Settings: HTMLElement;
    openaiCompatibleSettings?: HTMLElement;
    lmStudioSettings?: HTMLElement;
    ollamaSettings?: HTMLElement;
}

/**
 * AIプロバイダーとそのAPI URLのマッピング
 */
const PROVIDER_URLS: Record<string, string> = {
    'gemini': 'https://generativelanguage.googleapis.com/',
    'openai': 'https://api.openai.com/',
    'openai2': 'https://api.openai.com/',
    'lm-studio': 'http://localhost:1234/',
    'ollama': 'http://localhost:11434/',
    'openai-compatible': '', // ユーザー設定による
};

/**
 * AIプロバイダー UI 表示を更新
 * @param {AIProviderElements} elements - DOM要素
 */
export function updateAIProviderVisibility(elements: AIProviderElements): void {
    const provider = elements.select.value;
    elements.geminiSettings.style.display = 'none';
    elements.openaiSettings.style.display = 'none';
    elements.openai2Settings.style.display = 'none';

    if (elements.openaiCompatibleSettings) {
        elements.openaiCompatibleSettings.style.display = 'none';
    }
    if (elements.lmStudioSettings) {
        elements.lmStudioSettings.style.display = 'none';
    }
    if (elements.ollamaSettings) {
        elements.ollamaSettings.style.display = 'none';
    }

    if (provider === 'gemini') {
        elements.geminiSettings.style.display = 'block';
    } else if (provider === 'openai') {
        elements.openaiSettings.style.display = 'block';
    } else if (provider === 'openai2') {
        elements.openai2Settings.style.display = 'block';
    } else if (provider === 'lm-studio' && elements.lmStudioSettings) {
        elements.lmStudioSettings.style.display = 'block';
    } else if (provider === 'ollama' && elements.ollamaSettings) {
        elements.ollamaSettings.style.display = 'block';
    } else if (provider === 'openai-compatible' && elements.openaiCompatibleSettings) {
        elements.openaiCompatibleSettings.style.display = 'block';
    }
}

/**
 * AIプロバイダーの権限を動的に要求
 * @param {string} provider - プロバイダーID
 * @returns {Promise<boolean>} 許可されたかどうか
 */
export async function requestAIProviderPermission(provider: string): Promise<boolean> {
    const url = PROVIDER_URLS[provider];
    if (!url) {
        // openai-compatible の場合は手動入力を待つ
        return true;
    }

    const permManager = new PermissionManager();
    const isPermitted = await permManager.isHostPermitted(url);

    if (isPermitted) {
        return true;
    }

    // 権限を要求
    const granted = await permManager.requestPermission(url);
    if (!granted) {
        logWarn('AIProvider', { provider, url }, undefined, 'AI provider permission denied by user');
    }
    return granted;
}

/**
 * AIプロバイダー選択時に表示を切り替えるイベントリスナーを設定
 * @param {AIProviderElements} elements - DOM要素
 */
export function setupAIProviderChangeListener(elements: AIProviderElements): void {
    elements.select.addEventListener('change', () => {
        updateAIProviderVisibility(elements);

        // 権限を非同期で要求（UIブロックしない）
        const provider = elements.select.value;
        if (provider !== 'openai-compatible') {
            requestAIProviderPermission(provider).catch((error) => {
                logWarn('AIProvider', { error: errorMessage(error), provider }, undefined, 'Failed to request AI provider permission');
            });
        }
    });
}

/**
 * 複数のプロバイダー選択（優先度1〜3位）に基づき、選択された全プロバイダーの設定欄を同時表示する
 * @param {AIProviderElements} elements - DOM要素
 * @param {string[]} selectedProviders - 選択されたプロバイダーIDのリスト（空文字列は無視）
 */
export function updateAIProviderVisibilityMulti(elements: AIProviderElements, selectedProviders: string[]): void {
    const selected = new Set(selectedProviders.filter(p => p !== ''));

    if (!elements.geminiSettings || !elements.openaiSettings || !elements.openai2Settings) {
        return;
    }

    elements.geminiSettings.style.display = selected.has('gemini') ? 'block' : 'none';
    elements.openaiSettings.style.display = selected.has('openai') ? 'block' : 'none';
    elements.openai2Settings.style.display = selected.has('openai2') ? 'block' : 'none';

    if (elements.lmStudioSettings) {
        elements.lmStudioSettings.style.display = selected.has('lm-studio') ? 'block' : 'none';
    }
    if (elements.ollamaSettings) {
        elements.ollamaSettings.style.display = selected.has('ollama') ? 'block' : 'none';
    }
    if (elements.openaiCompatibleSettings) {
        elements.openaiCompatibleSettings.style.display = selected.has('openai-compatible') ? 'block' : 'none';
    }
}
