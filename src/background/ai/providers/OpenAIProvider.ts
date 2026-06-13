/**
 * OpenAIProvider
 * OpenAI互換APIを使用するAIプロバイダー
 */

import { AIProviderStrategy, AIProviderConnectionResult, AISummaryResult } from './ProviderStrategy.js';
import { fetchWithRetry, validateUrlForAIRequests } from '../../../utils/fetch.js';
import { addLog, LogType } from '../../../utils/logger.js';
import { getAllowedUrls, Settings, StorageKeys } from '../../../utils/storage.js';
import { sanitizePromptContent } from '../../../utils/promptSanitizer.js';
import { errorMessage } from '../../../utils/errorUtils.js';
import { applyCustomPrompt } from '../../../utils/customPromptUtils.js';
import { checkRateLimit, recordUsage, getRateLimitMessage } from '../../../utils/aiUsageTracker.js';

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
            const normalizedName = providerName.replace('2', '_2').toLowerCase();
            this.baseUrl = str(`${normalizedName}_base_url`, 'https://api.openai.com/v1');
            this.apiKey = s[`${normalizedName}_api_key`] as string | undefined;
            this.model = str(`${normalizedName}_model`, 'gpt-3.5-turbo');
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

    private static readonly DEFAULT_MAX_CONTENT_LENGTH = 10_000;

    private getMaxContentLength(): number {
        const s = this.settings as Record<string, unknown>;
        const override = s['openai_content_limit'] as number | undefined;
        if (typeof override === 'number' && override > 0 && override <= 100_000) {
            return override;
        }
        return OpenAIProvider.DEFAULT_MAX_CONTENT_LENGTH;
    }

    getName(): string {
        return this.providerName;
    }

    /**
     * 要約を生成する
     * @param {string} content - 要約対象のコンテンツ
     * @param {boolean} [tagSummaryMode=false] - タグ付き要約モード
     */
    async generateSummary(content: string, tagSummaryMode: boolean = false): Promise<AISummaryResult> {
        if (!this.baseUrl) {
            return { success: false, summary: "Error: Base URL is missing. Please check your settings." };
        }

        // レート制限チェック
        const rateLimit = await checkRateLimit();
        if (!rateLimit.allowed) {
            return { success: false, summary: `Error: ${getRateLimitMessage(rateLimit.resetTime)}` };
        }

        const trimmedBaseUrl = this.baseUrl.replace(/\/$/, '');
        const url = `${trimmedBaseUrl}/chat/completions`;
        // ローカルLLMは context size が小さい（4096トークン程度）ため、送信コンテンツを絞る
        // 日本語 1トークン≈2文字 として 4096トークン×2 = ~8192文字が理論上限
        // system prompt・プロンプトテンプレートの分を引き、安全マージンを取り4000文字に制限
        const contentLimit = OpenAIProvider.isLocalUrl(this.baseUrl)
            ? 4000
            : this.getMaxContentLength();
        const truncatedContent = content.substring(0, contentLimit);

        // プロンプトインジェクション対策 - コンテンツのサニタイズ
        const { sanitized: sanitizedContent, warnings, dangerLevel } = sanitizePromptContent(truncatedContent);
        if (warnings.length > 0) {
            addLog(LogType.WARN, `[${this.providerName}] Prompt injection detected: ${warnings.join('; ')}`);
        }
        if (dangerLevel === 'high') {
            const cause = warnings.length > 0 ? warnings.join('; ') : 'High risk content detected';
            addLog(LogType.ERROR, `[${this.providerName}] High risk prompt injection blocked: ${cause}`);
            return { success: false, summary: `Error: Content blocked due to potential security risk. (原因: ${cause})` };
        }

        // カスタムプロンプトを適用（タグ付き要約モード対応）
        const { userPrompt, systemPrompt } = applyCustomPrompt(this.settings, this.providerName, sanitizedContent, tagSummaryMode);

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
                shouldRetry: (error: Error, attempt: number, response: Response | null) => {
                    if (response?.status === 429) return false;
                    if (error.name === 'AbortError' || error.message.includes('timed out')) {
                        return attempt <= 1;
                    }
                    if (error.name === 'NetworkError' || error.message.includes('NetworkError') || error.message.includes('fetch failed')) {
                        return true;
                    }
                    if (response && response.status >= 500) return true;
                    return false;
                }
            });

            if (!response.ok) {
                return { success: false, summary: "Error: Failed to generate summary. Please check your API settings." };
            }

            const data = await response.json();
            return this._extractSummary(data);
        } catch (error: unknown) {
            const msg = errorMessage(error);
            if (msg.includes('timed out')) {
                return { success: false, summary: "Error: AI request timed out. Please check your connection." };
            }
            return { success: false, summary: "Error: Failed to generate summary. Please try again or check your settings." };
        }
    }

    async testConnection(): Promise<AIProviderConnectionResult> {
        if (!this.baseUrl) {
            return { success: false, message: 'Base URL is not set.' };
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
                timeoutMs: this.timeoutMs
            }, {
                maxRetryCount: 1, // テスト接続はリトライ少なめ（早く失敗させる）
                initialDelayMs: 500,
                backoffMultiplier: 2,
                maxDelayMs: 3000
            });

            if (response.ok) {
                return { success: true, message: 'Connected to AI API.' };
            }

            // より詳細なエラーメッセージ
            if (response.status === 401 || response.status === 403) {
                return { success: false, message: `Authentication failed (${response.status}). Check your API key.` };
            } else if (response.status === 404) {
                return { success: false, message: `Endpoint not found (404). Check your Base URL.` };
            } else if (response.status === 429) {
                return { success: false, message: `Rate limit exceeded (429). Please try again later.` };
            } else {
                return { success: false, message: `AI API Error: ${response.status} ${response.statusText}` };
            }
        } catch (e: unknown) {
            const msg = errorMessage(e);
            const errorName = e instanceof Error ? e.name : 'Error';
            if (msg.includes('timeout')) {
                return { success: false, message: 'Connection timeout. Check your network or Base URL.' };
            } else if (msg.includes('Failed to fetch') || errorName === 'TypeError') {
                return { success: false, message: 'Cannot connect. Check your Base URL and network.' };
            } else {
                return { success: false, message: `Connection error: ${msg}` };
            }
        }
    }

    private async _getAllowedUrls(): Promise<Set<string>> {
        return getAllowedUrls();
    }

    private _extractSummary(data: OpenAIApiResponse): AISummaryResult {
        if (data.choices && data.choices.length > 0 && data.choices[0].message) {
            const summary = data.choices[0].message.content;
            const sentTokens = data.usage?.prompt_tokens;
            const receivedTokens = data.usage?.completion_tokens;
            return { success: true, summary, sentTokens, receivedTokens, providerName: this.providerName, model: this.model };
        }
        return { success: true, summary: "No summary generated." };
    }
}