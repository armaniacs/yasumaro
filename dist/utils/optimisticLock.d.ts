/**
 * optimisticLock.ts
 * Read-Modify-Wirteパターンにおける競合を検出し、自動リトライを行う
 * バージョンベースの楽観的ロック機構を提供
 */
interface ConflictStats {
    totalAttempts: number;
    totalConflicts: number;
    totalFailures: number;
}
/**
 * ConflictErrorクラス
 * 楽観的ロックの最大リトライ回数超過時にスロー
 */
export declare class ConflictError extends Error {
    key: string | undefined;
    attempts: number | undefined;
    isConflictError: boolean;
    /**
     * ConflictErrorを作成
     * @param {string} message - エラーメッセージ
     * @param {string} [key] - 対象のストレージキー
     * @param {number} [attempts] - 試行回数
     */
    constructor(message: string, key?: string, attempts?: number);
}
/**
 * 楽観的ロックオプション
 */
export interface LockOptions {
    maxRetries?: number;
    retryDelay?: number;
}
/**
 * バージョンベースの楽観的ロックで安全にRead-Modify-Wirteを実行
 *
 * この関数は以下の手順で競合を検出し、自動的にリトライします:
 * 1. 現在の値とバージョン番号をアトミックに読み込む
 * 2. updateFnで新しい値を計算
 * 3. バージョン番号が変わっていないか確認
 * 4. 変わっていなければ、新しい値とバージョン+1を保存
 * 5. 変わっていれば競合と判断し、手順1からやり直し
 *
 * @param {string} key - ロック対象のストレージキー（例: 'savedUrls', 'savedUrlsWithTimestamps'）
 * @param {function(T): T} updateFn - 更新関数 `(currentValue) => newValue`
 * @param {LockOptions} [options] - ロックオプション
 * @returns {Promise<T>} 成功時の新しい値
 * @throws {ConflictError} 最大リトライ回数を超えた場合
 */
export declare function withOptimisticLock<T>(key: string, updateFn: (currentValue: T) => T, options?: LockOptions): Promise<T>;
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
/**
 * 指定されたキーのバージョン番号を初期化（移行用）
 *
 * 新規インストール用、または既存データにバージョンフィールドがない場合に初期化します
 *
 * @param {string} key - 初期化対象のキー
 * @returns {Promise<boolean>} 初期化が実行された場合はtrue
 */
export declare function ensureVersionInitialized(key: string): Promise<boolean>;
export {};
//# sourceMappingURL=optimisticLock.d.ts.map