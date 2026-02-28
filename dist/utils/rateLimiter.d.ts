/**
 * rateLimiter.ts
 * マスターパスワード認証のレート制限モジュール
 * ブルートフォース攻撃防止のための試行回数制限
 */
export declare const RATE_LIMIT_ATTEMPTS = 5;
export declare const RATE_LIMIT_WINDOW_MS: number;
export declare const LOCKOUT_DURATION_MS: number;
export interface RateLimitResult {
    success: boolean;
    error?: string;
}
/**
 * レート制限チェックを行う
 * @param _password - パスワード（現在は未使用、将来の拡張用）
 */
export declare function checkRateLimit(_password?: string): Promise<RateLimitResult>;
/**
 * 失敗回数を記録する
 */
export declare function recordFailedAttempt(): Promise<void>;
/**
 * 失敗回数をリセットする
 */
export declare function resetFailedAttempts(): Promise<void>;
//# sourceMappingURL=rateLimiter.d.ts.map