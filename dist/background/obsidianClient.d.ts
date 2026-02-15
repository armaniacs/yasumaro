import { Settings } from '../utils/storage.js';
import { Mutex } from './Mutex.js';
export interface ObsidianConfig {
    baseUrl: string;
    headers: HeadersInit;
    settings: Settings;
}
export interface ObsidianConnectionResult {
    success: boolean;
    message: string;
}
export interface ObsidianClientOptions {
    mutex?: Mutex;
}
export declare class ObsidianClient {
    private mutex;
    /**
     * コンストラクタ
     * @param {Object} options - オプション設定
     * @param {Mutex} options.mutex - カスタムMutexインスタンス（テスト用途）
     */
    constructor(options?: ObsidianClientOptions);
    /**
     * 設定オブジェクトを取得する
     * Problem #2: BASE_HEADERS定数を使用してオブジェクト作成を最適化
     */
    _getConfig(): Promise<ObsidianConfig>;
    /**
     * ポート番号の検証
     * @param {string|number|undefined} port - ポート番号
     * @returns {string} 有効なポート番号（文字列）
     * @throws {Error} ポート番号が無効な場合
     */
    _validatePort(port: string | number | undefined | null): string;
    appendToDailyNote(content: string): Promise<void>;
    _fetchExistingContent(url: string, headers: HeadersInit): Promise<string>;
    _writeContent(url: string, headers: HeadersInit, content: string): Promise<void>;
    _handleError(error: Error, targetUrl: string): Error;
    /**
     * グローバルMutexへのアクセス（テスト用）
     */
    get _globalWriteMutex(): Mutex;
    testConnection(): Promise<ObsidianConnectionResult>;
}
//# sourceMappingURL=obsidianClient.d.ts.map