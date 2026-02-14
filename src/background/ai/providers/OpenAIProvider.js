/**
 * OpenAIProvider
 * OpenAI互換APIを使用するAIプロバイダー
 */

import { AIProviderStrategy } from './ProviderStrategy.js';
import { fetchWithTimeout } from '../../../utils/fetch.js';
import { addLog, LogType } from '../../../utils/logger.js';

export class OpenAIProvider extends AIProviderStrategy {
    constructor(settings, providerName = 'openai') {
        super(settings);
        this.providerName = providerName;
        // snake_caseキー名を使用（storage.jsのStorageKeysと対応）
        const normalizedName = providerName.replace('2', '_2').toLowerCase();
        this.baseUrl = settings[`${normalizedName}_base_url`] || 'https://api.openai.com/v1';
        this.apiKey = settings[`${normalizedName}_api_key`];
        this.model = settings[`${normalizedName}_model`] || 'gpt-3.5-turbo';
        this.timeoutMs = 30000;
    }

    getName() {
        return this.providerName;
    }

    async generateSummary(content) {
        if (!this.baseUrl) {
            return "Error: Base URL is missing. Please check your settings.";
        }

        const trimmedBaseUrl = this.baseUrl.replace(/\/$/, '');
        const url = `${trimmedBaseUrl}/chat/completions`;
        const truncatedContent = content.substring(0, 30000);

        const payload = {
            model: this.model,
            messages: [
                {
                    role: "system",
                    content: "You are a helpful assistant that summarizes web pages effectively and concisely in Japanese."
                },
                {
                    role: "user",
                    content: `以下のWebページの内容を、日本語で簡潔に要約してください。
                           1文または2文で、重要なポイントをまとめてください。改行しないこと。

                           Content:
                           ${truncatedContent}`
                }
            ]
        };

        const headers = { 'Content-Type': 'application/json' };
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
        } catch (error) {
            if (error.message.includes('timed out')) {
                return "Error: AI request timed out. Please check your connection.";
            }
            return "Error: Failed to generate summary. Please try again or check your settings.";
        }
    }

    async testConnection() {
        if (!this.baseUrl) {
            return { success: false, message: 'Base URL is not set.' };
        }

        const trimmedBaseUrl = this.baseUrl.replace(/\/$/, '');
        const url = `${trimmedBaseUrl}/models`;

        const headers = { 'Content-Type': 'application/json' };
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
            return { success: false, message: `AI API Error: ${response.status}` };
        } catch (e) {
            return { success: false, message: e.message };
        }
    }

    async _getAllowedUrls() {
        const { getAllowedUrls } = await import('../../../utils/storage.js');
        return getAllowedUrls();
    }

    _extractSummary(data) {
        if (data.choices && data.choices.length > 0 && data.choices[0].message) {
            return data.choices[0].message.content;
        }
        return "No summary generated.";
    }
}