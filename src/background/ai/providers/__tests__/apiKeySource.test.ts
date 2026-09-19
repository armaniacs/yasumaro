import { describe, it, expect, vi } from 'vitest';
import { GenericOpenAICompatibleProvider } from '../OpenAIProvider.js';
import { GeminiProvider } from '../GeminiProvider.js';
import { StorageKeys } from '../../../../utils/storage/types.js';

const { logDebug } = vi.hoisted(() => ({ logDebug: vi.fn() }));

vi.mock('../../../../utils/logger/api.js', () => ({
    logDebug,
    logInfo: vi.fn(),
    logWarn: vi.fn(),
    logError: vi.fn(),
}));

describe('API key source diagnostics (PBI 2026-09-19-07)', () => {
    it('records registry key source for known provider', () => {
        const p = new GenericOpenAICompatibleProvider({ [StorageKeys.OPENAI_API_KEY]: 'k' } as never, 'openai');
        expect(p.apiKeySource).toBe(StorageKeys.OPENAI_API_KEY);
    });
    it('records legacy fallback source for unknown provider', () => {
        const p = new GenericOpenAICompatibleProvider({} as never, 'some-unknown');
        expect(p.apiKeySource).toContain('legacy fallback');
    });
    it('records stored vs default source for Gemini', () => {
        const stored = new GeminiProvider({ [StorageKeys.GEMINI_API_KEY]: 'k' } as never);
        expect(stored.apiKeySource).toBe(StorageKeys.GEMINI_API_KEY);
        const def = new GeminiProvider({} as never);
        expect(def.apiKeySource).toContain('default fallback');
    });
    it('never exposes the key itself in the source', () => {
        const secret = 'sk-secret-value-123';
        const p = new GenericOpenAICompatibleProvider({ [StorageKeys.OPENAI_API_KEY]: secret } as never, 'openai');
        expect(p.apiKeySource).not.toContain(secret);
    });
    it('logs the resolution source at construction without key material (PBI 2026-09-19-17)', () => {
        logDebug.mockClear();
        const secret = 'sk-constructed-456';
        new GenericOpenAICompatibleProvider({ [StorageKeys.OPENAI_API_KEY]: secret } as never, 'openai');
        expect(logDebug).toHaveBeenCalledWith(
            expect.stringContaining('API key resolved from:'),
            expect.objectContaining({ provider: 'openai' })
        );
        const logged = logDebug.mock.calls.map((c) => JSON.stringify(c)).join('\n');
        expect(logged).not.toContain(secret);
    });
});
