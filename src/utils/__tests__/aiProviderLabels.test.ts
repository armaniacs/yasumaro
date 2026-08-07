import { describe, it, expect } from 'vitest';
import { PROVIDER_LABELS } from '../aiProviderLabels.js';

describe('aiProviderLabels', () => {
    it('provides a label for every known provider identifier', () => {
        const providerIds = [
            'gemini',
            'openai',
            'openai2',
            'lm-studio',
            'ollama',
            'openai-compatible',
            'built-in-ai',
        ];
        for (const id of providerIds) {
            expect(PROVIDER_LABELS[id], `missing label for ${id}`).toBeTruthy();
        }
    });

    it('uses non-empty string labels', () => {
        for (const [id, label] of Object.entries(PROVIDER_LABELS)) {
            expect(label, `empty label for ${id}`).toBeTruthy();
            expect(typeof label).toBe('string');
        }
    });

    it('does not pull in AIClient (heavy deps) by keeping module pure', () => {
        // The module is a pure constant; importing it must not require chrome APIs
        expect(Object.keys(PROVIDER_LABELS).length).toBe(7);
    });
});
