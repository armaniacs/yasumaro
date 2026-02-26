/**
 * OpenAIProvider
 * OpenAI互換APIを使用するAIプロバイダー
 */

import { AIProviderStrategy, AIProviderConnectionResult } from './ProviderStrategy.js';
import { fetchWithTimeout, validateUrlForAIRequests } from '../../../utils/fetch.js';
import { addLog, LogType } from '../../../utils/logger.js';
import { getAllowedUrls, Settings } from '../../../utils/storage.js';
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
        // snake_caseキー名を使用（storage.jsのStorageKeysと対応）
        const normalizedName = providerName.replace('2', '_2').toLowerCase();

        // Settings interface needs index signature or explicit properties
        // For now, casting strict Settings to any to access dynamic properties or assume Settings has index signature
        const s = settings as any;

        this.baseUrl = s[`${normalizedName}_base_url`] || 'https://api.openai.com/v1';
        this.apiKey = s[`${normalizedName}_api_key`];
        this.model = s[`${normalizedName}_model`] || 'gpt-3.5-turbo';
        this.timeoutMs = 30000;

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
    async generateSummary(content: string, tagSummaryMode: boolean = false): Promise<string> {
        if (!this.baseUrl) {
            return "Error: Base URL is missing. Please check your settings.";
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
                return `Error: Content blocked due to potential security risk. (原因: ${cause})`;
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
            ]
        };

        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (this.apiKey) {
            headers['Authorization'] = `Bearer ${this.apiKey}`;
        }

        try {
            const allowedUrls = await this._getAllowedUrls();

            const response = await fetchWithTimeout(url, {
                method: 'POST',
                headers,
                body: JSON.stringify(payload),
                allowedUrls
            }, this.timeoutMs);

            if (!response.ok) {
                return "Error: Failed to generate summary. Please check your API settings.";
            }

            const data = await response.json();
            return this._extractSummary(data);
        } catch (error: any) {
            if (error.message.includes('timed out')) {
                return "Error: AI request timed out. Please check your connection.";
            }
            return "Error: Failed to generate summary. Please try again or check your settings.";
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

            const response = await fetchWithTimeout(url, {
                method: 'GET',
                headers,
                allowedUrls
            }, this.timeoutMs);

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

    private _extractSummary(data: any): string {
        if (data.choices && data.choices.length > 0 && data.choices[0].message) {
            return data.choices[0].message.content;
        }
        return "No summary generated.";
    }
}