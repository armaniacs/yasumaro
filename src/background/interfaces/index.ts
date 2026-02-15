/**
 * Module Interfaces
 *
 * このファイルはシステムの主要なモジュールのインターフェース（契約）を定義します。
 * TypeScriptのインターフェースを使用して型安全性を確保します。
 */

/**
 * ITabCache
 * タブキャッシュ（TabCache）のインターフェース
 *
 * 【ISP Compliance】: 必要なメソッドのみを定義。
 * クライアントは使用しないメソッドを強制されません。
 */
export interface ITabCache {
    /**
     * キャッシュを初期化する
     */
    initialize(): Promise<void>;

    /**
     * タブをキャッシュに追加する
     * @param tab - 追加するタブ
     */
    add(tab: chrome.tabs.Tab): void;

    /**
     * タブIDからタブを取得する
     * @param tabId - タブID
     */
    get(tabId: number): chrome.tabs.Tab | undefined;

    /**
     * タブのデータを更新する
     * @param tabId - タブID
     * @param data - 更新するデータ
     */
    update(tabId: number, data: Partial<chrome.tabs.Tab>): void;

    /**
     * タブをキャッシュから削除する
     * @param tabId - タブID
     */
    remove(tabId: number): void;
}

/**
 * IMutex
 * Mutex（排他制御）のインターフェース
 *
 * 【DIP Compliance】: 具体的なMutex実装ではなく、抽象化されたインターフェースに依存
 */
export interface IMutex {
    /**
     * ロックを取得する（awaitable）
     * @param timeoutMs - タイムアウト（ミリ秒）- オプション
     * @throws {Error} タイムアウトした場合
     */
    acquire(timeoutMs?: number): Promise<void>;

    /**
     * ロックを解放する
     */
    release(): void;

    /**
     * ロック中か確認する
     */
    isLocked(): boolean;
}

/**
 * IObsidianClient
 * Obsidianクライアント（URLRecorder）のインターフェース
 *
 * 【ISP Compliance】: クライアントが必要とするメソッドのみを定義
 * 【DIP Compliance】: 具体的な実装ではなくインターフェースに依存
 */
export interface IObsidianClient {
    /**
     * URLをObsidianに記録する
     * @param url - 記録するURL
     * @param summary - 要約
     */
    recordUrl(url: string, summary: string): Promise<{ success: boolean, message?: string }>;

    /**
     * Obsidianとの接続をテストする
     */
    testConnection(): Promise<{ success: boolean, message: string }>;
}

/**
 * IAIClient
 * AIクライアントのインターフェース
 *
 * 【ISP Compliance】: クライアントが必要とするメソッドのみを定義
 * 【DIP Compliance】: 具体的なプロバイダーではなくインターフェースに依存
 */
export interface IAIClient {
    /**
     * コンテンツの要約を生成する
     * @param content - 要約するコンテンツ
     */
    generateSummary(content: string): Promise<string>;

    /**
     * AI APIとの接続をテストする
     */
    testConnection(): Promise<{ success: boolean, message: string }>;

    /**
     * ローカルで要約を生成する（APIなし）
     * @param content - 要約するコンテンツ
     */
    summarizeLocally(content: string): Promise<string>;
}

/**
 * IRecordingLogic
 * 記録ロジックのインターフェース
 *
 * 【ISP Compliance】: クライアントが必要とするメソッドのみを定義
 */
export interface IRecordingLogic {
    /**
     * URLが記録可能か確認する
     * @param url - チェックするURL
     */
    canRecord(url: string): Promise<{ canRecord: boolean, reason?: string }>;

    /**
     * URLを記録する
     * @param url - 記録するURL
     * @param options - 記録オプション
     */
    record(url: string, options?: Record<string, any>): Promise<{ success: boolean, message: string }>;
}

/**
 * IPrivacyPipeline
 * プライバシーパイプラインのインターフェース
 */
export interface IPrivacyPipeline {
    /**
     * コンテンツをパイプラインで処理する
     * @param content - 処理するコンテンツ
     * @param options - 処理オプション
     */
    process(content: string, options?: Record<string, any>): Promise<{ summary: string, preview?: string }>;
}

/**
 * ITabCacheStore
 * タブキャッシュストアのインターフェース（TagCacheの実装に使用）
 */
export interface ITabCacheStore {
    /**
     * タブをキャッシュに保存する
     * @param tabId - タブID
     * @param tab - 保存するタブ
     */
    set(tabId: number, tab: chrome.tabs.Tab): void;

    /**
     * タブをキャッシュから取得する
     * @param tabId - タブID
     */
    get(tabId: number): chrome.tabs.Tab | undefined;

    /**
     * タブをキャッシュから削除する
     * @param tabId - タブID
     */
    delete(tabId: number): void;

    /**
     * すべてのタブを取得する
     */
    entries(): IterableIterator<[number, chrome.tabs.Tab]>;
}

/**
 * 使用例:
 *
 * ```typescript
 * class TabCache implements ITabCache {
 *     async initialize() { /* ... *\/ }
 *     add(tab: chrome.tabs.Tab) { /* ... *\/ }
 *     get(tabId: number) { /* ... *\/ }
 *     update(tabId: number, data: Partial<chrome.tabs.Tab>) { /* ... *\/ }
 *     remove(tabId: number) { /* ... *\/ }
 * }
 *
 * class ObsidianClient implements IObsidianClient {
 *     async recordUrl(url: string, summary: string) { /* ... *\/ }
 *     async testConnection() { /* ... *\/ }
 * }
 * ```
 */