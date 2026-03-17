/**
 * aiLimits.test.ts
 * AIトークン制限ユーティリティの単体テスト
 */

import { validateMaxTokens, PROVIDER_MAX_TOKENS, MIN_TOKENS, GLOBAL_MAX_TOKENS } from '../aiLimits.js';

// Mock global.crypto for @peculiar/webcrypto
Object.defineProperty(global, 'crypto', {
    value: {
        getRandomValues: () => new Uint32Array(10),
    },
});

describe('validateMaxTokens', () => {
    describe('最小値チェック', () => {
        it('9トークンは最小値未満なので10に丸められる', () => {
            expect(validateMaxTokens(9, 'openai')).toBe(MIN_TOKENS);
        });

        it('1トークンは最小値未満なので10に丸められる', () => {
            expect(validateMaxTokens(1, 'openai')).toBe(MIN_TOKENS);
        });

        it('0トークンは最小値未満なので10に丸められる', () => {
            expect(validateMaxTokens(0, 'openai')).toBe(MIN_TOKENS);
        });

        it('負の値は最小値未満なので10に丸められる', () => {
            expect(validateMaxTokens(-100, 'openai')).toBe(MIN_TOKENS);
        });

        it('NaNは1000扱い（デフォルト値）', () => {
            const result = validateMaxTokens(NaN, 'openai');
            expect(result).toBe(1000);
        });

        it('10トークンは有効範囲', () => {
            expect(validateMaxTokens(10, 'openai')).toBe(10);
        });

        it('11トークンは有効範囲', () => {
            expect(validateMaxTokens(11, 'openai')).toBe(11);
        });
    });

    describe('プロバイダー別上限チェック', () => {
        it('OpenAIは16384トークンが上限', () => {
            expect(validateMaxTokens(16384, 'openai')).toBe(16384);
            expect(validateMaxTokens(20000, 'openai')).toBe(16384);
        });

        it('Geminiは8192トークンが上限', () => {
            expect(validateMaxTokens(8192, 'gemini')).toBe(8192);
            expect(validateMaxTokens(10000, 'gemini')).toBe(8192);
        });

        it('Anthropic/Claudeは100000トークンが上限', () => {
            expect(validateMaxTokens(100000, 'anthropic')).toBe(100000);
            expect(validateMaxTokens(150000, 'anthropic')).toBe(100000);

            expect(validateMaxTokens(100000, 'claude')).toBe(100000);
            expect(validateMaxTokens(150000, 'claude')).toBe(100000);
        });

        it('Local AIは16384トークンが上限', () => {
            expect(validateMaxTokens(16384, 'localai')).toBe(16384);
            expect(validateMaxTokens(20000, 'localai')).toBe(16384);
        });

        it('Ollamaは32000トークンが上限', () => {
            expect(validateMaxTokens(32000, 'ollama')).toBe(32000);
            expect(validateMaxTokens(40000, 'ollama')).toBe(32000);
        });

        it('不明なプロバイダーはグローバル上限を使用', () => {
            // 10000はグローバル上限以下なのでそのまま
            expect(validateMaxTokens(10000, 'unknown')).toBe(10000);
            // 20000はグローバル上限なので16000に丸められる
            expect(validateMaxTokens(20000, 'unknown')).toBe(GLOBAL_MAX_TOKENS);
        });
    });

    describe('有効範囲内の値', () => {
        it('OpenAI: 中間値はそのまま返される', () => {
            expect(validateMaxTokens(1000, 'openai')).toBe(1000);
            expect(validateMaxTokens(5000, 'openai')).toBe(5000);
            expect(validateMaxTokens(10000, 'openai')).toBe(10000);
        });

        it('Gemini: 中間値はそのまま返される', () => {
            expect(validateMaxTokens(1000, 'gemini')).toBe(1000);
            expect(validateMaxTokens(4000, 'gemini')).toBe(4000);
            expect(validateMaxTokens(8000, 'gemini')).toBe(8000);
        });

        it('デフォルト値1000はすべてのプロバイダーで有効', () => {
            expect(validateMaxTokens(1000, 'openai')).toBe(1000);
            expect(validateMaxTokens(1000, 'gemini')).toBe(1000);
            expect(validateMaxTokens(1000, 'anthropic')).toBe(1000);
            expect(validateMaxTokens(1000, 'localai')).toBe(1000);
            expect(validateMaxTokens(1000, 'ollama')).toBe(1000);
            expect(validateMaxTokens(1000, 'unknown')).toBe(1000);
        });
    });

    describe('境界値チェック', () => {
        it('OpenAI: 下限値', () => {
            expect(validateMaxTokens(10, 'openai')).toBe(10);
        });

        it('OpenAI: 上限値', () => {
            expect(validateMaxTokens(16384, 'openai')).toBe(16384);
        });

        it('OpenAI: 上限値+1', () => {
            expect(validateMaxTokens(16385, 'openai')).toBe(16384);
        });

        it('Gemini: 下限値', () => {
            expect(validateMaxTokens(10, 'gemini')).toBe(10);
        });

        it('Gemini: 上限値', () => {
            expect(validateMaxTokens(8192, 'gemini')).toBe(8192);
        });

        it('Gemini: 上限値+1', () => {
            expect(validateMaxTokens(8193, 'gemini')).toBe(8192);
        });
    });

    describe('特殊値チェック', () => {
        it('undefinedに対する処理', () => {
            const result = validateMaxTokens(undefined as any, 'openai');
            expect(result).toBe(1000); // デフォルト値
        });

        it('nullに対する処理', () => {
            const result = validateMaxTokens(null as any, 'openai');
            expect(result).toBe(1000); // デフォルト値
        });

        it('文字列に対する処理', () => {
            const result = validateMaxTokens('1000' as any, 'openai');
            expect(result).toBe(1000);
        });
    });
});

describe('CONSTANTS', () => {
    it('MIN_TOKENSは10', () => {
        expect(MIN_TOKENS).toBe(10);
    });

    it('GLOBAL_MAX_TOKENSは16000', () => {
        expect(GLOBAL_MAX_TOKENS).toBe(16000);
    });

    it('PROVIDER_MAX_TOKENSに主要プロバイダーが含まれる', () => {
        expect(PROVIDER_MAX_TOKENS.get('openai')).toBe(16384);
        expect(PROVIDER_MAX_TOKENS.get('gemini')).toBe(8192);
        expect(PROVIDER_MAX_TOKENS.get('anthropic')).toBe(100000);
        expect(PROVIDER_MAX_TOKENS.get('claude')).toBe(100000);
        expect(PROVIDER_MAX_TOKENS.get('localai')).toBe(16384);
        expect(PROVIDER_MAX_TOKENS.get('ollama')).toBe(32000);
    });
});