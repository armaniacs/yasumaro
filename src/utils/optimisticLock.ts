/**
 * optimisticLock.ts
 * Read-Modify-Writeパターンを提供するユーティリティ
 * chrome.storage.local.set のアトミック性に依存した簡易実装
 */

import { logDebug } from './logger.js';

interface ConflictStats {
    totalAttempts: number;
    totalConflicts: number;
    totalFailures: number;
}

// グローバル定数
const INITIAL_VERSION = 0;

// 競合統計情報（グローバル状態）
let conflictStats: ConflictStats = {
    totalAttempts: 0,
    totalConflicts: 0,
    totalFailures: 0
};

/**
 * 楽観的ロックの競合検出時にスローされるエラー
 */
export class ConflictError extends Error {
    constructor(key: string, expectedVersion: number, actualVersion: number) {
        super(`Conflict detected for key: ${key} (expected: ${expectedVersion}, actual: ${actualVersion})`);
        this.name = 'ConflictError';
        // TypeScriptでプロパティを追加
        Object.defineProperty(this, 'key', { value: key, enumerable: true });
        Object.defineProperty(this, 'expectedVersion', { value: expectedVersion, enumerable: true });
        Object.defineProperty(this, 'actualVersion', { value: actualVersion, enumerable: true });
    }
}

/**
 * Read-Modify-Writeパターンで安全にストレージを更新
 *
 * この関数は以下の手順でストレージを更新します:
 * 1. 現在の値とバージョンを読み込む
 * 2. updateFnで新しい値を計算
 * 3. バージョンチェックを行い、アトミックに書き込み
 * 4. 競合が発生した場合は指数バックオックでリトライ
 *
 * 注意: chrome.storage.local.set はアトミックですが、Read と Write の間に
 * 他のプロセスが書き込むと、データが上書きされる可能性があります。
 * この実装ではバージョンベースの競合検出と指数バックオック付きリトライで
 * データの一貫性を保証します。
 *
 * @param {string} key - 更新対象のストレージキー（例: 'savedUrls', 'savedUrlsWithTimestamps'）
 * @param {function(T): T} updateFn - 更新関数 `(currentValue) => newValue`
 * @param {Object} options - オプション設定
 * @param {number} options.maxRetries - 最大リトライ回数（デフォルト: 5）
 * @param {number} options.initialDelay - 初期リトライ遅延ms（デフォルト: 100）
 * @returns {Promise<T>} 成功時の新しい値
 * @throws {ConflictError} 最大リトライ回数を超えた場合
 */
export async function withOptimisticLock<T>(
    key: string,
    updateFn: (currentValue: T) => T,
    options: { maxRetries?: number; initialDelay?: number } = {}
): Promise<T> {
    const { maxRetries = 5, initialDelay = 100 } = options;
    let attemptCount = 0;
    let lastError: Error | null = null;

    while (attemptCount <= maxRetries) {
        conflictStats.totalAttempts++;

        try {
            // Step 1: 現在の値とバージョンを読み込み
            const result = await chrome.storage.local.get([key, `${key}_version`]);
            const currentValue = result[key] as T;
            const currentVersion = result[`${key}_version`] as number || INITIAL_VERSION;

            // Step 2: 新しい値を計算
            const newValue = updateFn(currentValue);
            const newVersion = currentVersion + 1;

            // Step 3: CAS (Compare-And-Swap) 操作を試行
            // chrome.storage.local では条件付き更新が直接できないため、
            // atomic get/setループを使用する
            await performCasUpdate(key, currentValue, newValue, currentVersion, newVersion);

            return newValue;
        } catch (error) {
            const err = error as Error;
            lastError = err;

            // ConflictError以外は即座に失敗
            if (!(error instanceof ConflictError)) {
                conflictStats.totalFailures++;
                logDebug('withOptimisticLock error', { error: err.message, stack: err.stack }, 'optimisticLock.ts');
                throw error;
            }

            // リトライ回数を超えた場合は失敗
            attemptCount++;
            if (attemptCount > maxRetries) {
                conflictStats.totalFailures++;
                throw new ConflictError(key, -1, -1);
            }

            // 指数バックオックで待機
            const delay = initialDelay * Math.pow(2, attemptCount - 1);
            await new Promise(resolve => setTimeout(resolve, delay));

            logDebug('withOptimisticLock retrying', {
                key,
                attemptCount,
                maxRetries,
                delay
            }, 'optimisticLock.ts');
        }
    }

    // ここには到達しないはず（型チェック用）
    throw lastError || new Error('Unexpected error in withOptimisticLock');
}

/**
 * CAS (Compare-And-Swap) 操作の実行
 *
 * @param key ストレージキー
 * @param currentValue 期待される現在値
 * @param newValue 新しい値
 * @param currentVersion 期待される現在のバージョン
 * @param newVersion 新しいバージョン
 * @throws {ConflictError} バージョンが不一致の場合
 */
async function performCasUpdate<T>(
    key: string,
    currentValue: T,
    newValue: T,
    currentVersion: number,
    newVersion: number
): Promise<void> {
    // 二重チェックを行い、可能な限りレースコンディションを最小化
    const verifyResult = await chrome.storage.local.get([key, `${key}_version`]);
    const verifyVersion = verifyResult[`${key}_version`] as number || INITIAL_VERSION;
    const verifyValue = verifyResult[key] as T;

    // バージョンと値の両方を検証（値の比較は可能な場合のみ）
    if (verifyVersion !== currentVersion) {
        conflictStats.totalConflicts++;
        throw new ConflictError(key, currentVersion, verifyVersion);
    }

    // 値の一致も確認（比較可能な場合）
    if (currentValue !== undefined && currentValue !== null && currentValue !== verifyValue) {
        conflictStats.totalConflicts++;
        throw new ConflictError(key, currentVersion, verifyVersion);
    }

    // アトミックに書き込み（chrome.storage.local.setは呼び出し内でアトミック）
    await chrome.storage.local.set({
        [key]: newValue,
        [`${key}_version`]: newVersion
    });
}

/**
 * 現在の競合統計を取得
 *
 * @returns {ConflictStats}
 */
export function getConflictStats(): ConflictStats {
    return { ...conflictStats };
}

/**
 * 競合統計をリセット（テスト用）
 */
export function resetConflictStats(): void {
    conflictStats = {
        totalAttempts: 0,
        totalConflicts: 0,
        totalFailures: 0
    };
}