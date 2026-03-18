/**
 * OpenAIProvider
 * OpenAI互換APIを使用するAIプロバイダー
 */

import { AIProviderStrategy, AIProviderConnectionResult, AISummaryResult } from './ProviderStrategy.js';
import { fetchWithRetry, validateUrlForAIRequests } from '../../../utils/fetch.js';
import { addLog, LogType } from '../../../utils/logger.js';
import { getAllowedUrls, Settings, StorageKeys } from '../../../utils/storage.js';
import { sanitizePromptContent } from '../../../utils/promptSanitizer.js';
import { applyCustomPrompt } from '../../../utils/customPromptUtils.js';

export class OpenAIProvider extends AIProviderStrategy {
    private providerName: string;
    private baseUrl: string;
    private apiKey: string | undefined;
    private model: string;
    private timeoutMs: number;

    constructor(settings: Settings, providerName: string = 'openai') {
        super(settings);
        this.providerName = providerName;
        this.timeoutMs = 30000;

        const s = settings as any;

        // For openai-compatible provider, use generic provider keys
        if (providerName === 'openai-compatible') {
            this.baseUrl = s[StorageKeys.PROVIDER_BASE_URL] || '';
            this.apiKey = s[StorageKeys.PROVIDER_API_KEY];
            this.model = s[StorageKeys.PROVIDER_MODEL] || '';
        } else {
            // snake_caseキー名を使用（storage.jsのStorageKeysと対応）
            const normalizedName = providerName.replace('2', '_2').toLowerCase();
            this.baseUrl = s[`${normalizedName}_base_url`] || 'https://api.openai.com/v1';
            this.apiKey = s[`${normalizedName}_api_key`];
            this.model = s[`${normalizedName}_model`] || 'gpt-3.5-turbo';
        }

        // BaseUrl SSRF対策
        if (this.baseUrl) {
            try {
                validateUrlForAIRequests(this.baseUrl);
            } catch (error: any) {
                addLog(LogType.ERROR, `Invalid baseUrl for ${providerName}: ${error.message}`);
                throw new Error(`Invalid baseUrl: ${error.message}`);
            }
        }
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
            return { summary: "Error: Base URL is missing. Please check your settings." };
        }

        const trimmedBaseUrl = this.baseUrl.replace(/\/$/, '');
        const url = `${trimmedBaseUrl}/chat/completions`;
        const truncatedContent = content.substring(0, 30000);

        // プロンプトインジェクション対策 - コンテンツのサニタイズ
        const { sanitized: sanitizedContent, warnings, dangerLevel } = sanitizePromptContent(truncatedContent);
        if (warnings.length > 0) {
            addLog(LogType.WARN, `[${this.providerName}] Prompt injection detected: ${warnings.join('; ')}`);
        }
        if (dangerLevel === 'high') {
            // 危険度高でも、サニタイズ後のコンテンツで再評価
            const { dangerLevel: newDangerLevel } = sanitizePromptContent(sanitizedContent);
            if (newDangerLevel === 'high') {
                const cause = warnings.length > 0 ? warnings.join('; ') : 'High risk content detected';
                addLog(LogType.ERROR, `[${this.providerName}] High risk prompt injection blocked: ${cause}`);
                return { summary: `Error: Content blocked due to potential security risk. (原因: ${cause})` };
            }
            // サニタイズ後が安全/低リスクの場合は続行（警告のみ）
            addLog(LogType.WARN, `[${this.providerName}] Content sanitized and proceeding with AI request`);
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
                maxDelayMs: 60000
            });

            if (!response.ok) {
                return { summary: "Error: Failed to generate summary. Please check your API settings." };
            }

            const data = await response.json();
            return this._extractSummary(data);
        } catch (error: any) {
            if (error.message.includes('timed out')) {
                return { summary: "Error: AI request timed out. Please check your connection." };
            }
            return { summary: "Error: Failed to generate summary. Please try again or check your settings." };
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
        } catch (e: any) {
            // より具体的なエラーメッセージ
            if (e.message.includes('timeout')) {
                return { success: false, message: 'Connection timeout. Check your network or Base URL.' };
            } else if (e.message.includes('Failed to fetch') || e.name === 'TypeError') {
                return { success: false, message: 'Cannot connect. Check your Base URL and network.' };
            } else {
                return { success: false, message: `Connection error: ${e.message}` };
            }
        }
    }

    private async _getAllowedUrls(): Promise<Set<string>> {
        return getAllowedUrls();
    }

    private _extractSummary(data: any): AISummaryResult {
        if (data.choices && data.choices.length > 0 && data.choices[0].message) {
            const summary = data.choices[0].message.content;
            const sentTokens = data.usage?.prompt_tokens;
            const receivedTokens = data.usage?.completion_tokens;
            return { summary, sentTokens, receivedTokens };
        }
        return { summary: "No summary generated." };
    }
}