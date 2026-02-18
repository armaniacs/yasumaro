import { getSettings, StorageKeys, Settings } from '../utils/storage.js';
import { buildDailyNotePath } from '../utils/dailyNotePathBuilder.js';
import { NoteSectionEditor } from './noteSectionEditor.js';
import { Mutex } from './Mutex.js';
import { addLog, LogType } from '../utils/logger.js';

/**
 * Problem #2: HTTPヘッダーの固定部分を定数化
 * 毎回のConfig生成で同じオブジェクトを作成するのを防ぐ
 */
const BASE_HEADERS = {
    'Content-Type': 'text/markdown',
    'Accept': 'application/json'
};

/**
 * Problem #1: Fetchタイムアウト設定
 */
const FETCH_TIMEOUT_MS = 15000; // 15秒

/**
 * Problem #2: ポート番号検証定数
 */
const MIN_PORT = 1;
const MAX_PORT = 65535;
const DEFAULT_PORT = '27123';

/**
 * Problem #6: Mutexキューサイズ制限とタイムアウト設定
 */
const MAX_QUEUE_SIZE = 50;
const MUTEX_TIMEOUT_MS = 30000; // 30秒

/**
 * Mutexのインスタンス（クロージャ経由で共有）
 * 日次ノートごとではなく、全体的な書き込み操作をシリアライズ
 */
const globalWriteMutex = new Mutex({
    maxQueueSize: MAX_QUEUE_SIZE,
    timeoutMs: MUTEX_TIMEOUT_MS
});

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

/**
 * Problem #1: タイムアウト付きfetchのラッパー関数
 * @param {string} url - リクエストURL
 * @param {object} options - fetchオプション
 * @returns {Promise<Response>} fetchレスポンス
 * @throws {Error} タイムアウト時にエラーをスロー
 */
async function _fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
        controller.abort();
        addLog(LogType.ERROR, `Obsidian request timed out after ${FETCH_TIMEOUT_MS}ms`, { url });
    }, FETCH_TIMEOUT_MS);

    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(timeoutId);
        return response;
    } catch (error: any) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            throw new Error('Error: Request timed out. Please check your Obsidian connection.');
        }
        throw error;
    }
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
     * Problem #2: BASE_HEADERS定数を使用してオブジェクト作成を最適化
     */
    async _getConfig(): Promise<ObsidianConfig> {
        const settings = await getSettings();

        // Casting to any for dynamic access or if explicit keys are missing in Settings interface
        const s = settings as any;
        const protocol = s[StorageKeys.OBSIDIAN_PROTOCOL] || 'http';
        const rawPort = s[StorageKeys.OBSIDIAN_PORT] || DEFAULT_PORT;
        const port = this._validatePort(rawPort);
        const apiKey = s[StorageKeys.OBSIDIAN_API_KEY];

        addLog(LogType.DEBUG, 'Obsidian API Key check', {
            exists: !!apiKey,
            isEmpty: apiKey === ''
        });

        // APIキーが空文字列、undefined、null、またはオブジェクト（暗号化失敗）の場合
        if (!apiKey || apiKey === '' || typeof apiKey === 'object') {
            console.error('[ObsidianClient] API Key is missing or invalid!', {
                apiKey: typeof apiKey,
                fullKey: apiKey
            });
            addLog(LogType.WARN, 'Obsidian API Key is missing or invalid', { apiKey: typeof apiKey });
            throw new Error('Error: API key is missing. Please check your Obsidian settings.');
        }

        return {
            baseUrl: `${protocol}://127.0.0.1:${port}`,
            headers: {
                ...BASE_HEADERS,
                'Authorization': `Bearer ${apiKey}`
            },
            settings
        };
    }

    /**
     * ポート番号の検証
     * @param {string|number|undefined} port - ポート番号
     * @returns {string} 有効なポート番号（文字列）
     * @throws {Error} ポート番号が無効な場合
     */
    _validatePort(port: string | number | undefined | null): string {
        // 未指定、空文字列の場合はデフォルト値を使用
        if (port === undefined || port === null || port === '') {
            return DEFAULT_PORT;
        }

        // 数値変換
        const portNum = Number(port);

        // 非数値チェック
        if (isNaN(portNum)) {
            throw new Error('Invalid port number. Port must be a valid number.');
        }

        // 整数チェック
        if (!Number.isInteger(portNum)) {
            throw new Error('Invalid port number. Port must be an integer.');
        }

        // 範囲チェック
        if (portNum < MIN_PORT || portNum > MAX_PORT) {
            throw new Error(`Invalid port number. Port must be between ${MIN_PORT} and ${MAX_PORT}.`);
        }

        return String(portNum);
    }

    async appendToDailyNote(content: string): Promise<void> {
        // ロックを取得して競合を回避
        await globalWriteMutex.acquire();

        try {
            const { baseUrl, headers, settings } = await this._getConfig();

            const dailyPathRaw = (settings as any)[StorageKeys.OBSIDIAN_DAILY_PATH] || '';
            const dailyPath = buildDailyNotePath(dailyPathRaw);
            const pathSegment = dailyPath ? `${dailyPath}/` : '';
            const targetUrl = `${baseUrl}/vault/${pathSegment}${buildDailyNotePath('')}.md`;

            try {
                const existingContent = await this._fetchExistingContent(targetUrl, headers);
                const newContent = NoteSectionEditor.insertIntoSection(
                    existingContent,
                    NoteSectionEditor.DEFAULT_SECTION_HEADER,
                    content
                );

                await this._writeContent(targetUrl, headers, newContent);
            } catch (error: any) {
                throw this._handleError(error, targetUrl);
            }
        } finally {
            // 確実にロックを解放
            globalWriteMutex.release();
        }
    }

    async _fetchExistingContent(url: string, headers: HeadersInit): Promise<string> {
        const response = await _fetchWithTimeout(url, {
            method: 'GET',
            headers
        });

        if (response.ok) {
            return await response.text();
        } else if (response.status === 404) {
            return '';
        } else {
            const errorText = await response.text();
            addLog(LogType.ERROR, `Failed to read daily note: ${response.status} ${errorText}`);
            throw new Error('Error: Failed to read daily note. Please check your Obsidian connection.');
        }
    }

    async _writeContent(url: string, headers: HeadersInit, content: string): Promise<void> {
        const response = await _fetchWithTimeout(url, {
            method: 'PUT',
            headers,
            body: content
        });

        if (!response.ok) {
            const errorText = await response.text();
            addLog(LogType.ERROR, `Obsidian API Error: ${response.status} ${errorText}`);
            throw new Error('Error: Failed to write to daily note. Please check your Obsidian connection.');
        }
    }

    _handleError(error: Error, targetUrl: string): Error {
        let errorMessage = error.message;
        if (errorMessage.includes('Failed to fetch') && targetUrl.startsWith('https')) {
            addLog(LogType.ERROR, `Failed to connect to Obsidian at ${targetUrl}`);
            return new Error('Error: Failed to connect to Obsidian. Please visit the Obsidian URL in a new tab and accept the self-signed certificate.');
        }
        addLog(LogType.ERROR, `Failed to connect to Obsidian at ${targetUrl}. Cause: ${errorMessage}`);
        return new Error('Error: Failed to connect to Obsidian. Please check your settings and connection.');
    }

    /**
     * グローバルMutexへのアクセス（テスト用）
     */
    get _globalWriteMutex(): Mutex {
        return globalWriteMutex;
    }

    async testConnection(): Promise<ObsidianConnectionResult> {
        try {
            const { baseUrl, headers } = await this._getConfig();
            addLog(LogType.DEBUG, `Testing Obsidian connection to: ${baseUrl}`);

            const response = await _fetchWithTimeout(`${baseUrl}/`, {
                method: 'GET',
                headers
            });

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
        } catch (e: any) {
            addLog(LogType.ERROR, `Connection test failed: ${e.message}`);

            // より具体的なエラーメッセージ
            if (e.message.includes('timed out')) {
                return { success: false, message: 'Connection timeout. Is Obsidian running?' };
            } else if (e.message.includes('Failed to fetch') || e.name === 'TypeError') {
                return { success: false, message: 'Cannot connect. Check if Obsidian is running and Local REST API is enabled.' };
            } else if (e.message.includes('API key is missing')) {
                return { success: false, message: 'API key is missing. Please enter your Obsidian API key.' };
            } else {
                return { success: false, message: `Connection error: ${e.message}` };
            }
        }
    }
}
