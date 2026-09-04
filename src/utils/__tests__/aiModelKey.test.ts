/**
 * aiModelKey.test.ts
 * Verifies the shared provider → model-settings-key mapping used by both
 * AIClient (write/display) and OpenAIProvider (request), so the "write key"
 * and "display key" can never drift apart for a provider.
 *
 * PBI 06 (2026-09-03b): the string-derivation fallback was removed — the
 * provider catalog is the single source of truth and unknown providers
 * fall back to the generic provider_model key.
 */

import { describe, it, expect } from 'vitest';
import { resolveModelKey } from '../aiModelKey.js';

describe('resolveModelKey', () => {
    it('maps each registered provider to its catalog modelKey', () => {
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

    it('falls back to generic provider_model for unknown providers (fail-closed)', () => {
        expect(resolveModelKey('unknown-future-provider')).toBe('provider_model');
    });
});
