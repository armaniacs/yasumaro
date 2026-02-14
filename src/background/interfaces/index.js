/**
 * Module Interfaces
 *
 * このファイルはシステムの主要なモジュールのインターフェース（契約）を定義します。
 * JavaScriptではJSDocを使用してインターフェースを文書化し、型検証を行います。
 */

/**
 * @interface ITabCache
 * タブキャッシュ（TabCache）のインターフェース
 *
 * 【ISP Compliance】: 必要なメソッドのみを定義。
 * クライアントは使用しないメソッドを強制されません。
 */
export const ITabCache = {
    /**
     * キャッシュを初期化する
     * @returns {Promise<void>}
     */
    initialize: 'async function(): Promise<void>',

    /**
     * タブをキャッシュに追加する
     * @param {chrome.tabs.Tab} tab - 追加するタブ
     * @returns {void}
     */
    add: 'function(tab: chrome.tabs.Tab): void',

    /**
     * タブIDからタブを取得する
     * @param {number} tabId - タブID
     * @returns {chrome.tabs.Tab | undefined}
     */
    get: 'function(tabId: number): chrome.tabs.Tab | undefined',

    /**
     * タブのデータを更新する
     * @param {number} tabId - タブID
     * @param {Partial<chrome.tabs.Tab>} data - 更新するデータ
     * @returns {void}
     */
    update: 'function(tabId: number, data: Partial<chrome.tabs.Tab>): void',

    /**
     * タブをキャッシュから削除する
     * @param {number} tabId - タブID
     * @returns {void}
     */
    remove: 'function(tabId: number): void'
};

/**
 * @interface IMutex
 * Mutex（排他制御）のインターフェース
 *
 * 【DIP Compliance】: 具体的なMutex実装ではなく、抽象化されたインターフェースに依存
 */
export const IMutex = {
    /**
     * ロックを取得する（awaitable）
     * @param {number} timeoutMs - タイムアウト（ミリ秒）- オプション
     * @returns {Promise<void>}
     * @throws {Error} タイムアウトした場合
     */
    acquire: 'async function(timeoutMs?: number): Promise<void>',

    /**
     * ロックを解放する
     * @returns {void}
     */
    release: 'function(): void',

    /**
     * ロック中か確認する
     * @returns {boolean}
     */
    isLocked: 'function(): boolean'
};

/**
 * @interface IObsidianClient
 * Obsidianクライアント（URLRecorder）のインターフェース
 *
 * 【ISP Compliance】: クライアントが必要とするメソッドのみを定義
 * 【DIP Compliance】: 具体的な実装ではなくインターフェースに依存
 */
export const IObsidianClient = {
    /**
     * URLをObsidianに記録する
     * @param {string} url - 記録するURL
     * @param {string} summary - 要約
     * @returns {Promise<{success: boolean, message?: string}>}
     */
    recordUrl: 'async function(url: string, summary: string): Promise<{success: boolean, message?: string}>',

    /**
     * Obsidianとの接続をテストする
     * @returns {Promise<{success: boolean, message: string}>}
     */
    testConnection: 'async function(): Promise<{success: boolean, message: string}>'
};

/**
 * @interface IAIClient
 * AIクライアントのインターフェース
 *
 * 【ISP Compliance】: クライアントが必要とするメソッドのみを定義
 * 【DIP Compliance】: 具体的なプロバイダーではなくインターフェースに依存
 */
export const IAIClient = {
    /**
     * コンテンツの要約を生成する
     * @param {string} content - 要約するコンテンツ
     * @returns {Promise<string>}
     */
    generateSummary: 'async function(content: string): Promise<string>',

    /**
     * AI APIとの接続をテストする
     * @returns {Promise<{success: boolean, message: string}>}
     */
    testConnection: 'async function(): Promise<{success: boolean, message: string}>',

    /**
     * ローカルで要約を生成する（APIなし）
     * @param {string} content - 要約するコンテンツ
     * @returns {Promise<string>}
     */
    summarizeLocally: 'async function(content: string): Promise<string>'
};

/**
 * @interface IRecordingLogic
 * 記録ロジックのインターフェース
 *
 * 【ISP Compliance】: クライアントが必要とするメソッドのみを定義
 */
export const IRecordingLogic = {
    /**
     * URLが記録可能か確認する
     * @param {string} url - チェックするURL
     * @returns {Promise<{canRecord: boolean, reason?: string}>}
     */
    canRecord: 'async function(url: string): Promise<{canRecord: boolean, reason?: string}>',

    /**
     * URLを記録する
     * @param {string} url - 記録するURL
     * @param {Object} options - 記録オプション
     * @returns {Promise<{success: boolean, message: string}>}
     */
    record: 'async function(url: string, options?: Record<string, any>): Promise<{success: boolean, message: string}>'
};

/**
 * @interface IPrivacyPipeline
 * プライバシーパイプラインのインターフェース
 */
export const IPrivacyPipeline = {
    /**
     * コンテンツをパイプラインで処理する
     * @param {string} content - 処理するコンテンツ
     * @param {Object} options - 処理オプション
     * @returns {Promise<{summary: string, preview?: string}>}
     */
    process: 'async function(content: string, options?: Record<string, any>): Promise<{summary: string, preview?: string}>'
};

/**
 * @interface ITabCacheStore
 * タブキャッシュストアのインターフェース（TagCacheの実装に使用）
 */

export const ITabCacheStore = {
    /**
     * タブをキャッシュに保存する
     * @param {number} tabId - タブID
     * @param {chrome.tabs.Tab} tab - 保存するタブ
     * @returns {void}
     */
    set: 'function(tabId: number, tab: chrome.tabs.Tab): void',

    /**
     * タブをキャッシュから取得する
     * @param {number} tabId - タブID
     * @returns {chrome.tabs.Tab | undefined}
     */
    get: 'function(tabId: number): chrome.tabs.Tab | undefined',

    /**
     * タブをキャッシュから削除する
     * @param {number} tabId - タブID
     * @returns {void}
     */
    delete: 'function(tabId: number): void',

    /**
     * すべてのタブを取得する
     * @returns {IterableIterator<[number, chrome.tabs.Tab]>}
     */
    entries: 'function(): IterableIterator<[number, chrome.tabs.Tab]>'
};

/**
 * 使用例:
 *
 * ```javascript
 * /\*\*
 *  * @implements {ITabCache}
 *  *\/
 * class TabCache {
 *     async initialize() { /\* ... *\/ }
 *     add(tab) { /\* ... *\/ }
 *     get(tabId) { /\* ... *\/ }
 *     update(tabId, data) { /\* ... *\/ }
 *     remove(tabId) { /\* ... *\/ }
 * }
 *
 * /\*\*
 *  * @implements {IObsidianClient}
 *  *\/
 * class ObsidianClient {
 *     async recordUrl(url, summary) { /\* ... *\/ }
 *     async testConnection() { /\* ... *\/ }
 * }
 * ```
 */