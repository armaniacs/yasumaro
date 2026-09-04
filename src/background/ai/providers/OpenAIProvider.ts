/**
 * OpenAIProvider
 * OpenAI互換APIを使用するAIプロバイダー — registry 駆動の Generic 実装
 */

import { AIProviderStrategy, AIProviderConnectionResult, AISummaryResult, CONNECTION_TEST_PROMPT } from './ProviderStrategy.js';
import { fetchWithRetry, validateUrlForAIRequests } from '../../../utils/fetch.js';
import { addLog, LogType } from '../../../utils/logger.js';
import { getAllowedUrls } from '../../../utils/storage/urlWhitelist.js';
import { Settings, StorageKeys } from '../../../utils/storage/types.js';
import { errorMessage } from '../../../utils/errorUtils.js';
import { applyCustomPrompt } from '../../../utils/customPromptUtils.js';

import { getRegistryEntry, isAllowedProviderBaseUrl } from '../providerCatalog.js';
import { pickDefined } from '../../../utils/objectUtils.js';
import { readJsonCapped } from '../../../utils/readBodyCapped.js';

/** Default byte cap for AI provider JSON responses. */
const MAX_AI_RESPONSE_BYTES = 10 * 1024 * 1024; // 10MB

interface OpenAIApiResponse {
    choices?: Array<{ message?: { content: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export class GenericOpenAICompatibleProvider extends AIProviderStrategy {
    protected providerName: string;
    protected baseUrl: string;
    protected apiKey: string | undefined;
    protected model: string;
    protected timeoutMs: number;
    protected isLocal: boolean;

    constructor(settings: Settings, providerName: string = 'openai') {
        super(settings);
        this.providerName = providerName;

        const s = settings as Record<string, unknown>;
        const str = (key: string, fallback = '') => String(s[key] ?? fallback) || fallback;

        const entry = getRegistryEntry(providerName);
        if (entry) {
            if (entry.baseUrlKey) {
                this.baseUrl = str(entry.baseUrlKey, entry.defaultBaseUrl ?? '');
            } else {
                this.baseUrl = entry.defaultBaseUrl ?? '';
            }
            if (entry.apiKeyKey) {
                this.apiKey = s[entry.apiKeyKey] as string | undefined;
            } else {
                this.apiKey = undefined;
            }
            if (entry.modelKey) {
                this.model = str(entry.modelKey, entry.defaultModel ?? '');
            } else {
                this.model = entry.defaultModel ?? '';
            }
            this.isLocal = entry.isLocal;
        } else {
            // Fallback for unknown providers — preserve legacy string-replace behavior
            const normalizedName = providerName.replace('2', '_2').replace(/-/g, '_').toLowerCase();
            this.baseUrl = str(`${normalizedName}_base_url`, 'https://api.openai.com/v1');
            this.apiKey = s[`${normalizedName}_api_key`] as string | undefined;
            const modelKey = providerName === 'openai-compatible' ? StorageKeys.PROVIDER_MODEL : `${normalizedName}_model`;
            this.model = str(modelKey, 'gpt-3.5-turbo');
            this.isLocal = this.baseUrl ? GenericOpenAICompatibleProvider.isLocalUrl(this.baseUrl) : false;
        }

        // BaseUrl SSRF対策 — validateUrlForAIRequests + registry allowlist (PBI04)
        if (this.baseUrl) {
            try {
                validateUrlForAIRequests(this.baseUrl);
                if (!isAllowedProviderBaseUrl(this.baseUrl, this.isLocal)) {
                    throw new Error(`Base URL not allowed for ${providerName}: ${this.baseUrl}`);
                }
            } catch (error: unknown) {
                addLog(LogType.ERROR, `Invalid baseUrl for ${providerName}: ${errorMessage(error)}`);
                throw new Error(`Invalid baseUrl: ${errorMessage(error)}`);
            }
        }

        // タイムアウト設定: 0=自動（isLocal から導出）
        const storedTimeout = Number(s[StorageKeys.AI_TIMEOUT_MS] ?? 0);
        if (storedTimeout > 0) {
            this.timeoutMs = storedTimeout;
        } else {
            this.timeoutMs = this.isLocal ? 120000 : 30000;
        }
    }

    static isLocalUrl(url: string): boolean {
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
        const contentLimit = this.isLocal
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
                shouldRetry: (error, attempt, response, method) =>
                    this.shouldRetrySummaryRequest(error, attempt, response, method)
            });

            if (!response.ok) {
                return { success: false, summary: "Error: Failed to generate summary. Please check your API settings." };
            }

            const data = await readJsonCapped(response, MAX_AI_RESPONSE_BYTES) as OpenAIApiResponse;
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
        // モデル一覧(GET /models)ではなく実際に推論を走らせる。メタデータ取得では
        // APIキーの有効性やモデル名の妥当性、実際の応答内容が検証できないため。
        const url = `${trimmedBaseUrl}/chat/completions`;

        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (this.apiKey) {
            headers['Authorization'] = `Bearer ${this.apiKey}`;
        }

        const payload = {
            model: this.model,
            messages: [{ role: 'user', content: CONNECTION_TEST_PROMPT }],
            max_tokens: 16,
            temperature: 0,
        };

        try {
            const allowedUrls = await this._getAllowedUrls();

            const response = await fetchWithRetry(url, {
                method: 'POST',
                headers,
                body: JSON.stringify(payload),
                allowedUrls,
                timeoutMs: this.timeoutMs
            }, {
                maxRetryCount: 1,
                initialDelayMs: 500,
                backoffMultiplier: 2,
                maxDelayMs: 3000
            });

            if (!response.ok) {
                // 共通HTTPステータスマッピング（エンドポイントは診断用に残す）
                const mapped = this.mapConnectionError(response.status, 'OpenAI');
                return {
                    ...mapped,
                    debug: {
                        ...mapped.debug,
                        prompt: CONNECTION_TEST_PROMPT,
                        endpoint: `POST ${url}`,
                        statusCode: response.status,
                    },
                };
            }

            const data = await readJsonCapped(response, MAX_AI_RESPONSE_BYTES) as OpenAIApiResponse;
            const text = data.choices?.[0]?.message?.content ?? '';
            const hasContent = text.trim().length > 0;

            return {
                success: hasContent,
                message: hasContent ? 'Connected to AI API.' : 'Response contained no content.',
                debug: {
                    prompt: CONNECTION_TEST_PROMPT,
                    endpoint: `POST ${url}`,
                    modelName: this.model,
                    statusCode: response.status,
                    hasContent,
                    ...pickDefined({ response: hasContent ? text : undefined }),
                    ...(data.usage?.prompt_tokens !== undefined ? { sentTokens: data.usage.prompt_tokens } : {}),
                    ...(data.usage?.completion_tokens !== undefined ? { receivedTokens: data.usage.completion_tokens } : {}),
                    ...(hasContent ? {} : { error: 'choices[0].message.content was empty' }),
                },
            };
        } catch (e: unknown) {
            const msg = errorMessage(e);
            const errorName = e instanceof Error ? e.name : undefined;
            // 共通エラーパース
            const mapped = this.parseAndMapFetchError(msg, 'OpenAI', errorName);
            return {
                ...mapped,
                debug: { ...mapped.debug, prompt: CONNECTION_TEST_PROMPT, endpoint: `POST ${url}` },
            };
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
        if (!data.choices[0]?.message) {
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

        // トークン使用量を記録（成功時のみ、かつ数値が得られた場合のみ）
        await this.recordUsageIfPresent(sentTokens, receivedTokens);

        return { success: true, summary: content, providerName: this.providerName, modelName: this.model, ...pickDefined({ sentTokens, receivedTokens }) };
    }
}

/**
 * @deprecated Use GenericOpenAICompatibleProvider directly. Kept for backward compatibility.
 */
export class OpenAIProvider extends GenericOpenAICompatibleProvider {
    constructor(settings: Settings, providerName: string = 'openai') {
        super(settings, providerName);
    }

    // Keep static helper for callers that reference OpenAIProvider.isLocalUrl
    static override isLocalUrl(url: string): boolean {
        return GenericOpenAICompatibleProvider.isLocalUrl(url);
    }
}
