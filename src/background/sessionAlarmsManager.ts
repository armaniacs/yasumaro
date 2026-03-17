/**
 * sessionAlarmsManager.ts
 * セッションタイムアウト管理 (chrome.alarms API)
 * Service Worker環境対応
 */

import { logInfo, logWarn, logError, ErrorCode } from '../utils/logger.js';
import { StorageKeys } from '../utils/storage.js';

// 定数
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30分
const SESSION_CHECK_INTERVAL_MINUTES = 5; // セッションチェック間隔（バッテリー効率化）
const ALARM_NAME_CHECK_SESSION = 'check_session_timeout';
const STORAGE_KEY_LAST_ACTIVITY = 'session_last_activity';

/**
 * アクティビティを更新
 */
export async function updateActivity(): Promise<void> {
    try {
        await chrome.storage.local.set({
            [STORAGE_KEY_LAST_ACTIVITY]: Date.now()
        });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logWarn(
            'Failed to update activity',
            { error: errorMessage },
            undefined,
            'sessionAlarmsManager.ts'
        );
    }
}

/**
 * タイムアウトチェッカーアラーム開始
 */
export async function startTimeoutChecker(): Promise<void> {
    try {
        // 既存のアラームをクリア
        await chrome.alarms.clear(ALARM_NAME_CHECK_SESSION);

        // SESSION_CHECK_INTERVAL_MINUTES 間隔でアラーム作成（バッテリー効率化）
        await chrome.alarms.create(ALARM_NAME_CHECK_SESSION, {
            periodInMinutes: SESSION_CHECK_INTERVAL_MINUTES
        });

        // アラームリスナーを設定（内部で重複チェックあり）
        setupAlarmListener();

        await logInfo(
            'Session timeout checker started',
            { alarmName: ALARM_NAME_CHECK_SESSION, timeoutMinutes: SESSION_TIMEOUT_MS / 60000 },
            'sessionAlarmsManager.ts'
        );
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logError(
            'Failed to start session timeout checker',
            { error: errorMessage },
            ErrorCode.INTERNAL_ERROR,
            'sessionAlarmsManager.ts'
        );
    }
}

/**
 * タイムアウトチェッカーアラーム停止
 */
export async function stopTimeoutChecker(): Promise<void> {
    try {
        await chrome.alarms.clear(ALARM_NAME_CHECK_SESSION);
        await logInfo(
            'Session timeout checker stopped',
            { alarmName: ALARM_NAME_CHECK_SESSION },
            'sessionAlarmsManager.ts'
        );
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logWarn(
            'Failed to stop session timeout checker',
            { error: errorMessage },
            undefined,
            'sessionAlarmsManager.ts'
        );
    }
}

/**
 * タイムアウトチェック実行
 */
async function checkTimeout(): Promise<void> {
    try {
        const result = await chrome.storage.local.get(STORAGE_KEY_LAST_ACTIVITY);
        const lastActivity = result[STORAGE_KEY_LAST_ACTIVITY] as number;

        if (!lastActivity) {
            return; // アクティビティ記録なし
        }

        const currentTime = Date.now();
        const elapsed = currentTime - lastActivity;

        if (elapsed > SESSION_TIMEOUT_MS) {
            // タイムアウト: セッションをロック
            await lockSession();
            await logInfo(
                'Session locked due to inactivity',
                { timeoutMinutes: SESSION_TIMEOUT_MS / 60000, elapsedMinutes: elapsed / 60000 },
                'sessionAlarmsManager.ts'
            );
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logError(
            'Failed to check session timeout',
            { error: errorMessage },
            ErrorCode.INTERNAL_ERROR,
            'sessionAlarmsManager.ts'
        );
    }
}

/**
 * セッションをロック
 */
async function lockSession(): Promise<void> {
    try {
        // storage.tsのlockSessionをエクスポートして使用するか、
        // 直接ロック処理を実装
        await chrome.storage.local.set({ [StorageKeys.IS_LOCKED]: true });
        // マスターパスワードキャッシュはstorage.tsで管理されるため、
        // 通知メッセージを送信してstorage.tsにロックをさせる
        chrome.runtime.sendMessage({ type: 'SESSION_LOCK_REQUEST' }).catch(() => {
            // 送信失敗は無視
        });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logError(
            'Failed to lock session',
            { error: errorMessage },
            ErrorCode.INTERNAL_ERROR,
            'sessionAlarmsManager.ts'
        );
    }
}

/** アラームリスナーが設定されているか */
let alarmListenerSetUp = false;

/** アラームリスナーを設定 */
function setupAlarmListener(): void {
    if (alarmListenerSetUp) {
        return;
    }

    const listener = (alarm: chrome.alarms.Alarm) => {
        if (alarm.name === ALARM_NAME_CHECK_SESSION) {
            checkTimeout();
        }
    };

    chrome.alarms.onAlarm.addListener(listener);
    alarmListenerSetUp = true;
}

/**
 * 初期化
 */
export async function initialize(): Promise<void> {
    try {
        // タイムアウトチェッカーを開始
        await startTimeoutChecker();
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logError(
            'Failed to initialize session alarms manager',
            { error: errorMessage },
            ErrorCode.INTERNAL_ERROR,
            'sessionAlarmsManager.ts'
        );
    }
}