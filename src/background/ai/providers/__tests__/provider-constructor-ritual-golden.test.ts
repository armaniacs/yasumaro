/**
 * Golden pin for PBI 2026-09-21-10 (pre-refactor).
 * Pins CURRENT constructor behavior byte-identical:
 * - OpenAI timeout: stored>0 wins; stored=0 -> local 120000 / remote 30000
 * - Gemini timeout: stored>0 wins; stored=0 -> 30000 fixed
 * - Both log `API key resolved from: <source>` once with provider name.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GenericOpenAICompatibleProvider } from '../OpenAIProvider.js';
import { GeminiProvider } from '../GeminiProvider.js';
import type { Settings } from '../../../../utils/storage/types.js';

const { logDebug } = vi.hoisted(() => ({ logDebug: vi.fn() }));

vi.mock('../../../../utils/logger/api.js', () => ({
    logDebug,
    logInfo: vi.fn(),
    logWarn: vi.fn(),
    logError: vi.fn(),
}));

vi.mock('../../../../utils/fetch.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../../utils/fetch.js')>();
    return { ...actual, validateUrlForAIRequests: vi.fn() };
});

const TIMEOUT_KEY = 'ai_timeout_ms';

function timeoutOf(p: unknown): number {
    return (p as unknown as { timeoutMs: number }).timeoutMs;
}

describe('provider constructor ritual golden (PBI 2026-09-21-10)', () => {
    beforeEach(() => {
        logDebug.mockClear();
    });

    it('OpenAI: stored>0 wins over defaults', () => {
        const p = new GenericOpenAICompatibleProvider(
            { [TIMEOUT_KEY]: 90000 } as unknown as Settings,
            'openai',
        );
        expect(timeoutOf(p)).toBe(90000);
    });

    it('OpenAI: stored=0 local -> 120000', () => {
        const p = new GenericOpenAICompatibleProvider({} as unknown as Settings, 'ollama');
        expect((p as unknown as { isLocal: boolean }).isLocal).toBe(true);
        expect(timeoutOf(p)).toBe(120000);
    });

    it('OpenAI: stored=0 remote -> 30000', () => {
        const p = new GenericOpenAICompatibleProvider(
            { openai_base_url: 'https://api.openai.com/v1' } as unknown as Settings,
            'openai',
        );
        expect((p as unknown as { isLocal: boolean }).isLocal).toBe(false);
        expect(timeoutOf(p)).toBe(30000);
    });

    it('Gemini: stored>0 wins', () => {
        const p = new GeminiProvider({ [TIMEOUT_KEY]: 90000 } as unknown as Settings);
        expect(timeoutOf(p)).toBe(90000);
    });

    it('Gemini: stored=0 -> fixed 30000', () => {
        const p = new GeminiProvider({} as unknown as Settings);
        expect(timeoutOf(p)).toBe(30000);
    });

    it('OpenAI logs `API key resolved from: <source>` once with provider name', () => {
        logDebug.mockClear();
        new GenericOpenAICompatibleProvider(
            { openai_api_key: 'k' } as unknown as Settings,
            'openai',
        );
        expect(logDebug).toHaveBeenCalledTimes(1);
        expect(logDebug).toHaveBeenCalledWith(
            expect.stringMatching(/^API key resolved from: .+/),
            expect.objectContaining({ provider: 'openai' }),
        );
        const logged = logDebug.mock.calls.map((c) => JSON.stringify(c)).join('\n');
        expect(logged).not.toContain('sk-secret');
    });

    it('Gemini logs `API key resolved from: <source>` once with provider name', () => {
        logDebug.mockClear();
        new GeminiProvider({ gemini_api_key: 'k' } as unknown as Settings);
        expect(logDebug).toHaveBeenCalledTimes(1);
        expect(logDebug).toHaveBeenCalledWith(
            expect.stringMatching(/^API key resolved from: .+/),
            expect.objectContaining({ provider: 'gemini' }),
        );
    });
});
