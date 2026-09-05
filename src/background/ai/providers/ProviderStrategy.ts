/**
 * AIプロバイダーのベースクラス
 * 新しいAIプロバイダーを追加する際はこのクラスを継承する
 */

import { Settings, StorageKeys, type StorageKey } from '../../../utils/storage/types.js';
import { validateMaxTokens } from '../../../utils/aiLimits.js';
import { checkHardLimit, checkRateLimit, checkUsageWarning, getRateLimitMessage, recordUsage } from '../../../utils/aiUsageTracker.js';
import { pickDefined } from '../../../utils/objectUtils.js';
import { applyCustomPrompt } from '../../../utils/customPromptUtils.js';
import { errorMessage } from '../../../utils/errorUtils.js';
import { readJsonCapped } from '../../../utils/readBodyCapped.js';
import { fetchWithRetry } from '../../../utils/fetch.js';
import { getAllowedUrls } from '../../../utils/storage/urlWhitelist.js';
import { checkPromptSafety } from '../../../utils/promptSafety.js';

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
        /** 実際にリクエストを送った先のエンドポイント。 */
        endpoint?: string;
        /** 応答したモデル名（プロバイダが返した実際の値）。 */
        modelName?: string;
        /** 送信トークン数（プロバイダが返した場合）。 */
        sentTokens?: number;
        /** 受信トークン数（プロバイダが返した場合）。 */
        receivedTokens?: number;
    };
}

/**
 * 接続テストで送る短いプロンプト。
 *
 * 疎通確認が目的なので、モデルに負荷をかけず応答が一意に近い形になるものを使う。
 * GET /models のようなメタデータ取得ではなく実際に推論を走らせることで、
 * APIキーの有効性・モデル名の妥当性・実際の応答内容まで一度に検証できる。
 */
export const CONNECTION_TEST_PROMPT = 'Reply with the single word: OK';

export interface AISummaryResult {
    success: boolean;
    summary: string;
    tags?: string[];
    usedLocal?: boolean;
    sentTokens?: number;
    receivedTokens?: number;
    providerName?: string;  // 使用したAIプロバイダー名
    modelName?: string;     // 使用したAIモデル名
    error?: string;         // スキーマ不整合等の詳細エラー（ユーザー向け summary とは別）
}

/** HTTP要約リクエスト（hooks.prepareRequest の成功形） */
export interface HttpSummaryRequest {
    url: string;
    headers: Record<string, string>;
    body: string;
}

/**
 * HTTP要約フローのプロバイダー固有フック。順序・pre-flight・サニタイズ・
 * プロンプト・fetch・リトライ・timeout変換はテンプレートが所有し、ここには
 * 限度・資格文面・リクエスト構築・誤差応答・parse の癖だけを置く。
 */
export interface HttpSummaryHooks {
    providerName: string;
    timeoutMs: number;
    /** 資格不備があればそのエラー文面、なければ null */
    checkCredentials(): string | null;
    /** 送信コンテンツの最大文字数 */
    contentLimit(): number;
    /** リクエスト構築。構築に失敗したら { failure } を返す */
    prepareRequest(userPrompt: string, systemPrompt: string | undefined): Promise<HttpSummaryRequest | { failure: AISummaryResult }>;
    /** !response.ok のプロバイダー固有変換 */
    handleErrorResponse(response: Response): Promise<AISummaryResult>;
    /** 応答 JSON のプロバイダー固有 parse */
    extractSummary(data: unknown, traceId: string): Promise<AISummaryResult>;
}

/**
 * Byte cap for AI provider HTTP JSON responses (summary + testConnection).
 * Single source of truth — both flows read via readJsonCapped with this value.
 */
export const MAX_AI_HTTP_RESPONSE_BYTES = 10 * 1024 * 1024; // 10MB

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
     * コンテンツのサニタイズとプロンプトインジェクション検出
     * @returns blocked=true の場合は caller は早期リターンすべき
     */
    protected sanitizeContent(
        content: string,
        providerName: string,
        traceId: string
    ): { blocked: boolean; sanitized: string; warnings: string[] } {
        // Policy lives in the shared seam (PBI 2026-09-05-05); this helper
        // keeps its shape for the template + BuiltIn callers.
        const verdict = checkPromptSafety(content, 'provider-input', { providerName, traceId });
        return { blocked: verdict.blocked, sanitized: verdict.sanitized, warnings: verdict.warnings };
    }

    /**
     * HTTPステータスコードをユーザー向け接続エラーメッセージに変換
     */
    protected mapConnectionError(
        statusCode: number,
        providerLabel: string
    ): AIProviderConnectionResult {
        if (statusCode === 401 || statusCode === 403) {
            return {
                success: false,
                message: `Authentication failed (${statusCode}). Check your ${providerLabel} API key.`,
                debug: { statusCode },
            };
        } else if (statusCode === 404) {
            return {
                success: false,
                message: `Endpoint not found (404). Check your Base URL.`,
                debug: { statusCode },
            };
        } else if (statusCode === 429) {
            return {
                success: false,
                message: `Rate limit exceeded (429). Please try again later.`,
                debug: { statusCode },
            };
        } else {
            return {
                success: false,
                message: `${providerLabel} API Error: ${statusCode}`,
                debug: { statusCode },
            };
        }
    }

    /**
     * fetchWithRetry がスローするエラーメッセージをパースし、ユーザー向け接続エラーメッセージに変換
     */
    protected parseAndMapFetchError(
        msg: string,
        providerLabel: string,
        errorName?: string
    ): AIProviderConnectionResult {
        // タイムアウト判定（AbortErrorはメッセージが環境依存のため name でも判定）
        if (errorName === 'AbortError' || msg.includes('timed out') || msg.includes('timeout')) {
            return {
                success: false,
                message: 'Connection timed out. Check your network or increase timeout.',
                debug: { error: msg },
            };
        }

        // HTTPステータスコードをパース
        const httpMatch = msg.match(/HTTP\s+(\d+):/);
        const statusCode = httpMatch?.[1] ? parseInt(httpMatch[1], 10) : 0;

        if (statusCode === 401 || statusCode === 403) {
            return {
                success: false,
                message: `Invalid API key (${statusCode}). Check your ${providerLabel} API key settings.`,
                debug: { error: msg, statusCode },
            };
        } else if (statusCode === 404) {
            return {
                success: false,
                message: `Model or endpoint not found (404). Check your Base URL.`,
                debug: { error: msg, statusCode },
            };
        } else if (statusCode === 429) {
            return {
                success: false,
                message: `Rate limit exceeded (429). Please try again later.`,
                debug: { error: msg, statusCode },
            };
        } else if (statusCode >= 500) {
            return {
                success: false,
                message: `${providerLabel} API server error (${statusCode}). Please try again later.`,
                debug: { error: msg, statusCode },
            };
        } else if (msg.includes('Failed to fetch')) {
            return {
                success: false,
                message: 'Cannot connect. Check your Base URL and network.',
                debug: { error: msg },
            };
        } else {
            return {
                success: false,
                message: `Connection error: ${msg}`,
                debug: { error: msg, ...pickDefined({ statusCode: statusCode || undefined }) },
            };
        }
    }

    /**
     * 要約を生成する
     * @param {string} content - 要約対象のコンテンツ
     * @param {boolean} [tagSummaryMode=false] - タグ付き要約モード
     * @param {string} [traceId] - 記録パイプラインのトレースID
     */
    abstract generateSummary(content: string, tagSummaryMode?: boolean, traceId?: string): Promise<AISummaryResult>;

    /**
     * HTTP要約フローのテンプレートメソッド。資格確認→pre-flight→切り詰め→
     * サニタイズ→プロンプト→fetch（共通リトライ方針）→timeout変換の順序を
     * 所有し、プロバイダー固有の癖だけを hooks に委譲する。
     *
     * Gemini / OpenAI の2 adapter が使う real seam。BuiltIn（on-device、
     * pre-flight 不要）は対象外であり、従来どおり独自実装のまま。
     */
    protected async executeHttpSummaryFlow(
        content: string,
        tagSummaryMode: boolean,
        traceId: string,
        hooks: HttpSummaryHooks,
    ): Promise<AISummaryResult> {
        const credentialError = hooks.checkCredentials();
        if (credentialError) {
            return { success: false, summary: credentialError };
        }

        const preFlight = await this.checkPreFlight();
        if (preFlight.blocked) {
            return { success: false, summary: preFlight.message! };
        }

        const truncatedContent = content.substring(0, hooks.contentLimit());
        const sanitizeResult = this.sanitizeContent(truncatedContent, hooks.providerName, traceId);
        if (sanitizeResult.blocked) {
            return { success: false, summary: `Error: Content blocked due to potential security risk. (原因: ${sanitizeResult.warnings.join('; ')})` };
        }

        const { userPrompt, systemPrompt } = applyCustomPrompt(this.settings, hooks.providerName, sanitizeResult.sanitized, tagSummaryMode);
        const prepared = await hooks.prepareRequest(userPrompt, systemPrompt);
        if ('failure' in prepared) {
            return prepared.failure;
        }

        try {
            // Static transport imports again: the utils -> background back-edge
            // is gone (PBI 2026-09-05-01 moved the allowlist table + predicate
            // to the low tier), so no cycle remains to dodge.
            const allowedUrls = await getAllowedUrls();

            const response = await fetchWithRetry(prepared.url, {
                method: 'POST',
                headers: prepared.headers,
                body: prepared.body,
                allowedUrls,
                timeoutMs: hooks.timeoutMs,
            }, {
                maxRetryCount: 3,
                initialDelayMs: 1000,
                backoffMultiplier: 2,
                maxDelayMs: 60000,
                shouldRetry: (error, attempt, response, method) =>
                    this.shouldRetrySummaryRequest(error, attempt, response, method),
            });

            if (!response.ok) {
                return hooks.handleErrorResponse(response);
            }

            const data = await readJsonCapped(response, MAX_AI_HTTP_RESPONSE_BYTES);
            return hooks.extractSummary(data, traceId);
        } catch (error: unknown) {
            const msg = errorMessage(error);
            const isTimeout = error instanceof Error && error.name === 'AbortError';
            if (isTimeout || msg.includes('timed out')) {
                return { success: false, summary: 'Error: AI request timed out. Please check your connection.' };
            }
            return { success: false, summary: 'Error: Failed to generate summary. Please try again or check your settings.' };
        }
    }

    /**
     * 接続テスト用の許可 URL 取得。testConnection 経路の共有断片。
     * urlWhitelist の getAllowedUrls への薄い委譲であり、provider 側にあった
     * 同名 private ラッパーの逐語同一 2 コピー（旧 PBI 2026-08-07-01 指摘）を
     * 解消するために base へ引き上げた。summary flow 側の providerAllowlist
     * 中立テーブルとは別仕組みのため混同しないこと。
     */
    protected async getAllowedUrlsForRequests(): Promise<Set<string>> {
        return getAllowedUrls();
    }

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
    protected getMaxContentChars(defaultValue: number, storageKey?: StorageKey): number {
        const providerId = this.getProviderId();

        // 1. プロバイダー別設定を確認（typed providers bag）
        const providerConfig = this.settings.providers?.[providerId];
        if (typeof providerConfig?.maxContentChars === 'number' && providerConfig.maxContentChars > 0) {
            return providerConfig.maxContentChars;
        }

        // 2. グローバル設定を確認（typed StorageKey access — no Record cast）
        if (storageKey) {
            const globalValue = this.settings[storageKey] as unknown as number | undefined;
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

        // 1. プロバイダー別設定を確認（typed providers bag）
        const providerConfig = this.settings.providers?.[providerId];
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

    /**
     * 要約リクエストの共通リトライ方針。
     *
     * 全プロバイダーで同じ挙動にするために基底クラスへ寄せた。
     * 以前は OpenAIProvider だけがこの述語を渡し、GeminiProvider は
     * デフォルトを継承していたため、同じ「AI要約」でありながら
     * Gemini だけが 429（レート制限）でもリトライしていた。
     *
     * - 429: リトライしない（制限を悪化させるだけ）
     * - 非冪等メソッドの 5xx: リトライしない（二重送信のリスク）
     * - タイムアウト: 1回だけリトライ
     * - ネットワークエラー: リトライする
     */
    protected shouldRetrySummaryRequest(
        error: Error,
        attempt: number,
        response: Response | null,
        method?: string,
    ): boolean {
        if (response?.status === 429) return false;
        if (response && response.status >= 500) {
            return !['POST', 'PUT', 'PATCH'].includes(method?.toUpperCase() ?? 'POST');
        }
        if (error.name === 'AbortError' || error.message.includes('timed out')) {
            return attempt <= 1;
        }
        if (error.name === 'NetworkError' || error.message.includes('NetworkError') || error.message.includes('fetch failed')) {
            return true;
        }
        return false;
    }

    /**
     * トークン使用量の記録。
     *
     * プロバイダーが使用量を返さなかった場合は「記録しない」。
     * 以前 GeminiProvider は `|| 0` で 0 に丸めて必ず記録していたため、
     * 「0トークン使った」という誤った事実が統計に混入していた。
     * トークン数不明は 0 ではないので、OpenAI 側の挙動を正とする。
     */
    protected async recordUsageIfPresent(sentTokens?: number, receivedTokens?: number): Promise<void> {
        if (sentTokens === undefined && receivedTokens === undefined) return;
        await recordUsage(sentTokens ?? 0, receivedTokens ?? 0);
    }
}

/**
 * @deprecated Use AIProviderStrategy — kept for backward compatibility (PBI 02).
 * Old custom providers importing `ProviderStrategy` continue to type-check
 * for one major version. Will be removed in next major. See CHANGELOG.
 */
export type ProviderStrategy = AIProviderStrategy;