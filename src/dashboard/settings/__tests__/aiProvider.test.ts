// @vitest-environment jsdom
/**
 * dashboard/settings/aiProvider.ts のテスト
 * AIプロバイダーUI表示制御のテスト（catalog 駆動）
 */

import { describe, it, expect, vi } from 'vitest';
import {
    updateAIProviderVisibility,
    setupAIProviderChangeListener,
    getAiProviderElements,
    AIProviderElements,
} from '../aiProvider.js';

vi.mock('../../../utils/logger.js', () => ({
    logWarn: vi.fn(),
}));

const PROVIDER_IDS = ['gemini', 'openai', 'openai2', 'lm-studio', 'ollama', 'openai-compatible', 'built-in-ai'];

function createElements(withId = false): AIProviderElements {
    const select = document.createElement('select');
    if (withId) select.id = 'aiProvider';
    PROVIDER_IDS.forEach((id) => {
        const option = document.createElement('option');
        option.value = id;
        select.appendChild(option);
    });
    document.body.appendChild(select);

    const settings: Record<string, HTMLElement | undefined> = {};
    PROVIDER_IDS.forEach((id) => {
        const div = document.createElement('div');
        document.body.appendChild(div);
        settings[id] = div;
    });
    return { select, settings };
}

describe('dashboard/settings/aiProvider', () => {
    describe('AIProviderElements interface', () => {
        it('has select + settings map', () => {
            const elements = createElements();
            expect(elements.select).toBeDefined();
            expect(elements.settings.gemini).toBeDefined();
            expect(elements.settings.openai).toBeDefined();
            expect(elements.settings.openai2).toBeDefined();
        });
    });

    describe('updateAIProviderVisibility', () => {
        it('shows only the selected provider settings block', () => {
            const elements = createElements();
            elements.select.value = 'gemini';
            updateAIProviderVisibility(elements);
            expect(elements.settings.gemini!.style.display).toBe('block');
            expect(elements.settings.openai!.style.display).toBe('none');
            expect(elements.settings.openai2!.style.display).toBe('none');
        });

        it('shows openai settings when openai is selected', () => {
            const elements = createElements();
            elements.select.value = 'openai';
            updateAIProviderVisibility(elements);
            expect(elements.settings.gemini!.style.display).toBe('none');
            expect(elements.settings.openai!.style.display).toBe('block');
        });

        it('shows openai2 settings when openai2 is selected', () => {
            const elements = createElements();
            elements.select.value = 'openai2';
            updateAIProviderVisibility(elements);
            expect(elements.settings.openai2!.style.display).toBe('block');
            expect(elements.settings.openai!.style.display).toBe('none');
        });

        it('hides all settings when no provider is selected', () => {
            const elements = createElements();
            elements.select.value = '';
            updateAIProviderVisibility(elements);
            PROVIDER_IDS.forEach((id) => {
                expect(elements.settings[id]!.style.display).toBe('none');
            });
        });

        it('shows lm-studio / ollama / openai-compatible blocks', () => {
            for (const id of ['lm-studio', 'ollama', 'openai-compatible']) {
                const elements = createElements();
                elements.select.value = id;
                updateAIProviderVisibility(elements);
                expect(elements.settings[id]!.style.display).toBe('block');
            }
        });

        it('tolerates a missing settings block', () => {
            const elements = createElements();
            elements.settings.ollama = undefined;
            elements.select.value = 'ollama';
            expect(() => updateAIProviderVisibility(elements)).not.toThrow();
        });
    });

    describe('setupAIProviderChangeListener', () => {
        it('calls updateAIProviderVisibility on change', () => {
            const elements = createElements(true);
            setupAIProviderChangeListener(elements);
            elements.select.value = 'openai';
            elements.select.dispatchEvent(new Event('change'));
            expect(elements.settings.openai!.style.display).toBe('block');
        });

        it('switches visibility on multiple changes', () => {
            const elements = createElements(true);
            setupAIProviderChangeListener(elements);

            elements.select.value = 'gemini';
            elements.select.dispatchEvent(new Event('change'));
            expect(elements.settings.gemini!.style.display).toBe('block');

            elements.select.value = 'openai';
            elements.select.dispatchEvent(new Event('change'));
            expect(elements.settings.openai!.style.display).toBe('block');
            expect(elements.settings.gemini!.style.display).toBe('none');
        });

        it('handles built-in-ai selection without throwing', () => {
            const elements = createElements(true);
            setupAIProviderChangeListener(elements);
            elements.select.value = 'built-in-ai';
            elements.select.dispatchEvent(new Event('change'));
            expect(elements.settings['built-in-ai']!.style.display).toBe('block');
        });
    });

    describe('getAiProviderElements', () => {
        it('returns select + settings map keyed by provider id', () => {
            const elements = getAiProviderElements();
            expect(elements).toHaveProperty('select');
            expect(elements).toHaveProperty('settings');
            PROVIDER_IDS.forEach((id) => {
                expect(Object.prototype.hasOwnProperty.call(elements.settings, id)).toBe(true);
            });
        });
    });
});
