/**
 * retryHelper.ts
 * Service Worker通信に自動リトライ機能を提供するモジュール
 * 指数バックオフを使用して一時的なエラーを処理
 */

// Temporarily disabled to resolve circular dependency
// import { addLog, LogType } from './logger.js';

/**
 * リトライ可能なエラーパターン
 * Chrome Extension APIで発生する一時的なエラーを識別
 */
const RETRYABLE_ERROR_PATTERNS = [
    'Could not establish connection',
    'Extension context invalidated',
    'Receiving end does not exist',
    'Message port closed',
    'The message port closed before a response was received',
    'The extension context has been invalid',
    'No response received'
];

/**
 * 最大リトライ遅延キャップ（過度な待機を防止）
 */
const MAX_RETRY_DELAY_MS = 10000;

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
 * デフォルトのリトライ設定
 */
const DEFAULT_RETRY_OPTIONS: Required<RetryOptions> = {
    maxRetries: 3,
    initialDelay: 100,
    backoffMultiplier: 2,
    maxDelay: MAX_RETRY_DELAY_MS
};

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
export class ChromeMessageSender {
    #options: Required<RetryOptions>;

    /**
     * 新しいChromeMessageSenderインスタンスを作成
     * @param {RetryOptions} [options={} ] - デフォルトのリトライオプション
     */
    constructor(options: RetryOptions = {}) {
        this.#options = { ...DEFAULT_RETRY_OPTIONS, ...options };
    }

    /**
     * 現在のオプション設定を取得（テスト用）
     * @returns {RetryOptions}
     */
    get options(): Required<RetryOptions> {
        return { ...this.#options };
    }

    /**
     * Service Workerにメッセージを送信し、自動リトライを行う
     *
     * @param {Message} message - 送信するメッセージ
     * @param {RetryOptions} [customOptions={} ] - デフォルトオプションを上書きする設定
     * @returns {Promise<ServiceWorkerResponse>} Service Workerからのレスポンス
     * @throws {Error} 全てのリトライが失敗した場合
     */
    async sendMessageWithRetry(message: Message, customOptions: RetryOptions = {}): Promise<ServiceWorkerResponse> {
        const options = { ...this.#options, ...customOptions };
        let lastError: Error | null = null;
        let attempt = 0;

        while (attempt <= options.maxRetries) {
            try {
                const response = await this.#sendOnce(message) as ServiceWorkerResponse;

                // レスポンス構造を検証
                if (!response) {
                    throw new Error('No response received from Service Worker');
                }

                return response;
            } catch (error: any) {
                lastError = error;
                attempt++;

                // リトライ可能かどうか判定
                if (attempt <= options.maxRetries && this.#isRetryableError(error)) {
                    const delay = this.#calculateDelay(attempt, options);
                    await this.#delay(delay);
                } else {
                    // 非リトライ可能なエラー、または最大リトライ回数超過
                    break;
                }
            }
        }

        throw lastError || new Error('Unknown error sending message');
    }

    /**
     * メッセージを1回だけ送信（リトライなし）
     * @private
     * @param {Message} message
     * @returns {Promise<any>}
     */
    #sendOnce(message: Message): Promise<any> {
        return new Promise((resolve, reject) => {
            if (!chrome?.runtime?.sendMessage) {
                reject(new Error('Extension context invalidated'));
                return;
            }
            chrome.runtime.sendMessage(message, (response) => {
                // ChromeのlastErrorチェック
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }

                if (!response) {
                    reject(new Error('No response received'));
                    return;
                }

                resolve(response);
            });
        });
    }

    /**
     * エラーがリトライ可能かどうか判定
     * @private
     * @param {Error} error
     * @returns {boolean}
     */
    #isRetryableError(error: Error): boolean {
        if (!error || !error.message) {
            return false;
        }

        return RETRYABLE_ERROR_PATTERNS.some(pattern =>
            error.message.includes(pattern)
        );
    }

    /**
     * 指数バックオフによる遅延時間を計算
     * @private
     * @param {number} attempt - 現在の試行回数（1-indexed）
     * @param {Required<RetryOptions>} options
     * @returns {number} 遅延時間（ミリ秒）
     */
    #calculateDelay(attempt: number, options: Required<RetryOptions>): number {
        const delay = options.initialDelay * Math.pow(options.backoffMultiplier, attempt - 1);
        return Math.min(delay, options.maxDelay);
    }

    /**
     * 指定ミリ秒遅延実行
     * @private
     * @param {number} ms
     * @returns {Promise<void>}
     */
    #delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * エラーがリトライ可能かどうか判定（静的ユーティリティメソッド）
     *
     * @static
     * @param {Error} error
     * @returns {boolean}
     */
    static isRetryableError(error: Error): boolean {
        if (!error || !error.message) {
            return false;
        }
        return RETRYABLE_ERROR_PATTERNS.some(pattern =>
            error.message.includes(pattern)
        );
    }
}

/**
 * ファクトリー関数（簡易使用のため）
 *
 * @param {Message} message - 送信するメッセージ
 * @param {RetryOptions} [options] - リトライオプション
 * @returns {Promise<ServiceWorkerResponse>}
 */
export async function sendMessageWithRetry(message: Message, options: RetryOptions = {}): Promise<ServiceWorkerResponse> {
    const sender = new ChromeMessageSender(options);
    return sender.sendMessageWithRetry(message);
}

/**
 * カスタム設定で初期化された送信者インスタンスを作成
 *
 * @param {RetryOptions} options - インスタンスのデフォルトオプション
 * @returns {ChromeMessageSender}
 */
export function createSender(options: RetryOptions = {}): ChromeMessageSender {
    return new ChromeMessageSender(options);
}