/**
 * settingsForm.ts
 * 設定フォームの DOM 要素参照・マッピング・読み込みロジック
 */

import { StorageKeys, getSettings } from '../utils/storage.js';
import { updateAIProviderVisibility, AIProviderElements } from './settings/aiProvider.js';
import { loadSettingsToInputs, showStatus } from './settingsUiHelper.js';
import { getMessage } from './i18n.js';

const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement;
const protocolInput = document.getElementById('protocol') as HTMLInputElement;
const portInput = document.getElementById('port') as HTMLInputElement;
const dailyPathInput = document.getElementById('dailyPath') as HTMLInputElement;

const aiProviderSelect = document.getElementById('aiProvider') as HTMLSelectElement;
const geminiSettingsDiv = document.getElementById('geminiSettings') as HTMLElement;
const openaiSettingsDiv = document.getElementById('openaiSettings') as HTMLElement;
const openai2SettingsDiv = document.getElementById('openai2Settings') as HTMLElement;

const geminiApiKeyInput = document.getElementById('geminiApiKey') as HTMLInputElement;
const geminiModelInput = document.getElementById('geminiModel') as HTMLInputElement;

const openaiBaseUrlInput = document.getElementById('openaiBaseUrl') as HTMLInputElement;
const openaiApiKeyInput = document.getElementById('openaiApiKey') as HTMLInputElement;
const openaiModelInput = document.getElementById('openaiModel') as HTMLInputElement;

const openai2BaseUrlInput = document.getElementById('openai2BaseUrl') as HTMLInputElement;
const openai2ApiKeyInput = document.getElementById('openai2ApiKey') as HTMLInputElement;
const openai2ModelInput = document.getElementById('openai2Model') as HTMLInputElement;

const minVisitDurationInput = document.getElementById('minVisitDuration') as HTMLInputElement;
const minScrollDepthInput = document.getElementById('minScrollDepth') as HTMLInputElement;
const maxTokensPerPromptInput = document.getElementById('maxTokensPerPrompt') as HTMLInputElement;
const saveBtn = document.getElementById('save') as HTMLButtonElement;
const statusDiv = document.getElementById('status') as HTMLElement;

const settingsMapping: Record<string, HTMLInputElement | HTMLSelectElement> = {
    [StorageKeys.OBSIDIAN_API_KEY]: apiKeyInput,
    [StorageKeys.OBSIDIAN_PROTOCOL]: protocolInput,
    [StorageKeys.OBSIDIAN_PORT]: portInput,
    [StorageKeys.OBSIDIAN_DAILY_PATH]: dailyPathInput,
    [StorageKeys.AI_PROVIDER]: aiProviderSelect,
    [StorageKeys.GEMINI_API_KEY]: geminiApiKeyInput,
    [StorageKeys.GEMINI_MODEL]: geminiModelInput,
    [StorageKeys.OPENAI_BASE_URL]: openaiBaseUrlInput,
    [StorageKeys.OPENAI_API_KEY]: openaiApiKeyInput,
    [StorageKeys.OPENAI_MODEL]: openaiModelInput,
    [StorageKeys.OPENAI_2_BASE_URL]: openai2BaseUrlInput,
    [StorageKeys.OPENAI_2_API_KEY]: openai2ApiKeyInput,
    [StorageKeys.OPENAI_2_MODEL]: openai2ModelInput,
    [StorageKeys.MIN_VISIT_DURATION]: minVisitDurationInput,
    [StorageKeys.MIN_SCROLL_DEPTH]: minScrollDepthInput,
    [StorageKeys.MAX_TOKENS_PER_PROMPT]: maxTokensPerPromptInput
};

const aiProviderElements: AIProviderElements = {
    select: aiProviderSelect,
    geminiSettings: geminiSettingsDiv,
    openaiSettings: openaiSettingsDiv,
    openai2Settings: openai2SettingsDiv
};

const errorPairs: [HTMLInputElement, string][] = [
    [protocolInput, 'protocolError'],
    [portInput, 'portError'],
    [minVisitDurationInput, 'minVisitDurationError'],
    [minScrollDepthInput, 'minScrollDepthError'],
    [maxTokensPerPromptInput, 'maxTokensError']
];

async function load(): Promise<void> {
    const settings = await getSettings();
    loadSettingsToInputs(settings, settingsMapping);
    updateAIProviderVisibility(aiProviderElements);
}

const ollamaPresetBtn = document.getElementById('ollamaPresetBtn') as HTMLButtonElement;
ollamaPresetBtn?.addEventListener('click', () => {
    openai2BaseUrlInput.value = 'http://localhost:11434/v1';
    showStatus('status', getMessage('ollamaPresetApplied') || 'Ollama preset applied (http://localhost:11434/v1)', 'success');
});

export {
    apiKeyInput,
    protocolInput,
    portInput,
    dailyPathInput,
    aiProviderSelect,
    geminiSettingsDiv,
    openaiSettingsDiv,
    openai2SettingsDiv,
    geminiApiKeyInput,
    geminiModelInput,
    openaiBaseUrlInput,
    openaiApiKeyInput,
    openaiModelInput,
    openai2BaseUrlInput,
    openai2ApiKeyInput,
    openai2ModelInput,
    minVisitDurationInput,
    minScrollDepthInput,
    maxTokensPerPromptInput,
    saveBtn,
    statusDiv,
    settingsMapping,
    aiProviderElements,
    errorPairs,
    load
};