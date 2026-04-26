// @vitest-environment jsdom
/**
 * popup/settings/aiProvider.ts のテスト
 * AIプロバイダーUI表示制御のテスト
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    updateAIProviderVisibility,
    setupAIProviderChangeListener
} from '../settings/aiProvider.js';
import { AIProviderElements } from '../settings/aiProvider.js';

// Mock logger to prevent console output during tests
vi.mock('../../utils/logger.js', () => ({
    logWarn: vi.fn(),
}));

describe('popup/settings/aiProvider', () => {
    describe('AIProviderElements interface', () => {
        it('should have correct interface structure', () => {
            const mockSelect = document.createElement('select');
            const mockGeminiSettings = document.createElement('div');
            const mockOpenaiSettings = document.createElement('div');
            const mockOpenai2Settings = document.createElement('div');

            const elements: AIProviderElements = {
                select: mockSelect,
                geminiSettings: mockGeminiSettings,
                openaiSettings: mockOpenaiSettings,
                openai2Settings: mockOpenai2Settings
            };

            expect(elements.select).toBeDefined();
            expect(elements.geminiSettings).toBeDefined();
            expect(elements.openaiSettings).toBeDefined();
            expect(elements.openai2Settings).toBeDefined();
        });
    });

    describe('updateAIProviderVisibility', () => {
        function createElements(): AIProviderElements {
            const select = document.createElement('select');
            // Add options to the select
            const options = ['gemini', 'openai', 'openai2', 'lm-studio', 'ollama', 'openai-compatible'];
            options.forEach(opt => {
                const option = document.createElement('option');
                option.value = opt;
                select.appendChild(option);
            });
            document.body.appendChild(select);

            const elements: AIProviderElements = {
                select,
                geminiSettings: document.createElement('div'),
                openaiSettings: document.createElement('div'),
                openai2Settings: document.createElement('div'),
            };
            document.body.appendChild(elements.geminiSettings);
            document.body.appendChild(elements.openaiSettings);
            document.body.appendChild(elements.openai2Settings);
            return elements;
        }

        it('should show gemini settings when gemini is selected', () => {
            const elements = createElements();
            elements.select.value = 'gemini';

            updateAIProviderVisibility(elements);

            expect(elements.geminiSettings.style.display).toBe('block');
            expect(elements.openaiSettings.style.display).toBe('none');
            expect(elements.openai2Settings.style.display).toBe('none');
        });

        it('should show openai settings when openai is selected', () => {
            const elements = createElements();
            elements.select.value = 'openai';

            updateAIProviderVisibility(elements);

            expect(elements.geminiSettings.style.display).toBe('none');
            expect(elements.openaiSettings.style.display).toBe('block');
            expect(elements.openai2Settings.style.display).toBe('none');
        });

        it('should show openai2 settings when openai2 is selected', () => {
            const elements = createElements();
            elements.select.value = 'openai2';

            updateAIProviderVisibility(elements);

            expect(elements.geminiSettings.style.display).toBe('none');
            expect(elements.openaiSettings.style.display).toBe('none');
            expect(elements.openai2Settings.style.display).toBe('block');
        });

        it('should hide all settings when no provider is selected', () => {
            const elements = createElements();
            elements.select.value = ''; // Default/no selection

            updateAIProviderVisibility(elements);

            expect(elements.geminiSettings.style.display).toBe('none');
            expect(elements.openaiSettings.style.display).toBe('none');
            expect(elements.openai2Settings.style.display).toBe('none');
        });

        it('should handle optional openaiCompatibleSettings', () => {
            const elements = createElements();
            elements.select.value = 'openai-compatible';
            elements.openaiCompatibleSettings = document.createElement('div');
            document.body.appendChild(elements.openaiCompatibleSettings);

            updateAIProviderVisibility(elements);

            expect(elements.openaiCompatibleSettings?.style.display).toBe('block');
        });

        it('should handle optional lmStudioSettings', () => {
            const elements = createElements();
            elements.select.value = 'lm-studio';
            elements.lmStudioSettings = document.createElement('div');
            document.body.appendChild(elements.lmStudioSettings);

            updateAIProviderVisibility(elements);

            expect(elements.lmStudioSettings?.style.display).toBe('block');
        });

        it('should handle optional ollamaSettings', () => {
            const elements = createElements();
            elements.select.value = 'ollama';
            elements.ollamaSettings = document.createElement('div');
            document.body.appendChild(elements.ollamaSettings);

            updateAIProviderVisibility(elements);

            expect(elements.ollamaSettings?.style.display).toBe('block');
        });

        it('should default to hidden for all optional settings', () => {
            const elements = createElements();
            elements.select.value = 'gemini';

            // Create optional settings to test they are hidden by default
            elements.openaiCompatibleSettings = document.createElement('div');
            elements.lmStudioSettings = document.createElement('div');
            elements.ollamaSettings = document.createElement('div');
            document.body.appendChild(elements.openaiCompatibleSettings);
            document.body.appendChild(elements.lmStudioSettings);
            document.body.appendChild(elements.ollamaSettings);

            updateAIProviderVisibility(elements);

            expect(elements.openaiCompatibleSettings?.style.display).toBe('none');
            expect(elements.lmStudioSettings?.style.display).toBe('none');
            expect(elements.ollamaSettings?.style.display).toBe('none');
        });
    });

    describe('setupAIProviderChangeListener', () => {
        function createElements(): AIProviderElements {
            const select = document.createElement('select');
            select.id = 'aiProvider';
            const options = ['gemini', 'openai', 'openai2', 'lm-studio', 'ollama', 'openai-compatible'];
            options.forEach(opt => {
                const option = document.createElement('option');
                option.value = opt;
                select.appendChild(option);
            });
            document.body.appendChild(select);

            const elements: AIProviderElements = {
                select,
                geminiSettings: document.createElement('div'),
                openaiSettings: document.createElement('div'),
                openai2Settings: document.createElement('div'),
            };
            document.body.appendChild(elements.geminiSettings);
            document.body.appendChild(elements.openaiSettings);
            document.body.appendChild(elements.openai2Settings);
            return elements;
        }

        it('should call updateAIProviderVisibility on change', () => {
            const elements = createElements();
            setupAIProviderChangeListener(elements);

            elements.select.value = 'openai';
            elements.select.dispatchEvent(new Event('change'));

            expect(elements.openaiSettings.style.display).toBe('block');
        });

        it('should handle gemini selection without throwing', () => {
            const elements = createElements();
            setupAIProviderChangeListener(elements);

            elements.select.value = 'gemini';
            elements.select.dispatchEvent(new Event('change'));

            expect(elements.geminiSettings.style.display).toBe('block');
        });

        it('should handle openai2 selection without throwing', () => {
            const elements = createElements();
            setupAIProviderChangeListener(elements);

            elements.select.value = 'openai2';
            elements.select.dispatchEvent(new Event('change'));

            expect(elements.openai2Settings.style.display).toBe('block');
        });

        it('should handle openai-compatible selection without throwing', () => {
            const elements = createElements();
            setupAIProviderChangeListener(elements);

            elements.select.value = 'openai-compatible';
            elements.select.dispatchEvent(new Event('change'));

            // Should not throw
            expect(elements.select.value).toBe('openai-compatible');
        });

        it('should switch visibility on multiple changes', () => {
            const elements = createElements();
            setupAIProviderChangeListener(elements);

            elements.select.value = 'gemini';
            elements.select.dispatchEvent(new Event('change'));
            expect(elements.geminiSettings.style.display).toBe('block');

            elements.select.value = 'openai';
            elements.select.dispatchEvent(new Event('change'));
            expect(elements.openaiSettings.style.display).toBe('block');
            expect(elements.geminiSettings.style.display).toBe('none');

            elements.select.value = 'openai2';
            elements.select.dispatchEvent(new Event('change'));
            expect(elements.openai2Settings.style.display).toBe('block');
            expect(elements.openaiSettings.style.display).toBe('none');
        });

        it('should handle optional settings with listener', () => {
            const elements = createElements();
            const ollamaDiv = document.createElement('div');
            document.body.appendChild(ollamaDiv);
            elements.ollamaSettings = ollamaDiv;

            setupAIProviderChangeListener(elements);

            elements.select.value = 'ollama';
            elements.select.dispatchEvent(new Event('change'));

            expect(elements.ollamaSettings).toBeDefined();
            expect(elements.ollamaSettings.style.display).toBe('block');
        });
    });
});