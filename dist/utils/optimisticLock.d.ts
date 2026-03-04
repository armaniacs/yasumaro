/**
 * optimisticLock.ts
 * Read-Modify-Writeパターンを提供するユーティリティ
 * chrome.storage.local.set のアトミック性に依存した簡易実装
 */
interface ConflictStats {
    totalAttempts: number;
    totalConflicts: number;
    totalFailures: number;
}
/**
 * 楽観的ロックの競合検出時にスローされるエラー
 */
export declare class ConflictError extends Error {
    constructor(key: string, expectedVersion: number, actualVersion: number);
}
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
export declare function withOptimisticLock<T>(key: string, updateFn: (currentValue: T) => T): Promise<T>;
/**
 * 現在の競合統計を取得
 *
 * @returns {ConflictStats}
 */
export declare function getConflictStats(): ConflictStats;
/**
 * 競合統計をリセット（テスト用）
 */
export declare function resetConflictStats(): void;
export {};
//# sourceMappingURL=optimisticLock.d.ts.map