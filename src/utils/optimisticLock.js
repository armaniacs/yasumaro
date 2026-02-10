/**
 * optimisticLock.js
 * Read-Modify-Wirteパターンにおける競合を検出し、自動リトライを行う
 * バージョンベースの楽観的ロック機構を提供
 */

// 競合統計情報（グローバル状態）
/** @private */
let conflictStats = {
    totalAttempts: 0,
    totalConflicts: 0,
    totalFailures: 0
};

/**
 * ConflictErrorクラス
 * 楽観的ロックの最大リトライ回数超過時にスロー
 *
 * @class ConflictError
 * @extends Error
 *
 * @example
 * try {
 *     await withOptimisticLock('savedUrls', updateFn);
 * } catch (error) {
 *     if (error instanceof ConflictError) {
 *         console.log('競合により更新失敗:', error.attempts);
 *     }
 * }
 */
export class ConflictError extends Error {
    /**
     * ConflictErrorを作成
     * @param {string} message - エラーメッセージ
     * @param {string} [key] - 対象のストレージキー
     * @param {number} [attempts] - 試行回数
     */
    constructor(message, key, attempts) {
        super(message);
        this.name = 'ConflictError';
        this.key = key;
        this.attempts = attempts;
        this.isConflictError = true;
    }
}

/**
 * 楽観的ロックオプション
 * @typedef {Object} LockOptions
 * @property {number} maxRetries - 最大リトライ回数（デフォルト: 5）
 * @property {number} retryDelay - リトライ遅延ミリ秒（デフォルト: 50）
 */

/**
 * デフォルトのロックオプション
 * @private
 * @constant {LockOptions}
 */
const DEFAULT_LOCK_OPTIONS = {
    maxRetries: 5,
    retryDelay: 50
};

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
 * @param {function(*): *} updateFn - 更新関数 `(currentValue) => newValue`
 * @param {LockOptions} [options] - ロックオプション
 * @returns {Promise<*>} 成功時の新しい値
 * @throws {ConflictError} 最大リトライ回数を超えた場合
 *
 * @example
 * // URLセットに新しいURLを追加
 * await withOptimisticLock('savedUrls', (currentUrls) => {
 *     const urlSet = new Set(currentUrls || []);
 *     urlSet.add('https://example.com');
 *     return Array.from(urlSet);
 * }, { maxRetries: 3 });
 */
export async function withOptimisticLock(key, updateFn, options = {}) {
    const opts = { ...DEFAULT_LOCK_OPTIONS, ...options };
    const versionKey = `${key}_version`;

    let attempt = 0;

    while (attempt < opts.maxRetries) {
        attempt++;
        conflictStats.totalAttempts++;

        // Step 1: 現在の値とバージョンをアトミックに読み込み
        const result = await chrome.storage.local.get([key, versionKey]);
        const currentValue = result[key];
        const currentVersion = result[versionKey] || 0;

        try {
            // Step 2: 新しい値を計算
            const newValue = updateFn(currentValue);

            // Step 3: 新しい値とバージョン+1をアトミックに書き込み
            await chrome.storage.local.set({
                [key]: newValue,
                [versionKey]: currentVersion + 1
            });

            // Step 4: バージョンが変わっていないか検証（楽観的チェック）
            // chrome.storage.localの書き込みはアトミックなので、
            // もし競合していれば、他のプロセスが異なるバージョンを書いているはず
            const verifyResult = await chrome.storage.local.get(versionKey);
            if (verifyResult[versionKey] === currentVersion + 1) {
                // 成功
                conflictStats.totalConflicts += attempt - 1; // 競合回数を記録
                return newValue;
            }

            // 競合検出 - リトライ
            conflictStats.totalConflicts++;
            await sleep(attempt * opts.retryDelay);

        } catch (error) {
            conflictStats.totalFailures++;
            throw error;
        }
    }

    // 最大リトライ回数超過
    throw new ConflictError(
        `Max retries (${opts.maxRetries}) exceeded for key: ${key}`,
        key,
        attempt
    );
}

/**
 * 現在の競合統計を取得
 *
 * @returns {{ totalAttempts: number, totalConflicts: number, totalFailures: number }}
 *
 * @example
 * const stats = getConflictStats();
 * console.log(`競合率: ${(stats.totalConflicts / stats.totalAttempts * 100).toFixed(1)}%`);
 */
export function getConflictStats() {
    return { ...conflictStats };
}

/**
 * 競合統計をリセット（テスト用）
 *
 * @example
 * resetConflictStats();
 */
export function resetConflictStats() {
    conflictStats = {
        totalAttempts: 0,
        totalConflicts: 0,
        totalFailures: 0
    };
}

/**
 * 指定ミリ秒遅延実行
 * @private
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 指定されたキーのバージョン番号を初期化（移行用）
 *
 * 新規インストール用、または既存データにバージョンフィールドがない場合に初期化します
 *
 * @param {string} key - 初期化対象のキー
 * @returns {Promise<boolean>} 初期化が実行された場合はtrue
 *
 * @example
 * await ensureVersionInitialized('savedUrls');
 * await ensureVersionInitialized('savedUrlsWithTimestamps');
 */
export async function ensureVersionInitialized(key) {
    const versionKey = `${key}_version`;
    const result = await chrome.storage.local.get(versionKey);

    if (result[versionKey] === undefined) {
        // 初回: バージョンを0に初期化
        await chrome.storage.local.set({ [versionKey]: 0 });
        return true;
    }

    return false;
}