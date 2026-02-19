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
}
//# sourceMappingURL=aiClient.d.ts.map