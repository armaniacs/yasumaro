/**
 * GeminiProvider
 * Google Gemini APIを使用するAIプロバイダー
 */

import { AIProviderStrategy, AIProviderConnectionResult } from './ProviderStrategy.js';
import { fetchWithTimeout, validateUrlForAIRequests } from '../../../utils/fetch.js';
import { addLog, LogType } from '../../../utils/logger.js';
import { getAllowedUrls, Settings } from '../../../utils/storage.js';
import { sanitizePromptContent } from '../../../utils/promptSanitizer.js';

export class GeminiProvider extends AIProviderStrategy {
    private apiKey: string;
    private model: string;
    private timeoutMs: number;

    constructor(settings: Settings) {
        super(settings);
        // storage.jsのStorageKeysと対応するキー名を使用（snake_case）
        this.apiKey = settings.gemini_api_key || '';
        this.model = settings.gemini_model || 'gemini-1.5-flash';
        this.timeoutMs = 30000;
    }

    getName(): string {
        return 'gemini';
    }

    async generateSummary(content: string): Promise<string> {
        if (!this.apiKey) {
            return "Error: API key is missing. Please check your settings.";
        }

        const cleanModelName = this.model.replace(/^models\//, '');
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${cleanModelName}:generateContent`;
        const truncatedContent = content.substring(0, 30000);

        // プロンプトインジェクション対策 - コンテンツのサニタイズ
        const { sanitized: sanitizedContent, warnings, dangerLevel } = sanitizePromptContent(truncatedContent);
        if (warnings.length > 0) {
            addLog(LogType.WARN, `[${this.getName()}] Prompt injection detected: ${warnings.join('; ')}`);
        }
        if (dangerLevel === 'high') {
            // 危険度高でも、サニタイズ後のコンテンツで再評価
            const { dangerLevel: newDangerLevel } = sanitizePromptContent(sanitizedContent);
            if (newDangerLevel === 'high') {
                const cause = warnings.length > 0 ? warnings.join('; ') : 'High risk content detected';
                addLog(LogType.ERROR, `[${this.getName()}] High risk prompt injection blocked: ${cause}`);
                return `Error: Content blocked due to potential security risk. (原因: ${cause})`;
            }
            // サニタイズ後が安全/低リスクの場合は続行（警告のみ）
            addLog(LogType.WARN, `[${this.getName()}] Content sanitized and proceeding with AI request`);
        }

        const payload = {
            contents: [{
                parts: [{
                    text: `以下のWebページの内容を、日本語で簡潔に要約してください。
                           1文または2文で、重要なポイントをまとめてください。改行しないこと。

                           Content:
                           ${sanitizedContent}`
                }]
            }]
        };

        try {
            const allowedUrls = await this._getAllowedUrls();

            const response = await fetchWithTimeout(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': this.apiKey
                },
                body: JSON.stringify(payload),
                allowedUrls
            }, this.timeoutMs);

            if (!response.ok) {
                return this._handleError(response);
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
        if (!this.apiKey) {
            return { success: false, message: 'Gemini API Key is not set.' };
        }

        const testUrl = 'https://generativelanguage.googleapis.com/v1beta/models';

        // BaseUrl SSRF対策 - テストURLの検証
        try {
            validateUrlForAIRequests(testUrl);
        } catch (error: any) {
            addLog(LogType.ERROR, `Invalid test URL for Gemini: ${error.message}`);
            return { success: false, message: `Invalid test URL: ${error.message}` };
        }

        try {
            const allowedUrls = await this._getAllowedUrls();

            const response = await fetchWithTimeout(
                testUrl,
                {
                    method: 'GET',
                    headers: { 'x-goog-api-key': this.apiKey },
                    allowedUrls
                },
                this.timeoutMs
            );

            if (response.ok) {
                return { success: true, message: 'Connected to Gemini API.' };
            }

            // より詳細なエラーメッセージ
            if (response.status === 401 || response.status === 403) {
                return { success: false, message: `Authentication failed (${response.status}). Check your Gemini API key.` };
            } else if (response.status === 429) {
                return { success: false, message: `Rate limit exceeded (429). Please try again later.` };
            } else {
                return { success: false, message: `Gemini API Error: ${response.status} ${response.statusText}` };
            }
        } catch (e: any) {
            // より具体的なエラーメッセージ
            if (e.message.includes('timeout')) {
                return { success: false, message: 'Connection timeout. Check your network connection.' };
            } else {
                return { success: false, message: `Connection error: ${e.message}` };
            }
        }
    }

    private async _getAllowedUrls(): Promise<Set<string>> {
        return getAllowedUrls();
    }

    private async _handleError(response: Response): Promise<string> {
        // const errorText = await response.text();
        if (response.status === 404) {
            return "Error: Model not found. Please check your AI model settings.";
        }
        return "Error: Failed to generate summary. Please check your API settings.";
    }

    private _extractSummary(data: any): string {
        if (data.candidates && data.candidates.length > 0 && data.candidates[0].content) {
            return data.candidates[0].content.parts[0].text;
        }
        return "No summary generated.";
    }
}