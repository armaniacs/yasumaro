/**
 * aiModelKey.test.ts
 * Verifies the shared provider → model-settings-key mapping used by both
 * AIClient (write/display) and OpenAIProvider (request), so the "write key"
 * and "display key" can never drift apart for a provider.
 */

import { describe, it, expect } from 'vitest';
import { normalizeProviderKeyName, resolveModelKey } from '../aiModelKey.js';

describe('normalizeProviderKeyName', () => {
    it('maps openai2 to openai_2', () => {
        expect(normalizeProviderKeyName('openai2')).toBe('openai_2');
    });

    it('maps hyphenated ids to snake_case (lm-studio, built-in-ai)', () => {
        expect(normalizeProviderKeyName('lm-studio')).toBe('lm_studio');
        expect(normalizeProviderKeyName('built-in-ai')).toBe('built_in_ai');
    });

    it('lowercases and leaves plain ids unchanged', () => {
        expect(normalizeProviderKeyName('gemini')).toBe('gemini');
        expect(normalizeProviderKeyName('OLLAMA')).toBe('ollama');
    });
});

describe('resolveModelKey', () => {
    it('uses the generic provider_model key for openai-compatible', () => {
        expect(resolveModelKey('openai-compatible')).toBe('provider_model');
    });

    it('maps each registered provider to its _model settings key', () => {
        const expectations: Array<[string, string]> = [
            ['gemini', 'gemini_model'],
            ['openai', 'openai_model'],
            ['openai2', 'openai_2_model'],
            ['openai-compatible', 'provider_model'],
            ['lm-studio', 'lm_studio_model'],
            ['ollama', 'ollama_model'],
        ];
        for (const [provider, key] of expectations) {
            expect(resolveModelKey(provider), `resolveModelKey(${provider})`).toBe(key);
        }
    });
});
