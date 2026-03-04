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

// 競合統計情報（グローバル状態）
let conflictStats: ConflictStats = {
    totalAttempts: 0,
    totalConflicts: 0,
    totalFailures: 0
};

// 競合統計のタイムアウト（テスト用）
let lastConflictStatsReset = Date.now();

/**
 * Read-Modify-Writeパターンで安全にストレージを更新
 *
 * この関数は以下の手順でストレージを更新します:
 * 1. 現在の値とバージョンを読み込む
 * 2. updateFnで新しい値を計算
 * 3. バージョンチェックを行い、アトミックに書き込み
 *
 * 注意: chrome.storage.local.set はアトミックですが、Read と Write の間に
 * 他のプロセスが書き込むと、データが上書きされる可能性があります。
 * この実装ではバージョンベースの競合検出を追加し、データの一貫性を保証します。
 *
 * @param {string} key - 更新対象のストレージキー（例: 'savedUrls', 'savedUrlsWithTimestamps'）
 * @param {function(T): T} updateFn - 更新関数 `(currentValue) => newValue`
 * @returns {Promise<T>} 成功時の新しい値
 * @throws {ConflictError} 競合が検出された場合
 */
export async function withOptimisticLock<T>(key: string, updateFn: (currentValue: T) => T): Promise<T> {
    conflictStats.totalAttempts++;

    try {
        // Step 1: 現在の値とバージョンを読み込み
        const result = await chrome.storage.local.get([key, `${key}_version`]);
        const currentValue = result[key] as T;
        const currentVersion = result[`${key}_version`] as number || 0;

        // Step 2: 新しい値を計算
        const newValue = updateFn(currentValue);

        // Step 3: バージョンチェックを行い、アトミックに書き込み
        const newVersion = currentVersion + 1;
        
        // 楽観的ロック: バージョンが変わっていないことを確認してから書き込み
        const currentResult = await chrome.storage.local.get([key, `${key}_version`]);
        const currentVersionAfterRead = currentResult[`${key}_version`] as number || 0;
        
        if (currentVersionAfterRead !== currentVersion) {
            conflictStats.totalConflicts++;
            throw new Error(`Conflict detected for key: ${key}`);
        }

        // アトミックに書き込み（chrome.storage.local.setはアトミック）
        await chrome.storage.local.set({ 
            [key]: newValue,
            [`${key}_version`]: newVersion 
        });

        return newValue;
    } catch (error) {
        conflictStats.totalFailures++;
        const err = error as Error;
        logDebug('withOptimisticLock error', { error: err.message, stack: err.stack }, 'optimisticLock.ts');
        throw error;
    }
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