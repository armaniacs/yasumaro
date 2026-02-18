/**
 * logger.ts
 * Sanitization and Error Logging Utility
 * Stores logs in chrome.storage.local with 7-day retention policy.
 */

const LOG_STORAGE_KEY = 'sanitization_logs';
const RETENTION_DAYS = 7;
const MAX_LOGS = 1000; // Prevent unlimited growth

// 【パフォーマンス改善】バッチ書き込み用設定
const BATCH_FLUSH_SIZE = 10; // バッファがこのサイズを超えるとフラッシュ
const BATCH_FLUSH_DELAY_MS = 5000; // 5秒間書き込みがないとフラッシュ
let pendingLogs: LogEntry[] = []; // 保留中のログバッファ
let flushTimer: number | NodeJS.Timeout | null = null; // フラッシュ遅延タイマー
let isFlushing = false; // フラッシュ中フラグ（多重フラッシュ防止）

export const LogType = {
    INFO: 'INFO',
    WARN: 'WARN',
    ERROR: 'ERROR',
    SANITIZE: 'SANITIZE',
    DEBUG: 'DEBUG'
} as const;

export type LogTypeValues = typeof LogType[keyof typeof LogType];

export interface LogEntry {
    id: string;
    timestamp: number;
    type: LogTypeValues;
    message: string;
    details?: Record<string, any>;
}

/**
 * 【パフォーマンス改善】保留中のログをstorageにフラッシュする
 * @param {boolean} immediate - trueの場合は即時フラッシュ（テスト用）
 */
export async function flushLogs(immediate: boolean = false): Promise<void> {
    if (isFlushing || pendingLogs.length === 0) {
        return;
    }

    isFlushing = true;

    try {
        // バッファの内容をコピーしてクリア
        const logsToFlush = [...pendingLogs];
        pendingLogs = [];

        // タイマーをクリア
        if (flushTimer !== null) {
            clearTimeout(flushTimer);
            flushTimer = null;
        }

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
 */
function scheduleFlush(): void {
    if (flushTimer !== null) {
        clearTimeout(flushTimer);
    }

    flushTimer = setTimeout(() => {
        flushLogs();
    }, BATCH_FLUSH_DELAY_MS) as unknown as number;
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
 * Add a log entry
 * @param {LogTypeValues} type - LogType
 * @param {string} message - Log message
 * @param {object} [details] - Additional details (NO RAW PII)
 */
export async function addLog(type: LogTypeValues, message: string, details: Record<string, any> = {}): Promise<void> {
    try {
        const entry: LogEntry = {
            id: typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Math.random().toString(36).substring(2),
            timestamp: Date.now(),
            type,
            message,
            details
        };

        // バッファに追加
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
    if (flushTimer !== null) {
        clearTimeout(flushTimer);
        flushTimer = null;
    }
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
