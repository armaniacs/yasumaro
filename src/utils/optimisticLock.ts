/**
 * optimisticLock.ts
 * Read-Modify-Writeパターンを提供するユーティリティ
 * chrome.storage.local.set のアトミック性に依存した簡易実装
 */

import { logDebug } from './logger.js';
import { runSerialized, runSerializedMulti } from './keySerializer.js';


// グローバル定数
const INITIAL_VERSION = 0;


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
            await runSerialized(key, () =>
                performCasUpdate(key, currentValue, newValue, currentVersion, newVersion)
            );

            return newValue;
        } catch (error) {
            const err = error as Error;
            lastError = err;

            // ConflictError以外は即座に失敗
            if (!(error instanceof ConflictError)) {
                logDebug('withOptimisticLock error', { error: err.message, stack: err.stack }, 'optimisticLock.ts');
                throw error;
            }

            // リトライ回数を超えた場合は失敗
            attemptCount++;
            if (attemptCount > maxRetries) {
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
        throw new ConflictError(key, currentVersion, verifyVersion);
    }

    // 値の一致も確認（プリミティブ型のみ、オブジェクト/配列は参照比較できないためスキップ）
    if (
        currentValue !== undefined &&
        currentValue !== null &&
        typeof currentValue !== 'object' &&
        currentValue !== verifyValue
    ) {
        throw new ConflictError(key, currentVersion, verifyVersion);
    }

    // アトミックに書き込み（chrome.storage.local.setは呼び出し内でアトミック）
    // 5 Whys: なぜ検証が無効だったか→単一スレッドで不要と判断 / なぜ問題か→await間で他イベントが割り込みTOCTOUが発生 / なぜ気づかなかったか→テストが検証無効でもパス / 解: デフォルト有効化で競合を検出
    // post-write verification はデフォルトで有効。TOCTOUウィンドウ（verify readとsetの間）での
    // 並行上書きを検出するため、set直後にgetで再検証し不一致なら ConflictError を送出する。
    //
    // TOCTOU note: Between the verification read above and the atomic set below,
    // another execution context could update the same key via an await yield.
    // Service Worker is single-threaded but event-driven, so logical concurrency
    // exists. Post-write verification closes this window by re-reading after set.
    await chrome.storage.local.set({
        [key]: newValue,
        [`${key}_version`]: newVersion
    });

    if (_postWriteVerificationEnabled) {
        const postWriteResult = await chrome.storage.local.get([key, `${key}_version`]);
        const postWriteVersion = postWriteResult[`${key}_version`] as number || INITIAL_VERSION;
        const postWriteValue = postWriteResult[key] as T;

        const versionMatches = postWriteVersion === newVersion;
        const valueMatches = JSON.stringify(postWriteValue) === JSON.stringify(newValue);

        if (!versionMatches || !valueMatches) {
            throw new ConflictError(key, newVersion, postWriteVersion);
        }
    }
}

/** @internal Test-only: enable post-write verification. */
export function enablePostWriteVerification(): void {
    _postWriteVerificationEnabled = true;
}

let _postWriteVerificationEnabled = true;

/**
 * Deep-equality check that does not depend on object key insertion order.
 * `JSON.stringify` equality breaks when the same logical object is
 * serialized with keys in a different order (e.g. after going through a
 * Map -> array -> object round trip), producing false-positive conflicts.
 * `structuredClone` + a canonicalizing stringify avoids that by sorting
 * object keys recursively before comparison.
 */
function canonicalStringify(value: unknown): string {
    // structuredClone strips functions/undefined the same way JSON does,
    // and throws on genuinely non-serializable input (e.g. circular refs),
    // matching the failure mode callers already expect from JSON.stringify.
    const cloned = structuredClone(value);
    return JSON.stringify(cloned, (_key, val) => {
        if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
            return Object.keys(val)
                .sort()
                .reduce((sorted: Record<string, unknown>, k) => {
                    sorted[k] = (val as Record<string, unknown>)[k];
                    return sorted;
                }, {});
        }
        return val;
    });
}

function deepEqual(a: unknown, b: unknown): boolean {
    return canonicalStringify(a) === canonicalStringify(b);
}

/**
 * Read-Modify-Write pattern for atomically updating multiple storage keys
 * as a single logical transaction.
 *
 * Generalizes `withOptimisticLock` to N keys: all keys are read together,
 * version-checked together, and written together in one
 * `chrome.storage.local.set` call, so no other execution context can ever
 * observe a partial update (e.g. `savedUrls` updated but
 * `savedUrlsWithTimestamps` not yet).
 *
 * @param keys - storage keys to update atomically as one transaction
 * @param updater - `(currentValues) => newValues`, indexed the same as `keys`
 * @param options.maxRetries - max retry count on conflict (default: 5)
 * @param options.initialDelay - initial retry backoff ms (default: 100)
 * @returns the new values, indexed the same as `keys`
 * @throws {ConflictError} once retries are exhausted
 */
export async function withAtomicKeys<T extends readonly unknown[]>(
    keys: { [K in keyof T]: string },
    updater: (currentValues: { [K in keyof T]: T[K] }) => { [K in keyof T]: T[K] },
    options: { maxRetries?: number; initialDelay?: number } = {}
): Promise<{ [K in keyof T]: T[K] }> {
    const { maxRetries = 5, initialDelay = 100 } = options;
    const versionKeys = keys.map((k) => `${k}_version`);
    let attempt = 0;
    let lastError: Error | null = null;

    while (attempt <= maxRetries) {
        try {
            const result = await chrome.storage.local.get([...keys, ...versionKeys]);
            const currentValues = keys.map((k) => result[k]) as { [K in keyof T]: T[K] };
            const currentVersions = keys.map((k) => (result[`${k}_version`] as number) ?? INITIAL_VERSION);

            const newValues = updater(currentValues);
            const newVersions = currentVersions.map((v) => v + 1);

            // Serialize the verify->write region across all keys (locked in
            // sorted order to avoid deadlock), closing the same TOCTOU window
            // performCasUpdate() closes for the single-key case.
            return await runSerializedMulti(keys as readonly string[], async () => {
                const verifyResult = await chrome.storage.local.get([...keys, ...versionKeys]);
                const verifyVersions = keys.map((k) => (verifyResult[`${k}_version`] as number) ?? INITIAL_VERSION);

                const conflictIndex = verifyVersions.findIndex((v, i) => v !== currentVersions[i]);
                if (conflictIndex !== -1) {
                    throw new ConflictError(
                        keys.join('+'),
                        currentVersions[conflictIndex] ?? -1,
                        verifyVersions[conflictIndex] ?? -1
                    );
                }

                const writePayload: Record<string, unknown> = {};
                keys.forEach((k, i) => {
                    writePayload[k] = newValues[i];
                    writePayload[`${k}_version`] = newVersions[i];
                });
                await chrome.storage.local.set(writePayload);

                if (_postWriteVerificationEnabled) {
                    const postWriteResult = await chrome.storage.local.get([...keys, ...versionKeys]);
                    for (let i = 0; i < keys.length; i++) {
                        const key = keys[i] as string;
                        const postVersion = (postWriteResult[`${key}_version`] as number) ?? INITIAL_VERSION;
                        const postValue = postWriteResult[key];
                        if (postVersion !== newVersions[i] || !deepEqual(postValue, newValues[i])) {
                            throw new ConflictError(key, newVersions[i] ?? -1, postVersion);
                        }
                    }
                }

                return newValues;
            });
        } catch (error) {
            if (!(error instanceof ConflictError)) {
                const err = error as Error;
                logDebug('withAtomicKeys error', { error: err.message, stack: err.stack }, 'optimisticLock.ts');
                throw error;
            }
            lastError = error;
            attempt++;
            if (attempt > maxRetries) {
                throw new ConflictError(keys.join('+'), -1, -1);
            }
            const delay = initialDelay * Math.pow(2, attempt - 1);
            await new Promise((resolve) => setTimeout(resolve, delay));

            logDebug('withAtomicKeys retrying', { keys, attempt, maxRetries, delay }, 'optimisticLock.ts');
        }
    }

    throw lastError || new Error('Unexpected error in withAtomicKeys');
}

