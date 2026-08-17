import { getSettings, StorageKeys, Settings } from '../utils/storage.js';
import { buildDailyNotePath } from '../utils/dailyNotePathBuilder.js';
import { NoteSectionEditor } from './noteSectionEditor.js';
import { Mutex } from '../utils/Mutex.js';
import { addLog, LogType } from '../utils/logger.js';
import { errorMessage } from '../utils/errorUtils.js';
import { fetchWithTimeout, CONNECTION_TEST_CACHE_MODE } from '../utils/fetch.js';
import {
    validateObsidianProtocol,
    validateObsidianHost,
    isIpv6Address,
    validateObsidianPort,
    readBodyWithTimeout,
    handleObsidianError,
    type ObsidianProtocol,
} from '../utils/obsidianConfigValidator.js';
import { buildObsidianConfig, type ObsidianConfig } from '../utils/obsidianConfigBuilder.js';

/**
 * Problem #1: Fetchタイムアウト設定
 */
const FETCH_TIMEOUT_MS = 15000; // 15秒

/**
 * Problem #6: Mutexキューサイズ制限とタイムアウト設定
 */
const MAX_QUEUE_SIZE = 50;
const MUTEX_TIMEOUT_MS = 30000; // 30秒

/**
 * Obsidian Local REST API エンドポイントの一元管理。
 * パス文字列をここに集約することで、API仕様変更時の修正箇所を1箇所に限定する。
 * 詳細は dev-docs/API_ENDPOINTS.md を参照。
 */
const ENDPOINTS = {
    /** ヘルスチェック / 接続確認用のルートエンドポイント */
    root: (baseUrl: string): string => `${baseUrl}/`,
    /** デイリーノートの読み取り・書き込み対象パス */
    dailyNote: (baseUrl: string, dailyPath: string): string => {
        const pathSegment = dailyPath ? `${dailyPath}/` : '';
        return `${baseUrl}/vault/${pathSegment}${buildDailyNotePath('')}.md`;
    },
} as const;

/**
 * Mutexのインスタンス（クロージャ経由で共有）
 * 日次ノートごとではなく、全体的な書き込み操作をシリアライズ
 */
const globalWriteMutex = new Mutex({
    maxQueueSize: MAX_QUEUE_SIZE,
    timeoutMs: MUTEX_TIMEOUT_MS
});

export interface ObsidianConnectionResult {
    success: boolean;
    message: string;
}

export interface ObsidianClientOptions {
    mutex?: Mutex;
}

export class ObsidianClient {
    private mutex: Mutex;

    /**
     * コンストラクタ
     * @param {Object} options - オプション設定
     * @param {Mutex} options.mutex - カスタムMutexインスタンス（テスト用途）
     */
    constructor(options: ObsidianClientOptions = {}) {
        this.mutex = options.mutex || globalWriteMutex;
    }

    /**
     * 設定オブジェクトを取得する
     */
    async _getConfig(): Promise<ObsidianConfig> {
        return buildObsidianConfig();
    }

    /**
     * プロトコルの検証
     * @param {string|undefined|null} protocol - Obsidian Local REST API のプロトコル
     * @returns {'http'|'https'} 有効なプロトコル
     * @throws {Error} プロトコルが無効な場合
     */
    _validateProtocol(protocol: string | undefined | null): ObsidianProtocol {
        return validateObsidianProtocol(protocol);
    }

    /**
     * ホスト名の検証
     * @param {string|undefined|null} host - Obsidian Local REST API のホスト
     * @returns {string} 有効なホスト名
     */
    _validateHost(host: string | undefined | null): string {
        return validateObsidianHost(host);
    }

    /**
     * コロンを含み、16進数・コロン・ドット（IPv4埋め込み）のみで構成される
     * 文字列をIPv6アドレスとして判定する
     * @param {string} host - 判定対象の文字列
     * @returns {boolean} IPv6アドレスの場合true
     */
    _isIpv6Address(host: string): boolean {
        return isIpv6Address(host);
    }

    /**
     * ポート番号の検証
     * @param {string|number|undefined} port - ポート番号
     * @returns {string} 有効なポート番号（文字列）
     * @throws {Error} ポート番号が無効な場合
     */
    _validatePort(port: string | number | undefined | null): string {
        return validateObsidianPort(port);
    }

    async appendToDailyNote(content: string, traceId: string = ''): Promise<void> {
        // ロックを取得して競合を回避
        await this.mutex.acquire();

        try {
            const { baseUrl, headers, settings } = await this._getConfig();

            // Settings型は StorageKeys でアクセス可能
            const dailyPathRaw = settings[StorageKeys.OBSIDIAN_DAILY_PATH] || '';
            const dailyPath = buildDailyNotePath(dailyPathRaw);
            const targetUrl = ENDPOINTS.dailyNote(baseUrl, dailyPath);

            try {
                const existingContent = await this._fetchExistingContent(targetUrl, headers, traceId);
                const newContent = NoteSectionEditor.insertIntoSection(
                    existingContent,
                    NoteSectionEditor.DEFAULT_SECTION_HEADER,
                    content
                );

                await this._writeContent(targetUrl, headers, newContent, traceId);
            } catch (error: unknown) {
                throw this._handleError(error instanceof Error ? error : new Error(String(error)), targetUrl, traceId);
            }
        } finally {
            // 確実にロックを解放
            this.mutex.release();
        }
    }

    async _fetchExistingContent(url: string, headers: HeadersInit, traceId: string = ''): Promise<string> {
        const response = await fetchWithTimeout(url, {
            method: 'GET',
            headers,
            skipCspValidation: true,
            allowedUrls: null
        }, FETCH_TIMEOUT_MS);

        if (response.ok) {
            return await this._readBodyWithTimeout(response);
        } else if (response.status === 404) {
            return '';
        } else {
            const errorText = await this._readBodyWithTimeout(response);
            addLog(LogType.ERROR, `Failed to read daily note: ${response.status} ${errorText}`, { traceId });
            throw new Error('Error: Failed to read daily note. Please check your Obsidian connection.');
        }
    }

    /**
     * レスポンスボディをタイムアウト付きで読み込む
     * @param {Response} response - fetchレスポンス
     * @returns {Promise<string>} レスポンスボディ
     * @throws {Error} ボディ読み込みがタイムアウトした場合（name='AbortError'）
     */
    async _readBodyWithTimeout(response: Response): Promise<string> {
        return readBodyWithTimeout(response);
    }

    async _writeContent(url: string, headers: HeadersInit, content: string, traceId: string = ''): Promise<void> {
        const response = await fetchWithTimeout(url, {
            method: 'PUT',
            headers,
            body: content,
            skipCspValidation: true,
            allowedUrls: null
        }, FETCH_TIMEOUT_MS);

        if (!response.ok) {
            const errorText = await response.text();
            addLog(LogType.ERROR, `Obsidian API Error: ${response.status} ${errorText}`, { traceId });
            throw new Error('Error: Failed to write to daily note. Please check your Obsidian connection.');
        }
    }

    _handleError(error: Error, targetUrl: string, traceId: string = ''): Error {
        return handleObsidianError(error, targetUrl, traceId);
    }

    /**
     * グローバルMutexへのアクセス（テスト用）
     */
    get _globalWriteMutex(): Mutex {
        return globalWriteMutex;
    }

    async testConnection(override?: { protocol?: string; port?: string | number; apiKey?: string }): Promise<ObsidianConnectionResult> {
        try {
            let baseUrl: string;
            let headers: HeadersInit;
            if (override) {
                try {
                    const config = await buildObsidianConfig(override);
                    baseUrl = config.baseUrl;
                    headers = config.headers;
                } catch (e: unknown) {
                    const msg = e instanceof Error ? e.message : String(e);
                    if (msg.includes('API key is missing')) {
                        return { success: false, message: 'API key is missing. Please enter your Obsidian API key.' };
                    }
                    return { success: false, message: msg };
                }
            } else {
                ({ baseUrl, headers } = await this._getConfig());
            }
            addLog(LogType.DEBUG, `Testing Obsidian connection to: ${baseUrl}`);

            const response = await fetchWithTimeout(ENDPOINTS.root(baseUrl), {
                method: 'GET',
                headers,
                skipCspValidation: true,
                allowedUrls: null,
                cache: CONNECTION_TEST_CACHE_MODE
            }, FETCH_TIMEOUT_MS);

            if (response.ok) {
                return { success: true, message: 'Success! Connected to Obsidian. Settings Saved.' };
            } else {
                const errorMsg = `HTTP ${response.status}: ${response.statusText}`;
                addLog(LogType.ERROR, `Connection test failed: ${errorMsg}`);

                // 具体的なHTTPステータスコードに基づくエラーメッセージ
                if (response.status === 401 || response.status === 403) {
                    return { success: false, message: `Authentication failed (${response.status}). Check your API key.` };
                } else if (response.status === 404) {
                    return { success: false, message: `Endpoint not found (404). Is Local REST API plugin enabled?` };
                } else {
                    return { success: false, message: `Connection failed: ${errorMsg}` };
                }
            }
        } catch (e: unknown) {
            const msg = errorMessage(e);
            const errorName = e instanceof Error ? e.name : 'Error';
            addLog(LogType.ERROR, `Connection test failed: ${msg}`);

            if (errorName === 'AbortError' || msg.includes('timed out')) {
                return { success: false, message: 'Connection timeout. Is Obsidian running?' };
            } else if (msg.includes('Failed to fetch') || errorName === 'TypeError') {
                return { success: false, message: 'Cannot connect. Check if Obsidian is running and Local REST API is enabled.' };
            } else if (msg.includes('API key is missing')) {
                return { success: false, message: 'API key is missing. Please enter your Obsidian API key.' };
            } else {
                return { success: false, message: `Connection error: ${msg}` };
            }
        }
    }
}
