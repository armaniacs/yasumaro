/**
 * aiLimits.test.ts
 * AIトークン制限ユーティリティの単体テスト
 */

import { validateMaxTokens, getProviderMaxTokens, getGlobalMaxTokens, PROVIDER_MAX_TOKENS, MIN_TOKENS, GLOBAL_MAX_TOKENS } from '../aiLimits.js';

// Mock global.crypto for @peculiar/webcrypto
Object.defineProperty(global, 'crypto', {
    value: {
        getRandomValues: () => new Uint32Array(10),
    },
});

describe('validateMaxTokens', () => {
    describe('最小値チェック', () => {
        it('rounds 9 tokens below the minimum up to 10', () => {
            expect(validateMaxTokens(9, 'openai')).toBe(MIN_TOKENS);
        });

        it('rounds 1 token below the minimum up to 10', () => {
            expect(validateMaxTokens(1, 'openai')).toBe(MIN_TOKENS);
        });

        it('rounds 0 tokens below the minimum up to 10', () => {
            expect(validateMaxTokens(0, 'openai')).toBe(MIN_TOKENS);
        });

        it('rounds negative values below the minimum up to 10', () => {
            expect(validateMaxTokens(-100, 'openai')).toBe(MIN_TOKENS);
        });

        it('treats NaN as 1000 (default)', () => {
            const result = validateMaxTokens(NaN, 'openai');
            expect(result).toBe(1000);
        });

        it('accepts 10 tokens as in range', () => {
            expect(validateMaxTokens(10, 'openai')).toBe(10);
        });

        it('accepts 11 tokens as in range', () => {
            expect(validateMaxTokens(11, 'openai')).toBe(11);
        });
    });

    describe('プロバイダー別上限チェック', () => {
        it('caps OpenAI at 16384 tokens', () => {
            expect(validateMaxTokens(16384, 'openai')).toBe(16384);
            expect(validateMaxTokens(20000, 'openai')).toBe(16384);
        });

        it('caps Gemini at 8192 tokens', () => {
            expect(validateMaxTokens(8192, 'gemini')).toBe(8192);
            expect(validateMaxTokens(10000, 'gemini')).toBe(8192);
        });

        it('caps Anthropic/Claude at 100000 tokens', () => {
            expect(validateMaxTokens(100000, 'anthropic')).toBe(100000);
            expect(validateMaxTokens(150000, 'anthropic')).toBe(100000);

            expect(validateMaxTokens(100000, 'claude')).toBe(100000);
            expect(validateMaxTokens(150000, 'claude')).toBe(100000);
        });

        it('caps Local AI at 16384 tokens', () => {
            expect(validateMaxTokens(16384, 'localai')).toBe(16384);
            expect(validateMaxTokens(20000, 'localai')).toBe(16384);
        });

        it('caps Ollama at 32000 tokens', () => {
            expect(validateMaxTokens(32000, 'ollama')).toBe(32000);
            expect(validateMaxTokens(40000, 'ollama')).toBe(32000);
        });

        it('applies the global cap to unknown providers', () => {
            // 10000はグローバル上限以下なのでそのまま
            expect(validateMaxTokens(10000, 'unknown')).toBe(10000);
            // 20000はグローバル上限なので16000に丸められる
            expect(validateMaxTokens(20000, 'unknown')).toBe(GLOBAL_MAX_TOKENS);
        });
    });

    describe('有効範囲内の値', () => {
        it('OpenAI: returns mid-range values unchanged', () => {
            expect(validateMaxTokens(1000, 'openai')).toBe(1000);
            expect(validateMaxTokens(5000, 'openai')).toBe(5000);
            expect(validateMaxTokens(10000, 'openai')).toBe(10000);
        });

        it('Gemini: returns mid-range values unchanged', () => {
            expect(validateMaxTokens(1000, 'gemini')).toBe(1000);
            expect(validateMaxTokens(4000, 'gemini')).toBe(4000);
            expect(validateMaxTokens(8000, 'gemini')).toBe(8000);
        });

        it('accepts the default 1000 for every provider', () => {
            expect(validateMaxTokens(1000, 'openai')).toBe(1000);
            expect(validateMaxTokens(1000, 'gemini')).toBe(1000);
            expect(validateMaxTokens(1000, 'anthropic')).toBe(1000);
            expect(validateMaxTokens(1000, 'localai')).toBe(1000);
            expect(validateMaxTokens(1000, 'ollama')).toBe(1000);
            expect(validateMaxTokens(1000, 'unknown')).toBe(1000);
        });
    });

    describe('境界値チェック', () => {
        it('OpenAI: lower bound', () => {
            expect(validateMaxTokens(10, 'openai')).toBe(10);
        });

        it('OpenAI: upper bound', () => {
            expect(validateMaxTokens(16384, 'openai')).toBe(16384);
        });

        it('OpenAI: upper bound + 1', () => {
            expect(validateMaxTokens(16385, 'openai')).toBe(16384);
        });

        it('Gemini: lower bound', () => {
            expect(validateMaxTokens(10, 'gemini')).toBe(10);
        });

        it('Gemini: upper bound', () => {
            expect(validateMaxTokens(8192, 'gemini')).toBe(8192);
        });

        it('Gemini: upper bound + 1', () => {
            expect(validateMaxTokens(8193, 'gemini')).toBe(8192);
        });
    });

    describe('特殊値チェック', () => {
        it('handles undefined', () => {
            const result = validateMaxTokens(undefined as any, 'openai');
            expect(result).toBe(1000); // デフォルト値
        });

        it('handles null', () => {
            const result = validateMaxTokens(null as any, 'openai');
            expect(result).toBe(1000); // デフォルト値
        });

        it('handles strings', () => {
            const result = validateMaxTokens('1000' as any, 'openai');
            expect(result).toBe(1000);
        });
    });
});

describe('CONSTANTS', () => {
    it('sets MIN_TOKENS to 10', () => {
        expect(MIN_TOKENS).toBe(10);
    });

    it('sets GLOBAL_MAX_TOKENS to 16000', () => {
        expect(GLOBAL_MAX_TOKENS).toBe(16000);
    });

    it('includes the major providers in PROVIDER_MAX_TOKENS', () => {
        expect(PROVIDER_MAX_TOKENS.get('openai')).toBe(16384);
        expect(PROVIDER_MAX_TOKENS.get('gemini')).toBe(8192);
        expect(PROVIDER_MAX_TOKENS.get('anthropic')).toBe(100000);
        expect(PROVIDER_MAX_TOKENS.get('claude')).toBe(100000);
        expect(PROVIDER_MAX_TOKENS.get('localai')).toBe(16384);
        expect(PROVIDER_MAX_TOKENS.get('ollama')).toBe(32000);
    });
});

describe('getProviderMaxTokens', () => {
    it('returns max tokens for known providers', () => {
        expect(getProviderMaxTokens('openai')).toBe(16384);
        expect(getProviderMaxTokens('gemini')).toBe(8192);
        expect(getProviderMaxTokens('anthropic')).toBe(100000);
        expect(getProviderMaxTokens('ollama')).toBe(32000);
    });

    it('returns the global cap for unknown providers', () => {
        expect(getProviderMaxTokens('unknown_provider')).toBe(GLOBAL_MAX_TOKENS);
        expect(getProviderMaxTokens('')).toBe(GLOBAL_MAX_TOKENS);
    });
});

describe('getGlobalMaxTokens', () => {
    it('returns the global max tokens', () => {
        expect(getGlobalMaxTokens()).toBe(16000);
        expect(getGlobalMaxTokens()).toBe(GLOBAL_MAX_TOKENS);
    });
});