/**
 * aiLimits.ts
 * AIプロバイダーのトークン制限管理
 */

// プロバイダーごとの最大トークン数
export const PROVIDER_MAX_TOKENS = new Map<string, number>([
    ['openai', 16384],
    ['openrouter', 16384],
    ['perplexity', 128000],
    ['groq', 16384],
    ['gemini', 8192],
    ['anthropic', 100000],
    ['claude', 100000],
    ['localai', 16384],  // window.ai
    ['ollama', 32000],
]);

// グローバル安全上限
export const GLOBAL_MAX_TOKENS = 16000;

// 最小トークン数
export const MIN_TOKENS = 10;

/**
 * トークン数を検証し、有効な範囲に制限する
 * @param tokens - 検証するトークン数
 * @param providerId - プロバイダーID
 * @returns 検証済みのトークン数
 */
export function validateMaxTokens(tokens: number, providerId: string): number {
    // NaN, undefined, nullの処理
    if (isNaN(tokens) || tokens == null) {
        return 1000; // デフォルト値
    }

    // 最小値の検証
    if (tokens < MIN_TOKENS) {
        return MIN_TOKENS;
    }

    // プロバイダー別上限の取得
    const providerLimit = PROVIDER_MAX_TOKENS.get(providerId) || GLOBAL_MAX_TOKENS;

    // 最大値の検証
    return Math.min(tokens, providerLimit);
}

/**
 * プロバイダーの最大トークン数を取得する
 * @param providerId - プロバイダーID
 * @returns 最大トークン数（プロバイダー未定義の場合はグローバル上限）
 */
export function getProviderMaxTokens(providerId: string): number {
    return PROVIDER_MAX_TOKENS.get(providerId) || GLOBAL_MAX_TOKENS;
}

/**
 * グローバル最大トークン数を取得する
 * @returns グローバル最大トークン数
 */
export function getGlobalMaxTokens(): number {
    return GLOBAL_MAX_TOKENS;
}