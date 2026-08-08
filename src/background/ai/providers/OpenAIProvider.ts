/**
 * OpenAIProvider
 * OpenAI互換APIを使用するAIプロバイダー
 */

import { AIProviderStrategy, AIProviderConnectionResult, AISummaryResult } from './ProviderStrategy.js';
import { fetchWithRetry, validateUrlForAIRequests, CONNECTION_TEST_CACHE_MODE } from '../../../utils/fetch.js';
import { addLog, LogType } from '../../../utils/logger.js';
import { getAllowedUrls, Settings, StorageKeys } from '../../../utils/storage.js';
import { errorMessage } from '../../../utils/errorUtils.js';
import { applyCustomPrompt } from '../../../utils/customPromptUtils.js';
import { recordUsage } from '../../../utils/aiUsageTracker.js';
import { normalizeProviderKeyName, resolveModelKey } from '../../../utils/aiModelKey.js';

interface OpenAIApiResponse {
    choices?: Array<{ message?: { content: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export class OpenAIProvider extends AIProviderStrategy {
    private providerName: string;
    private baseUrl: string;
    private apiKey: string | undefined;
    private model: string;
    private timeoutMs: number;

    constructor(settings: Settings, providerName: string = 'openai') {
        super(settings);
        this.providerName = providerName;

        const s = settings as Record<string, unknown>;
        const str = (key: string, fallback = '') => String(s[key] ?? fallback) || fallback;

        // For openai-compatible provider, use generic provider keys
        if (providerName === 'openai-compatible') {
            this.baseUrl = str(StorageKeys.PROVIDER_BASE_URL);
            this.apiKey = s[StorageKeys.PROVIDER_API_KEY] as string | undefined;
            this.model = str(StorageKeys.PROVIDER_MODEL);
        } else if (providerName === 'lm-studio') {
            // LM Studio専用キー（APIキー不要）
            this.baseUrl = str(StorageKeys.LM_STUDIO_BASE_URL, 'http://127.0.0.1:1234/v1');
            this.apiKey = undefined;
            this.model = str(StorageKeys.LM_STUDIO_MODEL);
        } else if (providerName === 'ollama') {
            // Ollama専用キー（APIキー不要）
            this.baseUrl = str(StorageKeys.OLLAMA_BASE_URL, 'http://localhost:11434/v1');
            this.apiKey = undefined;
            this.model = str(StorageKeys.OLLAMA_MODEL);
        } else {
            // snake_caseキー名を使用（storage.jsのStorageKeysと対応）
            const normalizedName = normalizeProviderKeyName(providerName);
            this.baseUrl = str(`${normalizedName}_base_url`, 'https://api.openai.com/v1');
            this.apiKey = s[`${normalizedName}_api_key`] as string | undefined;
            this.model = str(resolveModelKey(providerName), 'gpt-3.5-turbo');
        }

        // BaseUrl SSRF対策
        if (this.baseUrl) {
            try {
                validateUrlForAIRequests(this.baseUrl);
            } catch (error: unknown) {
                addLog(LogType.ERROR, `Invalid baseUrl for ${providerName}: ${errorMessage(error)}`);
                throw new Error(`Invalid baseUrl: ${errorMessage(error)}`);
            }
        }

        // タイムアウト設定: 0=自動（ローカル=120秒、クラウド=30秒）
        const storedTimeout = Number(s[StorageKeys.AI_TIMEOUT_MS] ?? 0);
        if (storedTimeout > 0) {
            this.timeoutMs = storedTimeout;
        } else {
            // ローカルホスト（127.x.x.x / localhost）かどうかで自動判定
            const isLocal = this.baseUrl ? OpenAIProvider.isLocalUrl(this.baseUrl) : false;
            this.timeoutMs = isLocal ? 120000 : 30000;
        }
    }

    private static isLocalUrl(url: string): boolean {
        try {
            const { hostname } = new URL(url);
            if (hostname === 'localhost' || hostname.endsWith('.localhost')) return true;
            const firstOctet = Number(hostname.split('.')[0]);
            if (firstOctet === 127) return true;
            if (hostname.toLowerCase() === '::1') return true;
        } catch {
            // 無効なURLは非ローカル扱い
        }
        return false;
    }

    private getMaxContentLength(): number {
        return this.getMaxContentChars(10_000, StorageKeys.OPENAI_CONTENT_CHARS);
    }

    getName(): string {
        return this.providerName;
    }

    /**
     * 要約を生成する
     * @param {string} content - 要約対象のコンテンツ
     * @param {boolean} [tagSummaryMode=false] - タグ付き要約モード
     */
    async generateSummary(content: string, tagSummaryMode: boolean = false, traceId: string = ''): Promise<AISummaryResult> {
        if (!this.baseUrl) {
            return { success: false, summary: "Error: Base URL is missing. Please check your settings." };
        }

        // 共通プリフライトガード
        const preFlight = await this.checkPreFlight();
        if (preFlight.blocked) {
            return { success: false, summary: preFlight.message! };
        }

        const trimmedBaseUrl = this.baseUrl.replace(/\/$/, '');
        const url = `${trimmedBaseUrl}/chat/completions`;
        const contentLimit = OpenAIProvider.isLocalUrl(this.baseUrl)
            ? 4000
            : this.getMaxContentLength();
        const truncatedContent = content.substring(0, contentLimit);

        // 共通サニタイズ
        const sanitizeResult = this.sanitizeContent(truncatedContent, this.providerName, traceId);
        if (sanitizeResult.blocked) {
            return { success: false, summary: `Error: Content blocked due to potential security risk. (原因: ${sanitizeResult.warnings.join('; ')})` };
        }

        // カスタムプロンプトを適用（タグ付き要約モード対応）
        const { userPrompt, systemPrompt } = applyCustomPrompt(this.settings, this.providerName, sanitizeResult.sanitized, tagSummaryMode);

        const payload = {
            model: this.model,
            messages: [
                {
                    role: "system",
                    content: systemPrompt
                },
                {
                    role: "user",
                    content: userPrompt
                }
            ],
            max_tokens: this.getMaxTokens(),
            temperature: 0.1
        };

        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (this.apiKey) {
            headers['Authorization'] = `Bearer ${this.apiKey}`;
        }

        try {
            const allowedUrls = await this._getAllowedUrls();

            const response = await fetchWithRetry(url, {
                method: 'POST',
                headers,
                body: JSON.stringify(payload),
                allowedUrls,
                timeoutMs: this.timeoutMs
            }, {
                maxRetryCount: 3,
                initialDelayMs: 1000,
                backoffMultiplier: 2,
                maxDelayMs: 60000,
                shouldRetry: (error: Error, attempt: number, response: Response | null, method?: string) => {
                    if (response?.status === 429) return false;
                    if (response && response.status >= 500) {
                        return !['POST', 'PUT', 'PATCH'].includes(method?.toUpperCase() ?? 'POST');
                    }
                    if (error.name === 'AbortError' || error.message.includes('timed out')) {
                        return attempt <= 1;
                    }
                    if (error.name === 'NetworkError' || error.message.includes('NetworkError') || error.message.includes('fetch failed')) {
                        return true;
                    }
                    return false;
                }
            });

            if (!response.ok) {
                return { success: false, summary: "Error: Failed to generate summary. Please check your API settings." };
            }

            const data = await response.json();
            return this._extractSummary(data, traceId);
        } catch (error: unknown) {
            const msg = errorMessage(error);
            const isTimeout = error instanceof Error && error.name === 'AbortError';
            if (isTimeout || msg.includes('timed out')) {
                return { success: false, summary: "Error: AI request timed out. Please check your connection." };
            }
            return { success: false, summary: "Error: Failed to generate summary. Please try again or check your settings." };
        }
    }

    async testConnection(): Promise<AIProviderConnectionResult> {
        if (!this.baseUrl) {
            return {
                success: false,
                message: 'Base URL is not set.',
                debug: { error: 'Base URL is missing' },
            };
        }

        const trimmedBaseUrl = this.baseUrl.replace(/\/$/, '');
        const url = `${trimmedBaseUrl}/models`;

        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (this.apiKey) {
            headers['Authorization'] = `Bearer ${this.apiKey}`;
        }

        try {
            const allowedUrls = await this._getAllowedUrls();

            const response = await fetchWithRetry(url, {
                method: 'GET',
                headers,
                allowedUrls,
                timeoutMs: this.timeoutMs,
                cache: CONNECTION_TEST_CACHE_MODE
            }, {
                maxRetryCount: 1,
                initialDelayMs: 500,
                backoffMultiplier: 2,
                maxDelayMs: 3000
            });

            if (response.ok) {
                return {
                    success: true,
                    message: 'Connected to AI API.',
                    debug: { prompt: `GET ${url}`, response: `HTTP ${response.status} OK`, hasContent: true },
                };
            }

            // 共通HTTPステータスマッピング
            return this.mapConnectionError(response.status, 'OpenAI');
        } catch (e: unknown) {
            const msg = errorMessage(e);
            const errorName = e instanceof Error ? e.name : undefined;
            // 共通エラーパース
            return this.parseAndMapFetchError(msg, 'OpenAI', errorName);
        }
    }

    private async _getAllowedUrls(): Promise<Set<string>> {
        return getAllowedUrls();
    }

    private async _extractSummary(data: OpenAIApiResponse, traceId: string = ''): Promise<AISummaryResult> {
        if (!data.choices || data.choices.length === 0) {
            const error = 'OpenAI schema validation failed: choices is missing or empty';
            addLog(LogType.ERROR, error, { traceId });
            return { success: false, summary: "Error: Invalid API response format - unexpected schema.", error };
        }
        if (!data.choices[0].message) {
            const error = 'OpenAI schema validation failed: choices[0].message is missing';
            addLog(LogType.ERROR, error, { traceId });
            return { success: false, summary: "Error: Invalid API response format - unexpected schema.", error };
        }
        const content = data.choices[0].message.content;
        if (typeof content !== 'string') {
            const error = 'OpenAI schema validation failed: message.content is not a string';
            addLog(LogType.ERROR, error, { traceId });
            return { success: false, summary: "Error: Invalid API response format - unexpected schema.", error };
        }
        const sentTokens = data.usage?.prompt_tokens;
        const receivedTokens = data.usage?.completion_tokens;

        // トークン使用量を記録（成功時のみ）
        if (sentTokens !== undefined || receivedTokens !== undefined) {
            await recordUsage(sentTokens ?? 0, receivedTokens ?? 0);
        }

        return { success: true, summary: content, sentTokens, receivedTokens, providerName: this.providerName, modelName: this.model };
    }
}