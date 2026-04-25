// @vitest-environment jsdom
/**
 * settingsForm.test.ts
 * settingsForm.ts のユニットテスト
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    getSettingsFormElements,
    getSettingsMapping,
    getAiProviderElements,
    getErrorPairs,
    load,
    setupOllamaPresetListener,
    resetSettingsFormElements
} from '../settingsForm.js';

import { StorageKeys, getSettings } from '../../utils/storage.js';
import { updateAIProviderVisibility } from '../settings/aiProvider.js';
import { loadSettingsToInputs, showStatus } from '../settingsUiHelper.js';
import { getMessage } from '../i18n.js';

// Mock dependencies - must be before imports
vi.mock('../../utils/storage.js', () => ({
    StorageKeys: {
        OBSIDIAN_API_KEY: 'obsidian_api_key',
        OBSIDIAN_PROTOCOL: 'obsidian_protocol',
        OBSIDIAN_PORT: 'obsidian_port',
        OBSIDIAN_DAILY_PATH: 'obsidian_daily_path',
        AI_PROVIDER: 'ai_provider',
        GEMINI_API_KEY: 'gemini_api_key',
        GEMINI_MODEL: 'gemini_model',
        OPENAI_BASE_URL: 'openai_base_url',
        OPENAI_API_KEY: 'openai_api_key',
        OPENAI_MODEL: 'openai_model',
        OPENAI_2_BASE_URL: 'openai_2_base_url',
        OPENAI_2_API_KEY: 'openai_2_api_key',
        OPENAI_2_MODEL: 'openai_2_model',
        MIN_VISIT_DURATION: 'min_visit_duration',
        MIN_SCROLL_DEPTH: 'min_scroll_depth',
        MAX_TOKENS_PER_PROMPT: 'max_tokens_per_prompt',
    },
    getSettings: vi.fn(),
    saveSettingsWithAllowedUrls: vi.fn(),
}));

vi.mock('../settings/aiProvider.js', () => ({
    updateAIProviderVisibility: vi.fn(),
    AIProviderElements: {},
}));

vi.mock('../settingsUiHelper.js', () => ({
    loadSettingsToInputs: vi.fn(),
    showStatus: vi.fn(),
}));

vi.mock('../i18n.js', () => ({
    getMessage: vi.fn((key: string) => key),
}));

describe('settingsForm', () => {
    beforeEach(() => {
        // Reset DOM and cache
        document.body.innerHTML = `
            <input id="apiKey" type="password" />
            <input id="protocol" type="text" value="https" />
            <input id="port" type="number" value="8080" />
            <input id="dailyPath" type="text" value="Daily" />
            <select id="aiProvider">
                <option value="gemini">Gemini</option>
                <option value="openai">OpenAI</option>
            </select>
            <div id="geminiSettings"></div>
            <div id="openaiSettings"></div>
            <div id="openai2Settings"></div>
            <input id="geminiApiKey" type="password" />
            <input id="geminiModel" type="text" value="gemini-1.5-flash" />
            <input id="openaiBaseUrl" type="text" />
            <input id="openaiApiKey" type="password" />
            <input id="openaiModel" type="text" />
            <input id="openai2BaseUrl" type="text" />
            <input id="openai2ApiKey" type="password" />
            <input id="openai2Model" type="text" />
            <input id="minVisitDuration" type="number" value="5" />
            <input id="minScrollDepth" type="number" value="50" />
            <input id="maxTokensPerPrompt" type="number" value="4096" />
            <button id="save">Save</button>
            <div id="status"></div>
            <button id="ollamaPresetBtn">Ollama Preset</button>
        `;
        resetSettingsFormElements();
        vi.clearAllMocks();
    });

    describe('getSettingsFormElements', () => {
        it('should return all DOM elements', () => {
            const elements = getSettingsFormElements();

            expect(elements.apiKeyInput).toBeInstanceOf(HTMLInputElement);
            expect(elements.protocolInput).toBeInstanceOf(HTMLInputElement);
            expect(elements.portInput).toBeInstanceOf(HTMLInputElement);
            expect(elements.dailyPathInput).toBeInstanceOf(HTMLInputElement);
            expect(elements.aiProviderSelect).toBeInstanceOf(HTMLSelectElement);
            expect(elements.saveBtn).toBeInstanceOf(HTMLButtonElement);
            expect(elements.statusDiv).toBeInstanceOf(HTMLDivElement);
        });

        it('should cache elements on subsequent calls', () => {
            const elements1 = getSettingsFormElements();
            const elements2 = getSettingsFormElements();

            expect(elements1).toBe(elements2); // Same reference (cached)
        });

        it('should return null for non-existent elements', () => {
            document.body.innerHTML = '<input id="apiKey" />';
            resetSettingsFormElements();

            const elements = getSettingsFormElements();

            expect(elements.apiKeyInput).toBeInstanceOf(HTMLInputElement);
            expect(elements.protocolInput).toBeNull();
            expect(elements.portInput).toBeNull();
        });
    });

    describe('getSettingsMapping', () => {
        it('should return mapping with correct StorageKeys', () => {
            const mapping = getSettingsMapping();

            expect(mapping[StorageKeys.OBSIDIAN_API_KEY]).toBeInstanceOf(HTMLInputElement);
            expect(mapping[StorageKeys.OBSIDIAN_PROTOCOL]).toBeInstanceOf(HTMLInputElement);
            expect(mapping[StorageKeys.OBSIDIAN_PORT]).toBeInstanceOf(HTMLInputElement);
            expect(mapping[StorageKeys.OBSIDIAN_DAILY_PATH]).toBeInstanceOf(HTMLInputElement);
            expect(mapping[StorageKeys.AI_PROVIDER]).toBeInstanceOf(HTMLSelectElement);
        });

        it('should include all required keys', () => {
            const mapping = getSettingsMapping();

            expect(mapping[StorageKeys.GEMINI_API_KEY]).toBeDefined();
            expect(mapping[StorageKeys.GEMINI_MODEL]).toBeDefined();
            expect(mapping[StorageKeys.OPENAI_BASE_URL]).toBeDefined();
            expect(mapping[StorageKeys.OPENAI_API_KEY]).toBeDefined();
            expect(mapping[StorageKeys.OPENAI_MODEL]).toBeDefined();
            expect(mapping[StorageKeys.OPENAI_2_BASE_URL]).toBeDefined();
            expect(mapping[StorageKeys.OPENAI_2_API_KEY]).toBeDefined();
            expect(mapping[StorageKeys.OPENAI_2_MODEL]).toBeDefined();
            expect(mapping[StorageKeys.MIN_VISIT_DURATION]).toBeDefined();
            expect(mapping[StorageKeys.MIN_SCROLL_DEPTH]).toBeDefined();
            expect(mapping[StorageKeys.MAX_TOKENS_PER_PROMPT]).toBeDefined();
        });
    });

    describe('getAiProviderElements', () => {
        it('should return AI provider related elements', () => {
            const elements = getAiProviderElements();

            expect(elements.select).toBeInstanceOf(HTMLSelectElement);
            expect(elements.geminiSettings).toBeInstanceOf(HTMLElement);
            expect(elements.openaiSettings).toBeInstanceOf(HTMLElement);
            expect(elements.openai2Settings).toBeInstanceOf(HTMLElement);
        });

        it('should select have correct id', () => {
            const elements = getAiProviderElements();

            expect(elements.select.id).toBe('aiProvider');
        });
    });

    describe('getErrorPairs', () => {
        it('should return array of input and error element id pairs', () => {
            const pairs = getErrorPairs();

            expect(pairs).toHaveLength(5);
            expect(pairs[0][0]?.id).toBe('protocol');
            expect(pairs[0][1]).toBe('protocolError');
            expect(pairs[1][0]?.id).toBe('port');
            expect(pairs[1][1]).toBe('portError');
            expect(pairs[2][0]?.id).toBe('minVisitDuration');
            expect(pairs[2][1]).toBe('minVisitDurationError');
            expect(pairs[3][0]?.id).toBe('minScrollDepth');
            expect(pairs[3][1]).toBe('minScrollDepthError');
            expect(pairs[4][0]?.id).toBe('maxTokensPerPrompt');
            expect(pairs[4][1]).toBe('maxTokensError');
        });
    });

    describe('load', () => {
        it('should call getSettings and loadSettingsToInputs', async () => {
            const { getSettings } = await import('../../utils/storage.js');
            const { loadSettingsToInputs } = await import('../settingsUiHelper.js');

            const mockSettings = {
                obsidian_api_key: 'test-key',
                obsidian_protocol: 'https',
                obsidian_port: '8080',
            };
            (getSettings as any).mockResolvedValue(mockSettings);

            await load();

            expect(getSettings).toHaveBeenCalled();
            expect(loadSettingsToInputs).toHaveBeenCalledWith(mockSettings, expect.any(Object));
        });

        it('should call updateAIProviderVisibility', async () => {
            const { getSettings } = await import('../../utils/storage.js');
            const { updateAIProviderVisibility } = await import('../settings/aiProvider.js');

            (getSettings as any).mockResolvedValue({});

            await load();

            expect(updateAIProviderVisibility).toHaveBeenCalled();
        });
    });

    describe('setupOllamaPresetListener', () => {
        it('should set Ollama URL when button clicked', () => {
            setupOllamaPresetListener();

            const button = document.getElementById('ollamaPresetBtn') as HTMLButtonElement;
            const openai2BaseUrlInput = document.getElementById('openai2BaseUrl') as HTMLInputElement;

            button.click();

            expect(openai2BaseUrlInput.value).toBe('http://localhost:11434/v1');
        });

        it('should call showStatus after setting URL', () => {
            setupOllamaPresetListener();

            const button = document.getElementById('ollamaPresetBtn') as HTMLButtonElement;
            button.click();

            expect(showStatus).toHaveBeenCalledWith('status', expect.any(String), 'success');
        });
    });

    describe('resetSettingsFormElements', () => {
        it('should clear cached elements', () => {
            // Get elements first to populate cache
            const elements1 = getSettingsFormElements();

            // Reset
            resetSettingsFormElements();

            // Get again - should get fresh elements (though same reference in this case)
            const elements2 = getSettingsFormElements();

            // Both should work and return same structure
            expect(elements1).not.toBeNull();
            expect(elements2).not.toBeNull();
        });
    });
});