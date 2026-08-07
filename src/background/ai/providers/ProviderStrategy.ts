/**
 * AIプロバイダーのベースクラス
 * 新しいAIプロバイダーを追加する際はこのクラスを継承する
 */

import { Settings, StorageKeys } from '../../../utils/storage.js';
import { validateMaxTokens } from '../../../utils/aiLimits.js';
import { checkHardLimit, checkRateLimit, checkUsageWarning, getRateLimitMessage } from '../../../utils/aiUsageTracker.js';

export interface AIProviderConnectionResult {
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
        /** HTTP status code if applicable. */
        statusCode?: number;
        /** Whether the response was non-empty. */
        hasContent?: boolean;
    };
}

export interface AISummaryResult {
    success: boolean;
    summary: string;
    sentTokens?: number;
    receivedTokens?: number;
    providerName?: string;  // 使用したAIプロバイダー名
    model?: string;         // 使用したAIモデル名
    error?: string;         // スキーマ不整合等の詳細エラー（ユーザー向け summary とは別）
}

/**
 * プロバイダー別の設定構造
 */
interface ProviderSpecificSettings {
    maxTokens?: number;
}

export abstract class AIProviderStrategy {
    protected settings: Settings;

    constructor(settings: Settings) {
        this.settings = settings;
    }

    /**
     * プリフライトガード: 月次リミット、使用量警告、レート制限を順にチェック
     * @returns blocked=true の場合は caller は早期リターンすべき
     */
    protected async checkPreFlight(): Promise<{ blocked: boolean; message?: string }> {
        const hardLimit = await checkHardLimit();
        if (hardLimit.blocked) {
            return { blocked: true, message: `Error: ${hardLimit.message}` };
        }

        const usageWarning = await checkUsageWarning();
        if (usageWarning.warning) {
            return { blocked: true, message: `Error: ${usageWarning.message}` };
        }

        const rateLimit = await checkRateLimit();
        if (!rateLimit.allowed) {
            return { blocked: true, message: `Error: ${getRateLimitMessage(rateLimit.resetTime)}` };
        }

        return { blocked: false };
    }

    /**
     * 要約を生成する
     * @param {string} content - 要約対象のコンテンツ
     * @param {boolean} [tagSummaryMode=false] - タグ付き要約モード
     * @param {string} [traceId] - 記録パイプラインのトレースID
     */
    abstract generateSummary(content: string, tagSummaryMode?: boolean, traceId?: string): Promise<AISummaryResult>;

    /**
     * 接続テストを実行する
     */
    abstract testConnection(): Promise<AIProviderConnectionResult>;

    /**
     * プロバイダー名を取得
     */
    abstract getName(): string;

    /**
     * プロバイダーIDを取得（トークン検証用）
     * デフォルトはgetName()と同じ、必要に応じてオーバーライド
     */
    getProviderId(): string {
        return this.getName();
    }

    /**
     * プロバイダー別の送信コンテンツ最大文字数を取得
     * 優先順位:
     * 1. プロバイダー別設定 (providers.<providerId>.maxContentChars)
     * 2. ストレージキーに保存されたグローバル設定
     * 3. デフォルト値
     */
    protected getMaxContentChars(defaultValue: number, storageKey?: string): number {
        const providerId = this.getProviderId();

        // 1. プロバイダー別設定を確認
        const providerSettings = this.settings[`providers`] as Record<string, { maxContentChars?: number }> | undefined;
        const providerConfig = providerSettings?.[providerId];
        if (typeof providerConfig?.maxContentChars === 'number' && providerConfig.maxContentChars > 0) {
            return providerConfig.maxContentChars;
        }

        // 2. グローバル設定を確認
        if (storageKey) {
            const globalValue = this.settings[storageKey] as number | undefined;
            if (typeof globalValue === 'number' && globalValue > 0) {
                return globalValue;
            }
        }

        // 3. デフォルト値
        return defaultValue;
    }

    /**
     * 最大トークン数を取得
     * 優先順位:
     * 1. プロバイダー別設定
     * 2. グローバル設定
     * 3. デフォルト値 (1000)
     */
    protected getMaxTokens(): number {
        const providerId = this.getProviderId();

        // 1. プロバイダー別設定を確認
        const providerSettings = this.settings[`providers`] as Record<string, ProviderSpecificSettings> | undefined;
        const providerConfig = providerSettings?.[providerId];
        if (providerConfig?.maxTokens) {
            return validateMaxTokens(providerConfig.maxTokens, providerId);
        }

        // 2. グローバル設定を確認
        const globalMax = this.settings[StorageKeys.MAX_TOKENS_PER_PROMPT] as number;
        if (globalMax && !isNaN(globalMax)) {
            return validateMaxTokens(globalMax, providerId);
        }

        // 3. デフォルト値
        return validateMaxTokens(1000, providerId);
    }
}