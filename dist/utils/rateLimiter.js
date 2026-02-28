/**
 * rateLimiter.ts
 * マスターパスワード認証のレート制限モジュール
 * ブルートフォース攻撃防止のための試行回数制限
 */
export const RATE_LIMIT_ATTEMPTS = 5; // 5分以内の最大試行回数
export const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000; // 評価ウインドウ: 5分
export const LOCKOUT_DURATION_MS = 30 * 60 * 1000; // ロックアウト期間: 30分 (pre-computed)
export const LOCKOUT_DURATION_MINUTES = 30; // ロックアウト期間（分、エラーメッセージ用）
const STORAGE_KEYS = {
    FAILED_ATTEMPTS: 'passwordFailedAttempts',
    FIRST_ATTEMPT_TIME: 'firstFailedAttemptTime',
    LOCKED_UNTIL: 'lockedUntil',
};
/**
 * レート制限チェックを行う
 */
export async function checkRateLimit() {
    const storage = await chrome.storage.session.get([
        STORAGE_KEYS.FAILED_ATTEMPTS,
        STORAGE_KEYS.FIRST_ATTEMPT_TIME,
        STORAGE_KEYS.LOCKED_UNTIL,
    ]);
    const attempts = storage[STORAGE_KEYS.FAILED_ATTEMPTS] || 0;
    const lockedUntil = storage[STORAGE_KEYS.LOCKED_UNTIL] || 0;
    const now = Date.now();
    if (lockedUntil && now < lockedUntil) {
        const remainingMinutes = Math.ceil((lockedUntil - now) / (60 * 1000));
        return {
            success: false,
            error: `Too many attempts. Please try again in ${remainingMinutes} minutes.`
        };
    }
    if (attempts >= RATE_LIMIT_ATTEMPTS) {
        const firstAttempt = storage[STORAGE_KEYS.FIRST_ATTEMPT_TIME] || now;
        if (now - firstAttempt > RATE_LIMIT_WINDOW_MS) {
            await resetFailedAttempts();
        }
        else {
            await chrome.storage.session.set({ [STORAGE_KEYS.LOCKED_UNTIL]: now + LOCKOUT_DURATION_MS });
            return {
                success: false,
                error: `Too many attempts. Please try again in ${LOCKOUT_DURATION_MINUTES} minutes.`
            };
        }
    }
    return { success: true };
}
/**
 * 失敗回数を記録する
 */
export async function recordFailedAttempt() {
    const storage = await chrome.storage.session.get([
        STORAGE_KEYS.FAILED_ATTEMPTS,
        STORAGE_KEYS.FIRST_ATTEMPT_TIME,
    ]);
    const attempts = storage[STORAGE_KEYS.FAILED_ATTEMPTS] || 0;
    const firstAttempt = storage[STORAGE_KEYS.FIRST_ATTEMPT_TIME] || Date.now();
    await chrome.storage.session.set({
        [STORAGE_KEYS.FAILED_ATTEMPTS]: attempts + 1,
        [STORAGE_KEYS.FIRST_ATTEMPT_TIME]: firstAttempt,
    });
}
/**
 * 失敗回数をリセットする
 */
export async function resetFailedAttempts() {
    await chrome.storage.session.remove([
        STORAGE_KEYS.FAILED_ATTEMPTS,
        STORAGE_KEYS.FIRST_ATTEMPT_TIME,
        STORAGE_KEYS.LOCKED_UNTIL,
    ]);
}
//# sourceMappingURL=rateLimiter.js.map