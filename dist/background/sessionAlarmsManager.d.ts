/**
 * sessionAlarmsManager.ts
 * セッションタイムアウト管理 (chrome.alarms API)
 * Service Worker環境対応
 */
/**
 * アクティビティを更新
 */
export declare function updateActivity(): Promise<void>;
/**
 * タイムアウトチェッカーアラーム開始
 */
export declare function startTimeoutChecker(): Promise<void>;
/**
 * タイムアウトチェッカーアラーム停止
 */
export declare function stopTimeoutChecker(): Promise<void>;
/**
 * 初期化
 */
export declare function initialize(): Promise<void>;
//# sourceMappingURL=sessionAlarmsManager.d.ts.map