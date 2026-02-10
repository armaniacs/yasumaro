/**
 * retryHelper.js
 * Service Worker通信に自動リトライ機能を提供するモジュール
 * 指数バックオフを使用して一時的なエラーを処理
 */

// Temporarily disabled to resolve circular dependency
// import { addLog, LogType } from './logger.js';

/**
 * リトライ可能なエラーパターン
 * Chrome Extension APIで発生する一時的なエラーを識別
 * @private
 * @constant {string[]}
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
 * @private
 * @constant {number}
 */
const MAX_RETRY_DELAY_MS = 10000;

/**
 * デフォルトのリトライ設定
 * @private
 * @constant {RetryOptions}
 */
const DEFAULT_RETRY_OPTIONS = {
    maxRetries: 3,
    initialDelay: 100,
    backoffMultiplier: 2,
    maxDelay: MAX_RETRY_DELAY_MS
};

/**
 * リトライ設定オプション
 * @typedef {Object} RetryOptions
 * @property {number} maxRetries - 最大リトライ回数（デフォルト: 3）
 * @property {number} initialDelay - 初期遅延ミリ秒（デフォルト: 100）
 * @property {number} backoffMultiplier - 指数バックオフ乗数（デフォルト: 2）
 * @property {number} maxDelay - 最大遅延キャップミリ秒（デフォルト: 10000）
 */

/**
 * メッセージ構造（Service Worker通信用）
 * @typedef {Object} Message
 * @property {string} type - メッセージタイプ（例: 'VALID_VISIT', 'MANUAL_RECORD'）
 * @property {Object} payload - メッセージペイロード
 * @property {string} [target] - オプションターゲット（例: 'offscreen'）
 */

/**
 * Service Workerからのレスポンス構造
 * @typedef {Object} Response
 * @property {boolean} success - 操作成功フラグ
 * @property {*} [data] - 成功時のレスポンスデータ
 * @property {string} [error] - 失敗時のエラーメッセージ
 */

/**
 * ChromeMessageSenderクラス
 * Service Worker通信にリトライロジックを提供
 *
 * このクラスはchrome.runtime.sendMessage()をラップし、
 * 一時的な失敗に対して指数バックオフによる再試行を行います。
 * 異なるメッセージングシナリオ（Popup -> Service Worker、Content Script -> Service Worker）
 * で再利用可能に設計されています。
 *
 * @class ChromeMessageSender
 * @example
 * const sender = new ChromeMessageSender();
 * const result = await sender.sendMessageWithRetry(
 *     { type: 'MANUAL_RECORD', payload: { title, url, content } },
 *     { maxRetries: 3 }
 * );
 */
export class ChromeMessageSender {
    /** @type {RetryOptions} */
    #options;

    /**
     * 新しいChromeMessageSenderインスタンスを作成
     * @param {RetryOptions} [options={} ] - デフォルトのリトライオプション
     */
    constructor(options = {}) {
        this.#options = { ...DEFAULT_RETRY_OPTIONS, ...options };
    }

    /**
     * 現在のオプション設定を取得（テスト用）
     * @returns {RetryOptions}
     */
    get options() {
        return { ...this.#options };
    }

    /**
     * Service Workerにメッセージを送信し、自動リトライを行う
     *
     * @param {Message} message - 送信するメッセージ
     * @param {RetryOptions} [customOptions={} ] - デフォルトオプションを上書きする設定
     * @returns {Promise<Response>} Service Workerからのレスポンス
     * @throws {Error} 全てのリトライが失敗した場合
     *
     * @example
     * const sender = new ChromeMessageSender();
     * const result = await sender.sendMessageWithRetry({
     *     type: 'MANUAL_RECORD',
     *     payload: { title, url, content }
     * });
     */
    async sendMessageWithRetry(message, customOptions = {}) {
        const options = { ...this.#options, ...customOptions };
        let lastError = null;
        let attempt = 0;

        while (attempt <= options.maxRetries) {
            try {
                const response = await this.#sendOnce(message);

                // レスポンス構造を検証
                if (!response) {
                    throw new Error('No response received from Service Worker');
                }

                // // DEBUG LOG: 成功ログ
                // addLog(LogType.DEBUG, 'Message sent successfully', {
                //     type: message.type,
                //     attempt: attempt + 1
                // });

                return response;
            } catch (error) {
                lastError = error;
                attempt++;

                // リトライ可能かどうか判定
                if (attempt <= options.maxRetries && this.#isRetryableError(error)) {
                    const delay = this.#calculateDelay(attempt, options);

                    // // DEBUG LOG: リトライログ
                    // addLog(LogType.WARN, 'Message send failed, retrying', {
                    //     type: message.type,
                    //     attempt,
                    //     maxRetries: options.maxRetries,
                    //     delay,
                    //     error: error.message
                    // });

                    await this.#delay(delay);
                } else {
                    // 非リトライ可能なエラー、または最大リトライ回数超過
                    break;
                }
            }
        }

        // 全てのリトライ失敗
        // addLog(LogType.ERROR, 'Message send failed after all retries', {
        //     type: message.type,
        //     attempts: attempt,
        //     error: lastError?.message
        // });

        throw lastError || new Error('Unknown error sending message');
    }

    /**
     * メッセージを1回だけ送信（リトライなし）
     * @private
     * @param {Message} message
     * @returns {Promise<Response>}
     */
    #sendOnce(message) {
        return new Promise((resolve, reject) => {
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
    #isRetryableError(error) {
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
     * @param {RetryOptions} options
     * @returns {number} 遅延時間（ミリ秒）
     */
    #calculateDelay(attempt, options) {
        const delay = options.initialDelay * Math.pow(options.backoffMultiplier, attempt - 1);
        return Math.min(delay, options.maxDelay);
    }

    /**
     * 指定ミリ秒遅延実行
     * @private
     * @param {number} ms
     * @returns {Promise<void>}
     */
    #delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * エラーがリトライ可能かどうか判定（静的ユーティリティメソッド）
     *
     * @static
     * @param {Error} error
     * @returns {boolean}
     *
     * @example
     * const retryable = ChromeMessageSender.isRetryableError(error);
     */
    static isRetryableError(error) {
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
 * @returns {Promise<Response>}
 *
 * @example
 * import { sendMessageWithRetry } from './retryHelper.js';
 * const result = await sendMessageWithRetry({ type: 'VALID_VISIT', payload: { content } });
 */
export async function sendMessageWithRetry(message, options = {}) {
    const sender = new ChromeMessageSender(options);
    return sender.sendMessageWithRetry(message);
}

/**
 * カスタム設定で初期化された送信者インスタンスを作成
 *
 * @param {RetryOptions} options - インスタンスのデフォルトオプション
 * @returns {ChromeMessageSender}
 *
 * @example
 * import { createSender } from './retryHelper.js';
 * const patientSender = createSender({ maxRetries: 5, initialDelay: 200 });
 * const result = await patientSender.sendMessageWithRetry(message);
 */
export function createSender(options = {}) {
    return new ChromeMessageSender(options);
}