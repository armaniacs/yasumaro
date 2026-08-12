import { type AISummaryResult, type AiTestProgress } from './ai/AIService.js';
import { AIProviderStrategy } from './ai/providers/index.js';
import { RemoteAIService } from './ai/RemoteAIService.js';
import type { Settings } from '../utils/storage.js';
import { PROVIDER_LABELS } from '../utils/aiProviderLabels.js';

export interface ProviderTestResult {
    provider: string;
    model?: string;
    success: boolean;
    message: string;
    elapsedMs: number;
    debug?: {
        prompt?: string;
        response?: string;
        error?: string;
        hasContent?: boolean;
        statusCode?: number;
        availability?: string;
    };
}

export interface MultiProviderTestResult {
    success: boolean;
    message: string;
    providers: ProviderTestResult[];
}

/**
 * AI Client
 * Strategyパターンによるプロバイダー拡張
 *
 * ⚠️ 新規コードからの直接利用は避けること。AI要約機能へのアクセスは
 * src/background/ai/AIService.ts（AIServiceインターフェース）経由で行う。
 * AIClientはRemoteAIServiceの薄い委譲ラッパーであり、既存テストとの
 * 互換性のために維持される。詳細: dev-docs/ADR/2026-07-27-ai-client-service-unification.md
 *
 * 【拡張性】: 新しいAIプロバイダーを追加する際はRemoteAIServiceの
 * registerDefaultProviders()に追加すること。
 */
export class AIClient {
    public remoteAiService: RemoteAIService;

    constructor(remoteAiService?: RemoteAIService) {
        this.remoteAiService = remoteAiService || new RemoteAIService();
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
        return this.remoteAiService.generateSummary(content, { tagSummaryMode, url, traceId });
    }

    /**
     * 接続テストを実行する
     * 優先度リストの全プロバイダをテストし、各プロバイダの結果を返す
     */
    async testConnection(onProgress?: (progress: AiTestProgress) => void, runId?: string): Promise<MultiProviderTestResult> {
        return this.remoteAiService.testConnection(onProgress, runId);
    }

    /**
     * カスタムプロバイダーを登録する
     */
    registerProvider(name: string, factory: (settings: Settings) => AIProviderStrategy): void {
        this.remoteAiService.registerProvider(name, factory);
    }
}

export { PROVIDER_LABELS };
export type { AiTestProgress };
