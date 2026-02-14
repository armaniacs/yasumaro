/**
 * GeminiProvider
 * Google Gemini APIを使用するAIプロバイダー
 */

import { AIProviderStrategy } from './ProviderStrategy.js';
import { fetchWithTimeout } from '../../../utils/fetch.js';
import { addLog, LogType } from '../../../utils/logger.js';

export class GeminiProvider extends AIProviderStrategy {
    constructor(settings) {
        super(settings);
        // storage.jsのStorageKeysと対応するキー名を使用（snake_case）
        this.apiKey = settings.gemini_api_key;
        this.model = settings.gemini_model || 'gemini-1.5-flash';
        this.timeoutMs = 30000;
    }

    getName() {
        return 'gemini';
    }

    async generateSummary(content) {
        if (!this.apiKey) {
            return "Error: API key is missing. Please check your settings.";
        }

        const cleanModelName = this.model.replace(/^models\//, '');
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${cleanModelName}:generateContent`;
        const truncatedContent = content.substring(0, 30000);

        const payload = {
            contents: [{
                parts: [{
                    text: `以下のWebページの内容を、日本語で簡潔に要約してください。
                           1文または2文で、重要なポイントをまとめてください。改行しないこと。

                           Content:
                           ${truncatedContent}`
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
        } catch (error) {
            if (error.message.includes('timed out')) {
                return "Error: AI request timed out. Please check your connection.";
            }
            return "Error: Failed to generate summary. Please try again or check your settings.";
        }
    }

    async testConnection() {
        if (!this.apiKey) {
            return { success: false, message: 'Gemini API Key is not set.' };
        }

        try {
            const allowedUrls = await this._getAllowedUrls();

            const response = await fetchWithTimeout(
                'https://generativelanguage.googleapis.com/v1beta/models',
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
            return { success: false, message: `Gemini API Error: ${response.status}` };
        } catch (e) {
            return { success: false, message: e.message };
        }
    }

    async _getAllowedUrls() {
        const { getAllowedUrls } = await import('../../../utils/storage.js');
        return getAllowedUrls();
    }

    async _handleError(response) {
        const errorText = await response.text();
        if (response.status === 404) {
            return "Error: Model not found. Please check your AI model settings.";
        }
        return "Error: Failed to generate summary. Please check your API settings.";
    }

    _extractSummary(data) {
        if (data.candidates && data.candidates.length > 0 && data.candidates[0].content) {
            return data.candidates[0].content.parts[0].text;
        }
        return "No summary generated.";
    }
}