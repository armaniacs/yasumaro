import { getSettings, StorageKeys } from '../utils/storage.js';
import { LocalAIClient } from './localAiClient.js';
import { GeminiProvider, OpenAIProvider } from './ai/providers/index.js';
import { addLog, LogType } from '../utils/logger.js';
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
     * @param {string} content - 要約対象のコンテンツ
     * @param {boolean} [tagSummaryMode=false] - タグ付き要約モード
     */
    async generateSummary(content, tagSummaryMode = false) {
        const settings = await getSettings();
        // Settings型は StorageKeys でアクセス可能
        const providerName = settings[StorageKeys.AI_PROVIDER] || 'gemini';
        const factory = this.providers.get(providerName);
        if (!factory) {
            addLog(LogType.ERROR, `Unknown AI Provider: ${providerName}`);
            return "Error: AI provider configuration is missing. Please check your settings.";
        }
        try {
            const providerInstance = factory(settings);
            return await providerInstance.generateSummary(content, tagSummaryMode);
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
        // Settings型は StorageKeys でアクセス可能
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
}
//# sourceMappingURL=aiClient.js.map