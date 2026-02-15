import { Settings } from '../utils/storage.js';
import { LocalAIAvailability, LocalAISummaryResult } from './localAiClient.js';
import { AIProviderStrategy } from './ai/providers/index.js';
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
export declare class AIClient {
    private localAiClient;
    private providers;
    constructor();
    /**
     * デフォルトプロバイダーを登録
     */
    registerDefaultProviders(): void;
    /**
     * プロバイダーを登録
     */
    registerProvider(name: string, factory: AIProviderFactory): void;
    /**
     * 要約を生成する
     */
    generateSummary(content: string): Promise<string>;
    /**
     * 接続テストを実行する
     */
    testConnection(): Promise<ConnectionTestResult>;
    /**
     * ローカルAIで要約を生成する
     */
    summarizeLocally(content: string): Promise<LocalAISummaryResult>;
    /**
     * ローカルAIの利用可能性を確認する
     */
    getLocalAvailability(): Promise<LocalAIAvailability>;
    /**
     * プロバイダーの設定を取得する
     * @deprecated プロバイダークラスを使用してください
     */
    getProviderConfig(provider: string, settings: Settings): any;
    /**
     * Gemini APIを使用して要約を生成する
     * @deprecated GeminiProviderを使用してください
     */
    generateGeminiSummary(content: string, apiKey: string, modelName: string): Promise<string>;
    /**
     * OpenAI互換APIを使用して要約を生成する
     * @deprecated OpenAIProviderを使用してください
     */
    generateOpenAISummary(content: string, baseUrlRaw: string, apiKey: string, modelNameRaw: string): Promise<string>;
    /**
     * 利用可能なGeminiモデルの一覧を取得する
     * @deprecated GeminiProvider.testConnectionを使用してください
     */
    listGeminiModels(apiKey: string): Promise<string>;
}
//# sourceMappingURL=aiClient.d.ts.map