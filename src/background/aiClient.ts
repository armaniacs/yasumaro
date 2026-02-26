import { getSettings, StorageKeys, Settings } from '../utils/storage.js';
import { LocalAIClient, LocalAIAvailability, LocalAISummaryResult } from './localAiClient.js';
import { GeminiProvider, OpenAIProvider, AIProviderStrategy } from './ai/providers/index.js';
import { addLog, LogType } from '../utils/logger.js';

export interface AIProviderFactory {
    (settings: Settings): AIProviderStrategy;
}

export interface ConnectionTestResult {
    success: boolean;
    message: string;
}

/**
 * AI Client
 * Strategyパターンによるプロバイダー拡張
 *
 * 【拡張性】: 新しいAIプロバイダーを追加する際はproviderConfigsに設定を追加するのみ
 * 【OCP Compliance】: 既存コードを修正せずに新しいプロバイダーを追加可能
 */
export class AIClient {
    private localAiClient: LocalAIClient;
    private providers: Map<string, AIProviderFactory>;

    constructor() {
        this.localAiClient = new LocalAIClient();
        this.providers = new Map();
        this.registerDefaultProviders();
    }

    /**
     * デフォルトプロバイダーを登録
     */
    registerDefaultProviders(): void {
        this.registerProvider('gemini', (settings: Settings) => new GeminiProvider(settings));
        this.registerProvider('openai', (settings: Settings) => new OpenAIProvider(settings, 'openai'));
        this.registerProvider('openai2', (settings: Settings) => new OpenAIProvider(settings, 'openai2'));
    }

    /**
     * プロバイダーを登録
     */
    registerProvider(name: string, factory: AIProviderFactory): void {
        this.providers.set(name, factory);
    }

    /**
     * 要約を生成する
     * @param {string} content - 要約対象のコンテンツ
     * @param {boolean} [tagSummaryMode=false] - タグ付き要約モード
     */
    async generateSummary(content: string, tagSummaryMode: boolean = false): Promise<string> {
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
        } catch (error: any) {
            addLog(LogType.ERROR, `Generate summary failed: ${error.message}`);
            return "Error: Failed to generate summary. Please try again.";
        }
    }

    /**
     * 接続テストを実行する
     */
    async testConnection(): Promise<ConnectionTestResult> {
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
        } catch (error: any) {
            addLog(LogType.ERROR, `Connection test failed: ${error.message}`);
            return { success: false, message: error.message };
        }
    }

    /**
     * ローカルAIで要約を生成する
     */
    async summarizeLocally(content: string): Promise<LocalAISummaryResult> {
        return this.localAiClient.summarize(content);
    }

    /**
     * ローカルAIの利用可能性を確認する
     */
    async getLocalAvailability(): Promise<LocalAIAvailability> {
        return this.localAiClient.getAvailability();
    }
}