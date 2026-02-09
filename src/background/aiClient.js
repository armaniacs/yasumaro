import { getSettings, StorageKeys, getAllowedUrls } from '../utils/storage.js';
import { LocalAIClient } from './localAiClient.js';
import { addLog, LogType } from '../utils/logger.js';
import { fetchWithTimeout } from '../utils/fetch.js';

// AI APIタイムアウト（30秒）
const API_TIMEOUT_MS = 30000;

/**
 * AI Client
 * 【機能概要】: 複数のAIプロバイダー（Gemini、OpenAI互換）を使用して要約を生成するクライアント
 * 【設計方針】: 各プロバイダーのAPI仕様を抽象化し、統一的なインターフェースを提供
 * 【拡張性】: 新しいAIプロバイダーを追加する際はproviderConfigsに設定を追加するのみ
 * 🟢
 */
export class AIClient {
    constructor() {
        this.localAiClient = new LocalAIClient();
    }

    /**
     * 要約を生成する
     * 【機能概要】: 設定されたAIプロバイダーを使用して、コンテンツの日本語要約を生成する
     * 【プロバイダー順位】: gemini → openai → openai2
     * 🟢
     * @param {string} content - 要約対象のコンテンツ
     * @returns {Promise<string>} - 生成された要約テキスト
     */
    async generateSummary(content) {
        const settings = await getSettings();
        const provider = settings[StorageKeys.AI_PROVIDER] || 'gemini';

        // 【プロバイダー設定マップ】: 各プロバイダーの設定キーを管理
        // 【保守性】: 新しいプロバイダーを追加する際はここに設定を追加するのみ
        const providerConfig = this.getProviderConfig(provider, settings);

        if (!providerConfig) {
            addLog(LogType.ERROR, `Unknown AI Provider: ${provider}`);
            return "Error: AI provider configuration is missing. Please check your settings.";
        }

        // 【プロバイダーごとの処理】: 設定を使用して各プロバイダーの要約メソッドを呼び出す
        if (provider === 'gemini') {
            return this.generateGeminiSummary(content, providerConfig.apiKey, providerConfig.model);
        } else {
            // OpenAI互換API（openai, openai2）は共通の処理を使用
            return this.generateOpenAISummary(
                content,
                providerConfig.baseUrl,
                providerConfig.apiKey,
                providerConfig.model
            );
        }
    }

    /**
     * プロバイダーの設定を取得する
     * 【機能概要】: 指定されたプロバイダーのAPIキー、ベースURL、モデル名を設定から取得する
     * 【単一責任】: プロバイダー設定の取得に特化
     * 🟢
     * @param {string} provider - プロバイダー名
     * @param {object} settings - 全設定オブジェクト
     * @returns {object|null} - { apiKey, baseUrl, model } または null
     */
    getProviderConfig(provider, settings) {
        const configs = {
            gemini: {
                apiKey: settings[StorageKeys.GEMINI_API_KEY],
                model: settings[StorageKeys.GEMINI_MODEL] || 'gemini-1.5-flash'
            },
            openai: {
                baseUrl: settings[StorageKeys.OPENAI_BASE_URL],
                apiKey: settings[StorageKeys.OPENAI_API_KEY],
                model: settings[StorageKeys.OPENAI_MODEL] || 'gpt-3.5-turbo'
            },
            openai2: {
                baseUrl: settings[StorageKeys.OPENAI_2_BASE_URL],
                apiKey: settings[StorageKeys.OPENAI_2_API_KEY],
                model: settings[StorageKeys.OPENAI_2_MODEL] || 'llama3'
            }
        };

        return configs[provider] || null;
    }

    /**
     * Gemini APIを使用して要約を生成する
     * 【機能概要】: Google Gemini APIを呼び出して、日本語の簡潔な要約を生成する
     * 【エラー処理】: 404エラーの場合は利用可能なモデル一覧を取得してエラーメッセージに含める
     * 🟢
     * @param {string} content - 要約対象のコンテンツ
     * @param {string} apiKey - Gemini APIキー
     * @param {string} modelName - モデル名
     * @returns {Promise<string>} - 生成された要約
     */
    async generateGeminiSummary(content, apiKey, modelName) {
        // 【設定検証】: APIキーの存在チェック
        if (!apiKey) {
            addLog(LogType.WARN, 'API Key not found');
            return "Error: API key is missing. Please check your settings.";
        }

        // 【URL構築】: モデル名をサニタイズしてAPIエンドポイントを構築
        const cleanModelName = modelName.replace(/^models\//, '');
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${cleanModelName}:generateContent`;

        // 【コンテンツ長制限】: API上限対策として30,000文字で切り詰め
        const truncatedContent = content.substring(0, 30000);

        const payload = {
            contents: [{
                parts: [{
                    text: `以下のWebページの内容を、日本語で簡潔に要約してください。1文または2文で、重要なポイントをまとめてください。改行しないこと。\n\nContent:\n${truncatedContent}`
                }]
            }]
        };

        try {
            // 許可されたURLのリストを取得
            const allowedUrls = await getAllowedUrls();

            const response = await fetchWithTimeout(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': apiKey
                },
                body: JSON.stringify(payload),
                allowedUrls // 動的URL検証用オプション
            }, API_TIMEOUT_MS);

            if (!response.ok) {
                const errorText = await response.text();
                // 【404エラー処理】: モデルが見つからない場合は利用可能なモデル一覧を取得してログに記録
                if (response.status === 404) {
                    const availableModels = await this.listGeminiModels(apiKey);
                    addLog(LogType.ERROR, `Model not found. Available models: ${availableModels}`);
                    throw new Error("Error: Model not found. Please check your AI model settings.");
                }
                addLog(LogType.ERROR, `Gemini API Error: ${response.status} ${errorText}`);
                throw new Error("Error: Failed to generate summary. Please check your API settings.");
            }

            const data = await response.json();

            if (data.candidates && data.candidates.length > 0 && data.candidates[0].content) {
                return data.candidates[0].content.parts[0].text;
            } else {
                return "No summary generated.";
            }

        } catch (error) {
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
     * 【機能概要】: OpenAI API仕様に準拠したAPIを使用して、日本語の簡潔な要約を生成する
     * 【対応API】: OpenAI、Groq、OllamaなどのOpenAI互換API
     * 【柔軟性】: APIキーが空文字の場合はローカルLLMなどを想定してリクエストを送信
     * 🟢
     * @param {string} content - 要約対象のコンテンツ
     * @param {string} baseUrlRaw - ベースURL（末尾のスラッシュは自動で削除）
     * @param {string|null|undefined} apiKey - APIキー（ローカルLLM等はnull/undefined可）
     * @param {string} modelNameRaw - モデル名
     * @returns {Promise<string>} - 生成された要約
     */
    async generateOpenAISummary(content, baseUrlRaw, apiKey, modelNameRaw) {
        // 【デフォルト値設定】: ベースURLとモデル名のデフォルト値
        const baseUrl = baseUrlRaw || 'https://api.openai.com/v1';
        const modelName = modelNameRaw || 'gpt-3.5-turbo';

        // 【APIキーチェック】: null/undefinedの場合のみ警告（空文字はローカルLLM等を想定）
        if (apiKey === undefined || apiKey === null) {
            // 【注意】: 一部のローカルLLMはAPIキーを必要としないため、空文字は許容する
            addLog(LogType.WARN, 'OpenAI API Key is empty or missing');
        }

        // 【URL構築】: ベースURLの末尾スラッシュを削除してエンドポイントを構築
        const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;

        // 【コンテンツ長制限】: API上限対策として30,000文字で切り詰め
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

        // 【ヘッダー構築】: APIキーがある場合のみAuthorizationヘッダーを追加
        const headers = { 'Content-Type': 'application/json' };
        if (apiKey) {
            headers['Authorization'] = `Bearer ${apiKey}`;
        }

        try {
            // 許可されたURLのリストを取得
            const allowedUrls = await getAllowedUrls();

            const response = await fetchWithTimeout(url, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(payload),
                allowedUrls // 動的URL検証用オプション
            }, API_TIMEOUT_MS);

            if (!response.ok) {
                const errorText = await response.text();
                addLog(LogType.ERROR, `OpenAI API Error: ${response.status} ${errorText}`);
                throw new Error("Error: Failed to generate summary. Please check your API settings.");
            }

            const data = await response.json();

            if (data.choices && data.choices.length > 0 && data.choices[0].message) {
                return data.choices[0].message.content;
            } else {
                return "No summary generated.";
            }

        } catch (error) {
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
     * 【機能概要】: APIキーに対応する利用可能なモデル名の一覧を取得する
     * 【用途】: 404エラー発生時に利用可能なモデルをユーザーに提示するため
     * 🟢
     * @param {string} apiKey - Gemini APIキー
     * @returns {Promise<string>} - モデル名をカンマ区切りで連結した文字列、またはエラーメッセージ
     */
    async listGeminiModels(apiKey) {
        try {
            // 許可されたURLのリストを取得
            const allowedUrls = await getAllowedUrls();

            const response = await fetchWithTimeout(
                `https://generativelanguage.googleapis.com/v1beta/models`,
                {
                    headers: { 'x-goog-api-key': apiKey },
                    allowedUrls // 動的URL検証用オプション
                },
                API_TIMEOUT_MS
            );
            if (!response.ok) return "Unable to fetch models";
            const data = await response.json();
            return data.models ? data.models.map(m => m.name).join(', ') : "No models returned";
        } catch (e) {
            return `List models failed: ${e.message}`;
        }
    }
    /**
     * AI接続テスト
     * 選択されたAIプロバイダーに軽量なリクエストを送って接続を確認する
     * @returns {Promise<{success: boolean, message: string}>}
     */
    async testConnection() {
        const settings = await getSettings();
        const provider = settings[StorageKeys.AI_PROVIDER] || 'gemini';
        const providerConfig = this.getProviderConfig(provider, settings);

        if (!providerConfig) {
            return { success: false, message: 'AI provider configuration is missing.' };
        }

        try {
            const allowedUrls = await getAllowedUrls();

            if (provider === 'gemini') {
                return await this._testGeminiConnection(providerConfig, allowedUrls);
            } else {
                return await this._testOpenAIConnection(providerConfig, allowedUrls);
            }
        } catch (e) {
            addLog(LogType.ERROR, `AI connection test failed: ${e.message}`);
            return { success: false, message: e.message };
        }
    }

    async _testGeminiConnection(config, allowedUrls) {
        if (!config.apiKey) {
            return { success: false, message: 'Gemini API Key is not set.' };
        }

        const url = 'https://generativelanguage.googleapis.com/v1beta/models';
        const response = await fetchWithTimeout(url, {
            method: 'GET',
            headers: { 'x-goog-api-key': config.apiKey },
            allowedUrls
        }, API_TIMEOUT_MS);

        if (response.ok) {
            return { success: true, message: 'Connected to Gemini API.' };
        }
        const errorText = await response.text();
        addLog(LogType.ERROR, `Gemini connection test failed: ${response.status} ${errorText}`);
        return { success: false, message: `Gemini API Error: ${response.status}` };
    }

    async _testOpenAIConnection(config, allowedUrls) {
        const baseUrl = (config.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
        const url = `${baseUrl}/models`;

        const headers = { 'Content-Type': 'application/json' };
        if (config.apiKey) {
            headers['Authorization'] = `Bearer ${config.apiKey}`;
        }

        const response = await fetchWithTimeout(url, {
            method: 'GET',
            headers,
            allowedUrls
        }, API_TIMEOUT_MS);

        if (response.ok) {
            return { success: true, message: 'Connected to AI API.' };
        }
        const errorText = await response.text();
        addLog(LogType.ERROR, `OpenAI connection test failed: ${response.status} ${errorText}`);
        return { success: false, message: `AI API Error: ${response.status}` };
    }

    /**
     * ローカルAIで要約を生成する
     * @param {string} content
     * @returns {Promise<{success: boolean, summary: string|null, error?: string}>}
     */
    async summarizeLocally(content) {
        return this.localAiClient.summarize(content);
    }

    /**
     * ローカルAIの利用可能性を確認する
     * @returns {Promise<string>}
     */
    async getLocalAvailability() {
        return this.localAiClient.getAvailability();
    }
}