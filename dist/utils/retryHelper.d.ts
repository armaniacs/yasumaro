/**
 * retryHelper.ts
 * Service Worker通信に自動リトライ機能を提供するモジュール
 * 指数バックオフを使用して一時的なエラーを処理
 */
/**
 * リトライ設定オプション
 */
export interface RetryOptions {
    maxRetries?: number;
    initialDelay?: number;
    backoffMultiplier?: number;
    maxDelay?: number;
}
/**
 * メッセージ構造（Service Worker通信用）
 */
export interface Message {
    type: string;
    payload?: any;
    target?: string;
}
/**
 * Service Workerからのレスポンス構造
 * RecordingResultのフィールドを含む
 */
export interface ServiceWorkerResponse {
    success: boolean;
    error?: string;
    skipped?: boolean;
    reason?: string;
    summary?: string;
    title?: string;
    url?: string;
    preview?: boolean;
    processedContent?: string;
    mode?: string;
    maskedCount?: number;
    maskedItems?: any[];
    aiDuration?: number;
}
/**
 * ChromeMessageSenderクラス
 * Service Worker通信にリトライロジックを提供
 */
export declare class ChromeMessageSender {
    #private;
    /**
     * 新しいChromeMessageSenderインスタンスを作成
     * @param {RetryOptions} [options={} ] - デフォルトのリトライオプション
     */
    constructor(options?: RetryOptions);
    /**
     * 現在のオプション設定を取得（テスト用）
     * @returns {RetryOptions}
     */
    get options(): Required<RetryOptions>;
    /**
     * Service Workerにメッセージを送信し、自動リトライを行う
     *
     * @param {Message} message - 送信するメッセージ
     * @param {RetryOptions} [customOptions={} ] - デフォルトオプションを上書きする設定
     * @returns {Promise<ServiceWorkerResponse>} Service Workerからのレスポンス
     * @throws {Error} 全てのリトライが失敗した場合
     */
    sendMessageWithRetry(message: Message, customOptions?: RetryOptions): Promise<ServiceWorkerResponse>;
    /**
     * エラーがリトライ可能かどうか判定（静的ユーティリティメソッド）
     *
     * @static
     * @param {Error} error
     * @returns {boolean}
     */
    static isRetryableError(error: Error): boolean;
}
/**
 * ファクトリー関数（簡易使用のため）
 *
 * @param {Message} message - 送信するメッセージ
 * @param {RetryOptions} [options] - リトライオプション
 * @returns {Promise<ServiceWorkerResponse>}
 */
export declare function sendMessageWithRetry(message: Message, options?: RetryOptions): Promise<ServiceWorkerResponse>;
/**
 * カスタム設定で初期化された送信者インスタンスを作成
 *
 * @param {RetryOptions} options - インスタンスのデフォルトオプション
 * @returns {ChromeMessageSender}
 */
export declare function createSender(options?: RetryOptions): ChromeMessageSender;
//# sourceMappingURL=retryHelper.d.ts.map