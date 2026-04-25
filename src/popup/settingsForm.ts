/**
 * settingsForm.ts
 * 設定フォームの DOM 要素参照・マッピング・読み込みロジック
 */

import { StorageKeys, getSettings } from '../utils/storage.js';
import { updateAIProviderVisibility, AIProviderElements } from './settings/aiProvider.js';
import { loadSettingsToInputs, showStatus } from './settingsUiHelper.js';
import { getMessage } from './i18n.js';

// ============================================================================
// Lazy DOM Element Access (for testability)
// ============================================================================

let _domElements: {
    apiKeyInput: HTMLInputElement | null;
    protocolInput: HTMLInputElement | null;
    portInput: HTMLInputElement | null;
    dailyPathInput: HTMLInputElement | null;
    aiProviderSelect: HTMLSelectElement | null;
    geminiSettingsDiv: HTMLElement | null;
    openaiSettingsDiv: HTMLElement | null;
    openai2SettingsDiv: HTMLElement | null;
    geminiApiKeyInput: HTMLInputElement | null;
    geminiModelInput: HTMLInputElement | null;
    openaiBaseUrlInput: HTMLInputElement | null;
    openaiApiKeyInput: HTMLInputElement | null;
    openaiModelInput: HTMLInputElement | null;
    openai2BaseUrlInput: HTMLInputElement | null;
    openai2ApiKeyInput: HTMLInputElement | null;
    openai2ModelInput: HTMLInputElement | null;
    minVisitDurationInput: HTMLInputElement | null;
    minScrollDepthInput: HTMLInputElement | null;
    maxTokensPerPromptInput: HTMLInputElement | null;
    saveBtn: HTMLButtonElement | null;
    statusDiv: HTMLElement | null;
    ollamaPresetBtn: HTMLButtonElement | null;
} | null = null;

export function resetSettingsFormElements(): void {
    _domElements = null;
}

export function getSettingsFormElements() {
    if (!_domElements && typeof document !== 'undefined') {
        _domElements = {
            apiKeyInput: document.getElementById('apiKey') as HTMLInputElement | null,
            protocolInput: document.getElementById('protocol') as HTMLInputElement | null,
            portInput: document.getElementById('port') as HTMLInputElement | null,
            dailyPathInput: document.getElementById('dailyPath') as HTMLInputElement | null,
            aiProviderSelect: document.getElementById('aiProvider') as HTMLSelectElement | null,
            geminiSettingsDiv: document.getElementById('geminiSettings') as HTMLElement | null,
            openaiSettingsDiv: document.getElementById('openaiSettings') as HTMLElement | null,
            openai2SettingsDiv: document.getElementById('openai2Settings') as HTMLElement | null,
            geminiApiKeyInput: document.getElementById('geminiApiKey') as HTMLInputElement | null,
            geminiModelInput: document.getElementById('geminiModel') as HTMLInputElement | null,
            openaiBaseUrlInput: document.getElementById('openaiBaseUrl') as HTMLInputElement | null,
            openaiApiKeyInput: document.getElementById('openaiApiKey') as HTMLInputElement | null,
            openaiModelInput: document.getElementById('openaiModel') as HTMLInputElement | null,
            openai2BaseUrlInput: document.getElementById('openai2BaseUrl') as HTMLInputElement | null,
            openai2ApiKeyInput: document.getElementById('openai2ApiKey') as HTMLInputElement | null,
            openai2ModelInput: document.getElementById('openai2Model') as HTMLInputElement | null,
            minVisitDurationInput: document.getElementById('minVisitDuration') as HTMLInputElement | null,
            minScrollDepthInput: document.getElementById('minScrollDepth') as HTMLInputElement | null,
            maxTokensPerPromptInput: document.getElementById('maxTokensPerPrompt') as HTMLInputElement | null,
            saveBtn: document.getElementById('save') as HTMLButtonElement | null,
            statusDiv: document.getElementById('status') as HTMLElement | null,
            ollamaPresetBtn: document.getElementById('ollamaPresetBtn') as HTMLButtonElement | null,
        };
    }
    return _domElements ?? {
        apiKeyInput: null, protocolInput: null, portInput: null, dailyPathInput: null,
        aiProviderSelect: null, geminiSettingsDiv: null, openaiSettingsDiv: null,
        openai2SettingsDiv: null, geminiApiKeyInput: null, geminiModelInput: null,
        openaiBaseUrlInput: null, openaiApiKeyInput: null, openaiModelInput: null,
        openai2BaseUrlInput: null, openai2ApiKeyInput: null, openai2ModelInput: null,
        minVisitDurationInput: null, minScrollDepthInput: null,
        maxTokensPerPromptInput: null, saveBtn: null, statusDiv: null,
        ollamaPresetBtn: null,
    };
}

export function getSettingsMapping(): Record<string, HTMLInputElement | HTMLSelectElement | null> {
    const el = getSettingsFormElements();
    return {
        [StorageKeys.OBSIDIAN_API_KEY]: el.apiKeyInput,
        [StorageKeys.OBSIDIAN_PROTOCOL]: el.protocolInput,
        [StorageKeys.OBSIDIAN_PORT]: el.portInput,
        [StorageKeys.OBSIDIAN_DAILY_PATH]: el.dailyPathInput,
        [StorageKeys.AI_PROVIDER]: el.aiProviderSelect,
        [StorageKeys.GEMINI_API_KEY]: el.geminiApiKeyInput,
        [StorageKeys.GEMINI_MODEL]: el.geminiModelInput,
        [StorageKeys.OPENAI_BASE_URL]: el.openaiBaseUrlInput,
        [StorageKeys.OPENAI_API_KEY]: el.openaiApiKeyInput,
        [StorageKeys.OPENAI_MODEL]: el.openaiModelInput,
        [StorageKeys.OPENAI_2_BASE_URL]: el.openai2BaseUrlInput,
        [StorageKeys.OPENAI_2_API_KEY]: el.openai2ApiKeyInput,
        [StorageKeys.OPENAI_2_MODEL]: el.openai2ModelInput,
        [StorageKeys.MIN_VISIT_DURATION]: el.minVisitDurationInput,
        [StorageKeys.MIN_SCROLL_DEPTH]: el.minScrollDepthInput,
        [StorageKeys.MAX_TOKENS_PER_PROMPT]: el.maxTokensPerPromptInput
    };
}

export function getAiProviderElements(): AIProviderElements {
    const el = getSettingsFormElements();
    return {
        select: el.aiProviderSelect as HTMLSelectElement,
        geminiSettings: el.geminiSettingsDiv as HTMLElement,
        openaiSettings: el.openaiSettingsDiv as HTMLElement,
        openai2Settings: el.openai2SettingsDiv as HTMLElement
    };
}

export function getErrorPairs(): [HTMLInputElement | null, string][] {
    const el = getSettingsFormElements();
    return [
        [el.protocolInput, 'protocolError'],
        [el.portInput, 'portError'],
        [el.minVisitDurationInput, 'minVisitDurationError'],
        [el.minScrollDepthInput, 'minScrollDepthError'],
        [el.maxTokensPerPromptInput, 'maxTokensError']
    ];
}

export async function load(): Promise<void> {
    const settings = await getSettings();
    loadSettingsToInputs(settings, getSettingsMapping());
    updateAIProviderVisibility(getAiProviderElements());
}

export function setupOllamaPresetListener(): void {
    const el = getSettingsFormElements();
    el.ollamaPresetBtn?.addEventListener('click', () => {
        if (el.openai2BaseUrlInput) {
            el.openai2BaseUrlInput.value = 'http://localhost:11434/v1';
        }
        showStatus('status', getMessage('ollamaPresetApplied') || 'Ollama preset applied (http://localhost:11434/v1)', 'success');
    });
}

// No module-level DOM element exports to avoid testability issues.
// Use getSettingsFormElements(), getSettingsMapping(), getAiProviderElements(), getErrorPairs() instead.
