import { getSettings, StorageKeys, Settings, ProviderSlot } from '../utils/storage.js';
import { LocalAIClient, LocalAIAvailability, LocalAISummaryResult } from './localAiClient.js';
import { GeminiProvider, OpenAIProvider, AIProviderStrategy, AISummaryResult } from './ai/providers/index.js';
import { addLog, LogType } from '../utils/logger.js';
import { errorMessage } from '../utils/errorUtils.js';
import { recordAuditLog } from '../utils/auditLog.js';

export interface AIProviderFactory {
    (settings: Settings): AIProviderStrategy;
}

export interface ProviderTestResult {
    provider: string;
    model?: string;
    success: boolean;
    message: string;
}

export interface MultiProviderTestResult {
    success: boolean;
    message: string;
    providers: ProviderTestResult[];
}

/** Human-readable labels for AI provider identifiers */
export const PROVIDER_LABELS: Record<string, string> = {
    gemini: 'Google Gemini',
    openai: 'OpenAI Compatible',
    openai2: 'OpenAI Compatible 2',
    'lm-studio': 'LM Studio',
    ollama: 'Ollama',
    'openai-compatible': 'OpenAI Compatible',
};

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
        this.registerProvider('lm-studio', (settings: Settings) => new OpenAIProvider(settings, 'lm-studio'));
        this.registerProvider('ollama', (settings: Settings) => new OpenAIProvider(settings, 'ollama'));
        this.registerProvider('openai-compatible', (settings: Settings) => new OpenAIProvider(settings, 'openai-compatible'));
    }

    /**
     * プロバイダーを登録
     */
    registerProvider(name: string, factory: AIProviderFactory): void {
        this.providers.set(name, factory);
    }

    /**
     * 要約を生成する
     * 優先度1〜3位のプロバイダーを順に試行し、成功かつ最小長以上の要約が得られた時点で返す。
     * @param {string} content - 要約対象のコンテンツ
     * @param {boolean} [tagSummaryMode=false] - タグ付き要約モード
     */
    async generateSummary(content: string, tagSummaryMode: boolean = false, url: string = ''): Promise<AISummaryResult> {
        const settings = await getSettings();
        const minLength = (settings[StorageKeys.SUMMARY_MIN_LENGTH] as number) || 0;
        const slots = this.resolveProviderSlots(settings);

        let lastResult: AISummaryResult = {
            success: false,
            summary: "Error: AI provider configuration is missing. Please check your settings."
        };

        for (const slot of slots) {
            const factory = this.providers.get(slot.provider);
            if (!factory) {
                addLog(LogType.ERROR, `Unknown AI Provider: ${slot.provider}`);
                continue;
            }

            const effectiveSettings = this.applySlotModel(settings, slot);

            void recordAuditLog({ provider: slot.provider, url });

            try {
                const providerInstance = factory(effectiveSettings);
                const result = await providerInstance.generateSummary(content, tagSummaryMode);
                if (result.success && result.summary.length >= minLength) {
                    return result;
                }
                lastResult = result;
            } catch (error: unknown) {
                addLog(LogType.ERROR, `Generate summary failed: ${errorMessage(error)}`);
                lastResult = { success: false, summary: "Error: Failed to generate summary. Please try again." };
            }
        }

        return lastResult;
    }

    /** Maximum number of provider slots to process in testConnection/generateSummary */
    private static readonly MAX_PROVIDERS = 10;

    /**
     * 優先度スロットリストを解決する
     * AI_PROVIDER_PRIORITY_LISTが空の場合は旧AI_PROVIDER単一設定を1位スロットとして扱う
     */
    private resolveProviderSlots(settings: Settings): ProviderSlot[] {
        const slots = settings[StorageKeys.AI_PROVIDER_PRIORITY_LIST] as ProviderSlot[] | undefined;
        const resolved = (slots && slots.length > 0)
            ? slots
            : [{ provider: (settings[StorageKeys.AI_PROVIDER] as string) || 'gemini' }];
        return resolved.slice(0, AIClient.MAX_PROVIDERS);
    }

    /**
     * スロットにmodel指定がある場合、対応するプロバイダーのモデル設定キーを上書きした設定を返す
     */
    private applySlotModel(settings: Settings, slot: ProviderSlot): Settings {
        if (!slot.model) {
            return settings;
        }
        const normalizedName = slot.provider.replace('2', '_2').replace(/-/g, '_').toLowerCase();
        const modelKey = slot.provider === 'openai-compatible'
            ? StorageKeys.PROVIDER_MODEL
            : `${normalizedName}_model`;
        return { ...settings, [modelKey]: slot.model };
    }

    /**
     * 接続テストを実行する
     * 優先度リストの全プロバイダをテストし、各プロバイダの結果を返す
     */
    async testConnection(): Promise<MultiProviderTestResult> {
        const settings = await getSettings();
        const slots = this.resolveProviderSlots(settings);

        const providerResults: ProviderTestResult[] = [];
        let anySuccess = false;

        for (const slot of slots) {
            const factory = this.providers.get(slot.provider);
            if (!factory) {
                providerResults.push({
                    provider: slot.provider,
                    model: slot.model,
                    success: false,
                    message: `Unknown provider: ${slot.provider}`,
                });
                continue;
            }

            const effectiveSettings = this.applySlotModel(settings, slot);

            try {
                const providerInstance = factory(effectiveSettings);
                const result = await providerInstance.testConnection();
                providerResults.push({
                    provider: slot.provider,
                    model: slot.model,
                    success: result.success,
                    message: result.message,
                });
                if (result.success) {
                    anySuccess = true;
                }
            } catch (error: unknown) {
                const msg = errorMessage(error);
                addLog(LogType.ERROR, `Connection test failed for ${slot.provider}: ${msg}`);
                providerResults.push({
                    provider: slot.provider,
                    model: slot.model,
                    success: false,
                    message: msg,
                });
            }
        }

        const overallMessage = anySuccess
            ? providerResults.filter(r => r.success).map(r => `${r.provider}: OK`).join(', ')
            : providerResults.map(r => `${r.provider}: ${r.message}`).join('; ');

        return {
            success: anySuccess,
            message: overallMessage,
            providers: providerResults,
        };
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