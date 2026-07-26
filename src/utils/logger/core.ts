/**
 * logger/core.ts
 * Core logging primitives: buffering, flush scheduling, sanitization, and
 * the low-level addLog/getLogs/clearLogs storage API.
 *
 * @requires ../piiSanitizer.js — sanitizeLogDetails uses sanitizeRegex to mask
 *   API keys and other sensitive values before log output.
 */
import { sanitizeRegex } from '../piiSanitizer.js';
import { LogEntry, LogTypeValues } from './types.js';

const LOG_STORAGE_KEY = 'sanitization_logs';
const RETENTION_DAYS = 3;
const MAX_LOGS = 500; // Prevent unlimited growth

// 【セキュリティ強化】log sanitizationへの深度制限と循環参照保護
const MAX_RECURSION_DEPTH = 100; // redaction.tsと整合
const SANITIZE_RESULT = {
  TOO_DEEP: '[SANITIZED: too deep]',
  CIRCULAR_REF: '[SANITIZED: circular reference]'
} as const;

// 【パフォーマンス改善】バッチ書き込み用設定
const BATCH_FLUSH_SIZE = 10; // バッファがこのサイズを超えるとフラッシュ
const BATCH_FLUSH_ALARM_MINUTES = 1; // chrome.alarms ベースの遅延フラッシュ（Chrome の最小間隔）
const LOGGER_ALARM_NAME = 'yasumaro-logger-flush';
const MAX_PENDING_LOGS = 100; // バッファ上限（メモリリーク防止）
let pendingLogs: LogEntry[] = []; // 保留中のログバッファ
let isFlushing = false; // フラッシュ中フラグ（多重フラッシュ防止）

/**
 * 【機能概要】: 環境判定関数
 * 【実装方針】: process.env.NODE_ENVでdevelopmentかどうかを判定
 * 【テスト対応】: logger-production.test.ts
 * 🟡 信頼性レベル: 黄信号（環境変数による判定は一般的なパターンによる）
 * @returns {boolean} development環境の場合はtrue
 */
export const isDevelopment = (): boolean => {
  // Check process.env.NODE_ENV first
  // This takes priority because tests explicitly set this variable
  if (typeof process !== 'undefined' && process.env) {
    const nodeEnv = process.env.NODE_ENV;
    // Handle null, undefined, or missing NODE_ENV as production (safe default)
    if (nodeEnv === 'development') {
      return true;
    }
    if (nodeEnv === 'production' || nodeEnv === 'test' || nodeEnv === undefined || nodeEnv === null) {
      return false;
    }
  }
  // Fall back to Vite's import.meta.env.DEV for non-test environments
  // This only runs when process.env.NODE_ENV is not set at all
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV === true) {
    return true;
  }
  return false;
};

/**
 * 【パフォーマンス改善】保留中のログをstorageにフラッシュする
 * @param {boolean} immediate - trueの場合は即時フラッシュ（テスト用）
 */
export async function flushLogs(_immediate: boolean = false): Promise<void> {
    if (isFlushing || pendingLogs.length === 0) {
        return;
    }

    // 【オフスクリーン文書対応】chrome.storage が利用できない環境（offscreen.html）では
    // storageへの書き込みをスキップする。オフスクリーン文書からは chrome.storage に
    // アクセスできないため、Service Worker にメッセージで転送するか console に出力する。
    if (typeof chrome === 'undefined' || !chrome.storage) {
        // オフスクリーン文書など chrome.storage 未対応環境: console に出力してバッファをクリア
        for (const log of pendingLogs) {
            console.log(`[Logger:${log.type}] ${log.message}`, log.details || '');
        }
        pendingLogs = [];
        clearScheduledFlush();
        return;
    }

    isFlushing = true;

    try {
        // バッファの内容をコピーしてクリア
        const logsToFlush = [...pendingLogs];
        pendingLogs = [];

        // アラームスケジュールをクリア
        clearScheduledFlush();

        // 既存ログを取得
        const storage = await chrome.storage.local.get(LOG_STORAGE_KEY);
        let logs: LogEntry[] = storage[LOG_STORAGE_KEY] as LogEntry[] || [];

        // 新しいログを追加
        logs.push(...logsToFlush);

        // 古いログを削除
        logs = pruneLogs(logs);

        // サイズ制限
        if (logs.length > MAX_LOGS) {
            logs = logs.slice(logs.length - MAX_LOGS);
        }

        // storageに保存
        await chrome.storage.local.set({ [LOG_STORAGE_KEY]: logs });
    } catch (e) {
        console.error('Logger: Failed to flush logs', e);
    } finally {
        isFlushing = false;
    }
}

/**
 * 【パフォーマンス改善】保留中のログをスケジュールしてフラッシュする
 * chrome.alarms を使用して Service Worker サスペンド後も再開可能にする。
 */
function scheduleFlush(): void {
    if (typeof chrome === 'undefined' || !chrome.alarms) {
        return;
    }

    chrome.alarms.create(LOGGER_ALARM_NAME, { delayInMinutes: BATCH_FLUSH_ALARM_MINUTES });
}

/**
 * スケジュール済みのフラッシュアラームをクリアする
 */
function clearScheduledFlush(): void {
    if (typeof chrome === 'undefined' || !chrome.alarms) {
        return;
    }

    chrome.alarms.clear(LOGGER_ALARM_NAME);
}

/**
 * chrome.alarms イベントで保留中ログをフラッシュする
 */
if (typeof chrome !== 'undefined' && chrome.alarms && chrome.alarms.onAlarm) {
    chrome.alarms.onAlarm.addListener((alarm) => {
        if (alarm.name === LOGGER_ALARM_NAME) {
            void flushLogs();
        }
    });
}

/**
 * 【Service Worker対策】サスペンド前にログを即時フラッシュ
 * ChromeがService Workerを停止する前に保留中のログを保存
 */
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onSuspend) {
    chrome.runtime.onSuspend.addListener(async () => {
        console.log('[Logger] Service Worker suspending - flushing pending logs');
        const pendingCountBeforeFlush = pendingLogs.length;
        // Await flush with a timeout so pending logs are not lost when the SW dies.
        const flushCompleted = await Promise.race([
            flushLogs(true).then(() => true),
            new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 3000)),
        ]);
        // Best-effort visibility: chrome.storage may itself be unreliable during
        // suspend, so we can't persist this — but it surfaces in the SW's console
        // output (captured by chrome://extensions inspect) for debugging.
        if (!flushCompleted) {
            console.error(
                `[Logger] Flush timed out during suspend — up to ${pendingCountBeforeFlush} log entries may not have been persisted`
            );
        }
    });
}

/**
 * 【パフォーマンス改善】保留中のログの数を取得（テスト用）
 */
export function getPendingLogCount(): number {
    return pendingLogs.length;
}

/**
 * 【パフォーマンス改善】保留中のログをクリア（テスト用）
 */
export function clearPendingLogs(): void {
    pendingLogs = [];
}

/**
 * ログの詳細情報をサニタイズする（PII検出とマスキング）
 * 【深度制限と循環参照保護】
 * @param {Record<string, unknown>} details - サニタイズ対象の詳細情報
 * @param {WeakSet<object>} [visitedObjects] - 循環参照検出用WeakSet
 * @param {number} [depth] - 現在の再帰深度
 * @returns {Record<string, unknown>} サニタイズ済みの詳細情報
 */
async function sanitizeLogDetails(
    details: Record<string, unknown>,
    visitedObjects?: WeakSet<object>,
    depth = 0
): Promise<Record<string, unknown>> {
    // 入力チェック
    if (details === null || details === undefined) {
        return details;
    }

    if (typeof details !== 'object') {
        throw new Error(`Expected object, got ${typeof details}`);
    }

    // 循環参照検出の初期化
    if (typeof WeakSet !== 'undefined' && !visitedObjects) {
        visitedObjects = new WeakSet<object>();
    }

    // 深度制限チェック
    if (depth >= MAX_RECURSION_DEPTH) {
        return { __sanitized: SANITIZE_RESULT.TOO_DEEP };
    }

    // 循環参照検出
    if (visitedObjects && visitedObjects.has(details)) {
        return { __sanitized: SANITIZE_RESULT.CIRCULAR_REF };
    }

    // メタオブジェクトは文字列化
    if (details instanceof Date) {
        return { __value: details.toISOString() };
    }

    if (details instanceof Error) {
        return { message: details.message, stack: details.stack };
    }

    // WeakSetに現在のオブジェクトを追加
    if (visitedObjects) {
        visitedObjects.add(details);
    }

    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(details)) {
        if (value === null || value === undefined) {
            sanitized[key] = value;
            continue;
        }

        // 文字列値の場合はPII検出を実行
        if (typeof value === 'string') {
            const result = await sanitizeRegex(value);
            if (result.maskedItems.length > 0) {
                sanitized[key] = result.text;
                sanitized[`${key}_maskedTypes`] = result.maskedItems.map((m) => typeof m === 'string' ? m : m.type);
            } else {
                sanitized[key] = value;
            }
        } else if (typeof value === 'object') {
            // 配列の明示的な処理
            if (Array.isArray(value)) {
                sanitized[key] = await sanitizeArray(value, visitedObjects, depth + 1);
            } else {
                // オブジェクトの場合は再帰的に処理
                sanitized[key] = await sanitizeLogDetails(value as Record<string, unknown>, visitedObjects, depth + 1);
            }
        } else {
            sanitized[key] = value; // primitive types
        }
    }

    return sanitized;
}

/**
 * 配列を再帰的にサニタイズする（ヘルパー関数）
 */
async function sanitizeArray(
    arr: unknown[],
    visitedObjects?: WeakSet<object>,
    depth = 0
): Promise<unknown[] | string> {
    // 深度制限チェック
    if (depth >= MAX_RECURSION_DEPTH) {
        return SANITIZE_RESULT.TOO_DEEP;
    }

    // 循環参照検出
    if (visitedObjects && visitedObjects.has(arr)) {
        return SANITIZE_RESULT.CIRCULAR_REF;
    }

    // WeakSetに配列を追加
    if (visitedObjects) {
        visitedObjects.add(arr);
    }

    const sanitized: unknown[] = [];

    for (const item of arr) {
        if (item === null || item === undefined) {
            sanitized.push(item);
            continue;
        }

        if (typeof item === 'string') {
            const result = await sanitizeRegex(item);
            if (result.maskedItems.length > 0) {
                sanitized.push(result.text);
            } else {
                sanitized.push(item);
            }
        } else if (typeof item === 'object') {
            if (Array.isArray(item)) {
                sanitized.push(await sanitizeArray(item, visitedObjects, depth + 1));
            } else {
                // メタオブジェクトのチェック
                if (item instanceof Date) {
                    sanitized.push(item.toISOString());
                } else if (item instanceof Error) {
                    sanitized.push({ message: item.message, stack: item.stack });
                } else {
                    sanitized.push(await sanitizeLogDetails(item as Record<string, unknown>, visitedObjects, depth + 1));
                }
            }
        } else {
            sanitized.push(item); // primitive types
        }
    }

    return sanitized;
}

/**
 * Add a log entry
 * @param {LogTypeValues} type - LogType
 * @param {string} message - Log message
 * @param {object} [details] - Additional details (NO RAW PII)
 */
export async function addLog<T extends object = Record<string, unknown>>(type: LogTypeValues, message: string, details: T = {} as T): Promise<void> {
    try {
        // 【セキュリティ強化】本番環境ではDEBUGログを破棄
        // 【実装方針】: isDevelopment()で環境判定し、本番ならDEBUGを早期return
        // 【テスト対応**: logger-production.test.ts - 本番環境のDEBUGログが出力されない
        // 🟡 信頼性レベル: 黄信号（要件定義書のログ制約による）
        if (!isDevelopment() && type === 'DEBUG') {
            return; // DEBUGログは保存せず破棄
        }

        const sanitizedMessage = await sanitizeRegex(message);

        const entry: LogEntry = {
            id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
                ? crypto.randomUUID()
                : (() => { const a = new Uint32Array(2); crypto.getRandomValues(a); return a[0].toString(36) + a[1].toString(36); })(),
            timestamp: Date.now(),
            type,
            message: sanitizedMessage.maskedItems.length > 0 ? sanitizedMessage.text : message,
            details: await sanitizeLogDetails(details as Record<string, unknown>)
        };

        // バッファに追加（上限超過時は古いエントリを破棄）
        if (pendingLogs.length >= MAX_PENDING_LOGS) {
            // slice(1) creates new array but avoids in-place shifting
            pendingLogs = pendingLogs.slice(1);
        }
        pendingLogs.push(entry);

        // 【パフォーマンス改善】フラッシュ条件をチェック
        if (pendingLogs.length >= BATCH_FLUSH_SIZE) {
            await flushLogs();
        } else {
            scheduleFlush();
        }
    } catch (e) {
        console.error('Logger: Failed to save log', e);
    }
}

/**
 * Get all logs (including pending logs)
 * @returns {Promise<LogEntry[]>}
 */
export async function getLogs(): Promise<LogEntry[]> {
    const storage = await chrome.storage.local.get(LOG_STORAGE_KEY);
    const storedLogs = (storage[LOG_STORAGE_KEY] as LogEntry[]) || [];
    return [...storedLogs, ...pendingLogs];
}

/**
 * Clear all logs
 */
export async function clearLogs(): Promise<void> {
    pendingLogs = []; // 保留中のログもクリア
    clearScheduledFlush();
    await chrome.storage.local.remove(LOG_STORAGE_KEY);
}

/**
 * Filter out logs older than RETENTION_DAYS
 * @param {LogEntry[]} logs
 * @returns {LogEntry[]}
 */
function pruneLogs(logs: LogEntry[]): LogEntry[] {
    const cutoff = Date.now() - (RETENTION_DAYS * 24 * 60 * 60 * 1000);
    return logs.filter(log => log.timestamp > cutoff);
}
