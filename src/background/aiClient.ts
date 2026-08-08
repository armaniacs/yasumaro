import { getSettings, StorageKeys, Settings, ProviderSlot } from '../utils/storage.js';
import { resolveModelKey } from '../utils/aiModelKey.js';
import { GeminiProvider, OpenAIProvider, BuiltInAiProvider, AIProviderStrategy, AISummaryResult } from './ai/providers/index.js';
import { addLog, LogType } from '../utils/logger.js';
import { errorMessage } from '../utils/errorUtils.js';
import { recordAuditLog } from '../utils/auditLog.js';

export interface AIProviderFactory {
    (settings: Settings): AIProviderStrategy;
}

interface ProviderTestResult {
    provider: string;
    model?: string;
    success: boolean;
    message: string;
    /** Wall-clock time spent testing this provider, in milliseconds. */
    elapsedMs: number;
    /** Debug information captured during the test. */
    debug?: {
        /** The prompt text sent to the provider. */
        prompt?: string;
        /** The raw response text from the provider. */
        response?: string;
        /** Error message if the test failed. */
        error?: string;
        /** Whether the response was non-empty. */
        hasContent?: boolean;
        /** HTTP status code if applicable (remote providers). */
        statusCode?: number;
        /** Availability status for Built-in AI. */
        availability?: string;
    };
}

export interface MultiProviderTestResult {
    success: boolean;
    message: string;
    providers: ProviderTestResult[];
}

/** Progress notification emitted when testConnection() starts testing one provider slot. */
export interface AiTestProgress {
    /** Correlation id so a receiver (e.g. multiple Dashboard tabs) only renders
     * progress belonging to its own test run. Omitted for single-run callers. */
    runId?: string;
    provider: string;
    model?: string;
    /** 0-based index of the slot currently being tested. */
    index: number;
    /** Total number of slots in the priority list. */
    total: number;
}

/**
 * Human-readable labels for AI provider identifiers.
 * Single source of truth is src/utils/aiProviderLabels.ts; re-exported here
 * for backward compatibility with existing importers.
 */
export { PROVIDER_LABELS } from '../utils/aiProviderLabels.js';

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

    constructor() {
        this.providers = new Map();
        this.inFlightSummaryRequests = new Map();
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
        this.registerProvider('built-in-ai', (settings: Settings) => new BuiltInAiProvider(settings));
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
        return { ...settings, [resolveModelKey(slot.provider)]: slot.model };
    }

    /**
     * 進捗表示・結果表示用に、実際に使用されるモデル名を解決する
     * スロットにmodel指定があればそれを、なければ設定済みのデフォルトモデルを返す
     * デフォルト値が空文字の場合は undefined に正規化し、呼び出し元の falsy 判定と整合させる
     */
    private resolveEffectiveModel(settings: Settings, slot: ProviderSlot): string | undefined {
        if (slot.model) {
            return slot.model;
        }
        const model = settings[resolveModelKey(slot.provider)] as string | undefined;
        return model ? model : undefined;
    }

    /**
     * スロットに対して要約を生成する共通処理
     * generateSummary と testConnection から呼び出される
     */
    private async processSummarySlot(
        slot: ProviderSlot,
        settings: Settings,
        content: string,
        tagSummaryMode: boolean,
        traceId: string,
        url: string
    ): Promise<AISummaryResult> {
        const factory = this.providers.get(slot.provider);
        if (!factory) {
            addLog(LogType.ERROR, `Unknown AI Provider: ${slot.provider}`, { traceId });
            return { success: false, summary: "Error: AI provider configuration is missing. Please check your settings." };
        }

        const effectiveSettings = this.applySlotModel(settings, slot);
        void recordAuditLog({ provider: slot.provider, url });

        try {
            const providerInstance = factory(effectiveSettings);
            const result = await providerInstance.generateSummary(content, tagSummaryMode, traceId);
            return result;
        } catch (error: unknown) {
            addLog(LogType.ERROR, `Generate summary failed: ${errorMessage(error)}`, { traceId });
            return { success: false, summary: "Error: Failed to generate summary. Please try again." };
        }
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
            const result = await this.processSummarySlot(slot, settings, content, tagSummaryMode, traceId, url);
            if (result.success && result.summary.length >= minLength) {
                return result;
            }
            lastResult = result;
        }

        return lastResult;
    }

    /**
     * 接続テストを実行する
     * 優先度リストの全プロバイダをテストし、各プロバイダの結果を返す
     * 例外の有無だけでなく、実際のレスポンス内容も検証する。
     */
    async testConnection(onProgress?: (progress: AiTestProgress) => void, runId?: string): Promise<MultiProviderTestResult> {
        const settings = await getSettings();
        const slots = this.resolveProviderSlots(settings);

        const providerResults: ProviderTestResult[] = [];
        let anySuccess = false;

        for (const [index, slot] of slots.entries()) {
            const slotStart = performance.now();
            const effectiveModel = this.resolveEffectiveModel(settings, slot);
            onProgress?.({
                provider: slot.provider,
                model: effectiveModel,
                index,
                total: slots.length,
                // Only attach runId when one was provided, so existing callers
                // that omit it keep their progress shape unchanged.
                ...(runId !== undefined ? { runId } : {}),
            });

            const factory = this.providers.get(slot.provider);
            if (!factory) {
                providerResults.push({
                    provider: slot.provider,
                    model: effectiveModel,
                    success: false,
                    message: `Unknown provider: ${slot.provider}`,
                    elapsedMs: performance.now() - slotStart,
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
                    model: effectiveModel,
                    success: result.success,
                    message: result.message,
                    elapsedMs: performance.now() - slotStart,
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
                    model: effectiveModel,
                    success: false,
                    message: msg,
                    elapsedMs: performance.now() - slotStart,
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
