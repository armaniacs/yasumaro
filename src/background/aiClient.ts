import { getSettings, StorageKeys, Settings, ProviderSlot } from '../utils/storage.js';
import { GeminiProvider, OpenAIProvider, AIProviderStrategy, AISummaryResult } from './ai/providers/index.js';
import { addLog, LogType } from '../utils/logger.js';
import { errorMessage } from '../utils/errorUtils.js';
import { recordAuditLog } from '../utils/auditLog.js';
import type { AIService } from './ai/AIService.js';

/** Provider identifier reserved for Chrome Built-in AI, dispatched to an injected AIService. */
const BUILT_IN_AI_PROVIDER_ID = 'built-in-ai';

export interface AIProviderFactory {
    (settings: Settings): AIProviderStrategy;
}

interface ProviderTestResult {
    provider: string;
    model?: string;
    success: boolean;
    message: string;
    /** Debug information captured during the test. */
    debug?: {
        /** The prompt text sent to the provider. */
        prompt?: string;
        /** The raw response text from the provider. */
        response?: string;
        /** Error message if the test failed. */
        error?: string;
        /** Availability status for Built-in AI. */
        availability?: string;
        /** Whether the summary was non-empty (actual content check). */
        hasContent?: boolean;
        /** HTTP status code if applicable (remote providers). */
        statusCode?: number;
    };
}

export interface MultiProviderTestResult {
    success: boolean;
    message: string;
    providers: ProviderTestResult[];
}

/**
 * Human-readable labels for AI provider identifiers.
 * Note: 'built-in-ai' is display-only here — it is not registered in
 * AIClient.providers (Strategy pattern). Built-in AI is dispatched to
 * LocalAIService via FallbackAIService, not through AIClient. See
 * dev-docs/2026-07-28-built-in-ai-provider-integration-design.md.
 */
export const PROVIDER_LABELS: Record<string, string> = {
    gemini: 'Google Gemini',
    openai: 'OpenAI Compatible',
    openai2: 'OpenAI Compatible 2',
    'lm-studio': 'LM Studio',
    ollama: 'Ollama',
    'openai-compatible': 'OpenAI Compatible',
    'built-in-ai': 'Built-in AI',
};

/**
 * AI Client
 * Strategyパターンによるプロバイダー拡張
 *
 * ⚠️ 新規コードからの直接利用は避けること。AI要約機能へのアクセスは
 * src/background/ai/AIService.ts（AIServiceインターフェース）経由で行う。
 * AIClientはRemoteAIService内部でProviderロジックの実装として使われる。
 * 詳細: dev-docs/ADR/2026-07-27-ai-client-service-unification.md
 *
 * 【拡張性】: 新しいAIプロバイダーを追加する際はproviderConfigsに設定を追加するのみ
 * 【OCP Compliance】: 既存コードを修正せずに新しいプロバイダーを追加可能
 */
export class AIClient {
    private providers: Map<string, AIProviderFactory>;
    /**
     * In-flight generateSummary() リクエストを追跡するマップ。
     * 同一URLへの並行呼び出しが実際のAI API呼び出しを重複させないよう、
     * 進行中のPromiseを再利用する（FinOptimization: 不要なAPIコスト防止）。
     */
    private inFlightSummaryRequests: Map<string, Promise<AISummaryResult>>;
    /**
     * built-in-ai スロット用に登録された AIService（未登録の場合は null）。
     * Strategy パターン（AIProviderStrategy）とは別経路で、優先度リストの
     * built-in-ai スロットを検出した際にここへ委譲する。
     * 詳細: dev-docs/2026-07-28-built-in-ai-provider-integration-design.md
     */
    private builtInAiService: AIService | null;

    constructor() {
        this.providers = new Map();
        this.inFlightSummaryRequests = new Map();
        this.builtInAiService = null;
        this.registerDefaultProviders();
    }

    /**
     * built-in-ai スロット用の AIService を登録する。
     * FallbackAIService/AIClient のいずれからも独立した委譲経路であり、
     * providers Map（Strategy登録）には加えない。
     */
    registerBuiltInAiService(service: AIService): void {
        this.builtInAiService = service;
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
    async generateSummary(
        content: string,
        tagSummaryMode: boolean = false,
        url: string = '',
        traceId: string = ''
    ): Promise<AISummaryResult> {
        // in-flightキーはURLとtagSummaryModeの組み合わせ（同一URLでもモードが異なれば別リクエストとして扱う）。
        // urlが空文字列の場合は重複排除の対象外とする（キーの衝突リスクを避けるため）。
        const dedupeKey = url ? `${url}::${tagSummaryMode}` : null;

        if (dedupeKey) {
            const existing = this.inFlightSummaryRequests.get(dedupeKey);
            if (existing) {
                return existing;
            }
        }

        const requestPromise = this.generateSummaryInternal(content, tagSummaryMode, url, traceId);

        if (dedupeKey) {
            this.inFlightSummaryRequests.set(dedupeKey, requestPromise);
            requestPromise.finally(() => {
                this.inFlightSummaryRequests.delete(dedupeKey);
            });
        }

        return requestPromise;
    }

    private async generateSummaryInternal(
        content: string,
        tagSummaryMode: boolean,
        url: string,
        traceId: string = ''
    ): Promise<AISummaryResult> {
        const settings = await getSettings();
        const minLength = (settings[StorageKeys.SUMMARY_MIN_LENGTH] as number) || 0;
        const slots = this.resolveProviderSlots(settings);

        let lastResult: AISummaryResult = {
            success: false,
            summary: "Error: AI provider configuration is missing. Please check your settings."
        };

        for (const slot of slots) {
            if (slot.provider === BUILT_IN_AI_PROVIDER_ID) {
                if (!this.builtInAiService) {
                    addLog(LogType.ERROR, `Unknown AI Provider: ${slot.provider}`, { traceId });
                    continue;
                }

                void recordAuditLog({ provider: slot.provider, url });

                try {
                    const result = await this.builtInAiService.generateSummary(content, { traceId });
                    // Check both the success flag (from LocalAIService/BuiltInAIClient) and content length.
                    // BuiltInAIClient returns success:false without throwing when the model is
                    // 'downloadable' — we must not treat that as a valid summary.
                    if (result.success !== false && result.summary.length >= minLength) {
                        return { success: true, summary: result.summary, sentTokens: result.sentTokens, receivedTokens: result.receivedTokens, providerName: result.providerName, model: result.modelName };
                    }
                    lastResult = { success: false, summary: result.summary || result.error || 'Built-in AI returned no content' };
                } catch (error: unknown) {
                    addLog(LogType.ERROR, `Generate summary failed: ${errorMessage(error)}`, { traceId });
                    lastResult = { success: false, summary: "Error: Failed to generate summary. Please try again." };
                }
                continue;
            }

            const factory = this.providers.get(slot.provider);
            if (!factory) {
                addLog(LogType.ERROR, `Unknown AI Provider: ${slot.provider}`, { traceId });
                continue;
            }

            const effectiveSettings = this.applySlotModel(settings, slot);

            void recordAuditLog({ provider: slot.provider, url });

            try {
                const providerInstance = factory(effectiveSettings);
                const result = await providerInstance.generateSummary(content, tagSummaryMode, traceId);
                if (result.success && result.summary.length >= minLength) {
                    return result;
                }
                lastResult = result;
            } catch (error: unknown) {
                addLog(LogType.ERROR, `Generate summary failed: ${errorMessage(error)}`, { traceId });
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
     * 例外の有無だけでなく、実際のレスポンス内容も検証する。
     */
    async testConnection(): Promise<MultiProviderTestResult> {
        const settings = await getSettings();
        const slots = this.resolveProviderSlots(settings);

        const providerResults: ProviderTestResult[] = [];
        let anySuccess = false;

        for (const slot of slots) {
            if (slot.provider === BUILT_IN_AI_PROVIDER_ID) {
                if (!this.builtInAiService) {
                    providerResults.push({
                        provider: slot.provider,
                        model: slot.model,
                        success: false,
                        message: `Unknown provider: ${slot.provider}`,
                        debug: { error: 'Built-in AI service is not registered' },
                    });
                    continue;
                }

                const testPrompt = 'Connection test.';
                try {
                    const result = await this.builtInAiService.generateSummary(testPrompt);
                    const hasContent = result.summary.length > 0;
                    const isSuccess = result.success !== false && hasContent;

                    if (isSuccess) {
                        providerResults.push({
                            provider: slot.provider,
                            model: slot.model,
                            success: true,
                            message: 'ok',
                            debug: {
                                prompt: testPrompt,
                                response: result.summary,
                                hasContent: true,
                            },
                        });
                        anySuccess = true;
                    } else {
                        const errorMsg = result.error || (hasContent ? 'Summary was empty' : 'Provider reported failure');
                        providerResults.push({
                            provider: slot.provider,
                            model: slot.model,
                            success: false,
                            message: errorMsg,
                            debug: {
                                prompt: testPrompt,
                                response: result.summary || undefined,
                                error: result.error,
                                hasContent: false,
                            },
                        });
                        addLog(LogType.WARN, `Connection test for ${slot.provider} succeeded without exception but returned no content: ${errorMsg}`);
                    }
                } catch (error: unknown) {
                    const msg = errorMessage(error);
                    addLog(LogType.ERROR, `Connection test failed for ${slot.provider}: ${msg}`);
                    providerResults.push({
                        provider: slot.provider,
                        model: slot.model,
                        success: false,
                        message: msg,
                        debug: {
                            prompt: testPrompt,
                            error: msg,
                            hasContent: false,
                        },
                    });
                }
                continue;
            }

            const factory = this.providers.get(slot.provider);
            if (!factory) {
                providerResults.push({
                    provider: slot.provider,
                    model: slot.model,
                    success: false,
                    message: `Unknown provider: ${slot.provider}`,
                    debug: { error: `Provider "${slot.provider}" is not registered` },
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
                    debug: result.debug,
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
                    debug: { error: msg },
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

}