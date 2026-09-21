/**
 * aiModelKey.test.ts (background/ai)
 * Verifies the shared provider → model-settings-key mapping at its canonical
 * location (relocated from src/utils/aiModelKey.ts by PBI 2026-09-21-06 so
 * the utils layer no longer statically depends on the background catalog).
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
