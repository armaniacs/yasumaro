import { getSettings, StorageKeys, getAllowedUrls } from '../utils/storage.js';
import { LocalAIClient } from './localAiClient.js';
import { GeminiProvider, OpenAIProvider } from './ai/providers/index.js';
import { addLog, LogType } from '../utils/logger.js';
import { fetchWithTimeout } from '../utils/fetch.js';
// AI APIタイムアウト（30秒）
const API_TIMEOUT_MS = 30000;
/**
 * AI Client
 * Strategyパターンによるプロバイダー拡張
 *
 * 【拡張性】: 新しいAIプロバイダーを追加する際はproviderConfigsに設定を追加するのみ
 * 【OCP Compliance】: 既存コードを修正せずに新しいプロバイダーを追加可能
 */
export class AIClient {
    localAiClient;
    providers;
    constructor() {
        this.localAiClient = new LocalAIClient();
        this.providers = new Map();
        this.registerDefaultProviders();
    }
    /**
     * デフォルトプロバイダーを登録
     */
    registerDefaultProviders() {
        this.registerProvider('gemini', (settings) => new GeminiProvider(settings));
        this.registerProvider('openai', (settings) => new OpenAIProvider(settings, 'openai'));
        this.registerProvider('openai2', (settings) => new OpenAIProvider(settings, 'openai2'));
    }
    /**
     * プロバイダーを登録
     */
    registerProvider(name, factory) {
        this.providers.set(name, factory);
    }
    /**
     * 要約を生成する
     */
    async generateSummary(content) {
        const settings = await getSettings();
        // Casting to any to access dynamic key or assuming Settings has index signature if updated
        const providerName = settings[StorageKeys.AI_PROVIDER] || 'gemini';
        const factory = this.providers.get(providerName);
        if (!factory) {
            addLog(LogType.ERROR, `Unknown AI Provider: ${providerName}`);
            return "Error: AI provider configuration is missing. Please check your settings.";
        }
        try {
            const providerInstance = factory(settings);
            return await providerInstance.generateSummary(content);
        }
        catch (error) {
            addLog(LogType.ERROR, `Generate summary failed: ${error.message}`);
            return "Error: Failed to generate summary. Please try again.";
        }
    }
    /**
     * 接続テストを実行する
     */
    async testConnection() {
        const settings = await getSettings();
        const providerName = settings[StorageKeys.AI_PROVIDER] || 'gemini';
        const factory = this.providers.get(providerName);
        if (!factory) {
            return { success: false, message: 'AI provider configuration is missing.' };
        }
        try {
            const providerInstance = factory(settings);
            return await providerInstance.testConnection();
        }
        catch (error) {
            addLog(LogType.ERROR, `Connection test failed: ${error.message}`);
            return { success: false, message: error.message };
        }
    }
    /**
     * ローカルAIで要約を生成する
     */
    async summarizeLocally(content) {
        return this.localAiClient.summarize(content);
    }
    /**
     * ローカルAIの利用可能性を確認する
     */
    async getLocalAvailability() {
        return this.localAiClient.getAvailability();
    }
    // =====================
    // 以下は後方互換性のためのメソッド（非推奨）
    // 新しいコードではプロバイダークラスを使用してください
    // =====================
    /**
     * プロバイダーの設定を取得する
     * @deprecated プロバイダークラスを使用してください
     */
    getProviderConfig(provider, settings) {
        const s = settings;
        const configs = {
            gemini: {
                apiKey: s[StorageKeys.GEMINI_API_KEY],
                model: s[StorageKeys.GEMINI_MODEL] || 'gemini-1.5-flash'
            },
            openai: {
                baseUrl: s[StorageKeys.OPENAI_BASE_URL],
                apiKey: s[StorageKeys.OPENAI_API_KEY],
                model: s[StorageKeys.OPENAI_MODEL] || 'gpt-3.5-turbo'
            },
            openai2: {
                baseUrl: s[StorageKeys.OPENAI_2_BASE_URL],
                apiKey: s[StorageKeys.OPENAI_2_API_KEY],
                model: s[StorageKeys.OPENAI_2_MODEL] || 'llama3'
            }
        };
        return configs[provider] || null;
    }
    /**
     * Gemini APIを使用して要約を生成する
     * @deprecated GeminiProviderを使用してください
     */
    async generateGeminiSummary(content, apiKey, modelName) {
        if (!apiKey) {
            addLog(LogType.WARN, 'API Key not found');
            return "Error: API key is missing. Please check your settings.";
        }
        const cleanModelName = modelName.replace(/^models\//, '');
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${cleanModelName}:generateContent`;
        const truncatedContent = content.substring(0, 30000);
        const payload = {
            contents: [{
                    parts: [{
                            text: `以下のWebページの内容を、日本語で簡潔に要約してください。1文または2文で、重要なポイントをまとめてください。改行しないこと。\n\nContent:\n${truncatedContent}`
                        }]
                }]
        };
        try {
            const allowedUrls = await getAllowedUrls();
            const response = await fetchWithTimeout(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': apiKey
                },
                body: JSON.stringify(payload),
                allowedUrls
            }, API_TIMEOUT_MS);
            if (!response.ok) {
                const errorText = await response.text();
                if (response.status === 404) {
                    // Need to implement listGeminiModels or just error out
                    // const availableModels = await this.listGeminiModels(apiKey);
                    addLog(LogType.ERROR, `Model not found.`);
                    throw new Error("Error: Model not found. Please check your AI model settings.");
                }
                addLog(LogType.ERROR, `Gemini API Error: ${response.status} ${errorText}`);
                throw new Error("Error: Failed to generate summary. Please check your API settings.");
            }
            const data = await response.json();
            if (data.candidates && data.candidates.length > 0 && data.candidates[0].content) {
                return data.candidates[0].content.parts[0].text;
            }
            else {
                return "No summary generated.";
            }
        }
        catch (error) {
            if (error.message.includes('timed out')) {
                addLog(LogType.ERROR, 'Gemini API request timed out', { timeout: API_TIMEOUT_MS });
                return "Error: AI request timed out. Please check your connection.";
            }
            addLog(LogType.ERROR, 'Gemini Request Failed', { error: error.message });
            return "Error: Failed to generate summary. Please try again or check your settings.";
        }
    }
    /**
     * OpenAI互換APIを使用して要約を生成する
     * @deprecated OpenAIProviderを使用してください
     */
    async generateOpenAISummary(content, baseUrlRaw, apiKey, modelNameRaw) {
        const baseUrl = baseUrlRaw || 'https://api.openai.com/v1';
        const modelName = modelNameRaw || 'gpt-3.5-turbo';
        if (apiKey === undefined || apiKey === null) {
            addLog(LogType.WARN, 'OpenAI API Key is empty or missing');
        }
        const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
        const truncatedContent = content.substring(0, 30000);
        const payload = {
            model: modelName,
            messages: [
                {
                    role: "system",
                    content: "You are a helpful assistant that summarizes web pages effectively and concisely in Japanese."
                },
                {
                    role: "user",
                    content: `以下のWebページの内容を、日本語で簡潔に要約してください。1文または2文で、重要なポイントをまとめてください。改行しないこと。\n\nContent:\n${truncatedContent}`
                }
            ]
        };
        const headers = { 'Content-Type': 'application/json' };
        if (apiKey) {
            headers['Authorization'] = `Bearer ${apiKey}`;
        }
        try {
            const allowedUrls = await getAllowedUrls();
            const response = await fetchWithTimeout(url, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(payload),
                allowedUrls
            }, API_TIMEOUT_MS);
            if (!response.ok) {
                const errorText = await response.text();
                addLog(LogType.ERROR, `OpenAI API Error: ${response.status} ${errorText}`);
                throw new Error("Error: Failed to generate summary. Please check your API settings.");
            }
            const data = await response.json();
            if (data.choices && data.choices.length > 0 && data.choices[0].message) {
                return data.choices[0].message.content;
            }
            else {
                return "No summary generated.";
            }
        }
        catch (error) {
            if (error.message.includes('timed out')) {
                addLog(LogType.ERROR, 'OpenAI API request timed out', { timeout: API_TIMEOUT_MS });
                return "Error: AI request timed out. Please check your connection.";
            }
            addLog(LogType.ERROR, 'OpenAI Request Failed', { error: error.message });
            return "Error: Failed to generate summary. Please try again or check your settings.";
        }
    }
    /**
     * 利用可能なGeminiモデルの一覧を取得する
     * @deprecated GeminiProvider.testConnectionを使用してください
     */
    async listGeminiModels(apiKey) {
        try {
            const allowedUrls = await getAllowedUrls();
            const response = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models`, {
                headers: { 'x-goog-api-key': apiKey },
                allowedUrls
            }, API_TIMEOUT_MS);
            if (!response.ok)
                return "Unable to fetch models";
            const data = await response.json();
            return data.models ? data.models.map((m) => m.name).join(', ') : "No models returned";
        }
        catch (e) {
            return `List models failed: ${e.message}`;
        }
    }
}
//# sourceMappingURL=aiClient.js.map