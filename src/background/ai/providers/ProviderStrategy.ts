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
import { buildAllowedUrls } from '../../../utils/storage/urlWhitelist.js';
import { checkPromptSafety } from '../../../utils/promptSafety.js';
import { describeHttpFailure } from '../../../utils/httpFailureMessages.js';
import { addLog } from '../../../utils/logger/core.js';
import { logDebug } from '../../../utils/logger/api.js';
import { LogType } from '../../../utils/logger/types.js';
import { MAX_AI_HTTP_RESPONSE_BYTES } from '../../../messaging/limits.js';

export { MAX_AI_HTTP_RESPONSE_BYTES };

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

/** One failed provider slot's diagnostic detail (PBI 2026-09-22-04 follow-up). */
export interface AISlotFailure {
    provider: string;
    model?: string;
    /** Bare diagnostics only (e.g. "HTTP 401" / "Prompt failed: ...") — never raw response bodies. */
    error: string;
}

export interface AISummaryResult {
    success: boolean;
    summary: string;
    tags?: string[];
    usedLocal?: boolean;
    sentTokens?: number;
    receivedTokens?: number;
    providerName?: string;  // 使用したAIプロバイダー名
    modelName?: string;     // 使用したAIモデル名
    /** Tried provider ids in attempt order, present only on total failure (PBI 2026-09-22-04 follow-up). */
    attemptedProviders?: string[];
    /** Per-slot failure details — captured even when a later slot succeeds. */
    slotFailures?: AISlotFailure[];
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

/** HTTP接続テストリクエスト（hooks.buildRequest の成功形） */
export interface HttpTestRequest {
    url: string;
    headers: Record<string, string>;
    body: string;
    /** debug.modelName に記録するモデル名（Gemini は models/ 接頭辞除去後） */
    modelName?: string | undefined;
}

/** extractResponse に渡すテンプレート確定済みの診断情報 */
export interface HttpTestContext {
    /** `POST ${url}` 形式の診断用エンドポイント表記 */
    endpoint: string;
    statusCode: number;
    modelName?: string | undefined;
}

/**
 * HTTP接続テストフローのプロバイダー固有フック。順序・fetch・リトライ・
 * HTTPエラー変換・上限付き読み取り・例外変換・debug 組み立てはテンプレートが
 * 所有し、ここには資格文面・リクエスト構築・parse の癖だけを置く。
 */
export interface HttpTestHooks {
    /** Display label passed to both mapConnectionError and parseAndMapFetchError */
    providerLabel: string;
    timeoutMs: number;
    /** 資格不備があればその失敗結果、なければ null */
    checkCredentials(): AIProviderConnectionResult | null;
    /** リクエスト構築。構築に失敗したら { failure } を返す */
    buildRequest(): Promise<HttpTestRequest | { failure: AIProviderConnectionResult }>;
    /** 応答 JSON のプロバイダー固有 parse */
    extractResponse(data: unknown, ctx: HttpTestContext): Promise<AIProviderConnectionResult> | AIProviderConnectionResult;
}

/**
 * Byte cap for AI provider HTTP JSON responses (summary + testConnection).
 * Single source of truth — both flows read via readJsonCapped with this value.
 * (Re-exported from messaging/limits.js; import + re-export live at the top.)
 */

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
        return {
            success: false,
            message: describeHttpFailure(statusCode, providerLabel),
            debug: { statusCode },
        };
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

        // Status wording lives in describeHttpFailure's parse preset (SSOT);
        // the branch set below mirrors the pre-migration table exactly so the
        // migration stays byte-identical. Unifying with the connection preset
        // wording is a separate product decision.
        if (statusCode === 401 || statusCode === 403 || statusCode === 404 || statusCode === 429 || statusCode >= 500) {
            return {
                success: false,
                message: describeHttpFailure(statusCode, providerLabel, 'parse'),
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
            const allowedUrls = buildAllowedUrls(this.settings);

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
            // fetchWithRetry THROWS on non-ok after retries ("HTTP 404: ..."),
            // so this catch — not handleErrorResponse — is where production
            // HTTP failures actually land. Keep the user-facing summary
            // generic (security pins) but carry the detail in `error`, the
            // per-slot diagnostic channel the regenerate trail renders.
            const detail = msg.substring(0, 300);
            if (isTimeout || msg.includes('timed out')) {
                return { success: false, summary: 'Error: AI request timed out. Please check your connection.', error: detail };
            }
            return { success: false, summary: 'Error: Failed to generate summary. Please try again or check your settings.', error: detail };
        }
    }

    /**
     * HTTP接続テストフローのテンプレートメソッド。資格確認→リクエスト構築→
     * fetch（接続テスト共通リトライ方針）→HTTPエラー変換→上限付き読み取り→
     * parse→例外変換の順序を所有し、プロバイダー固有の癖だけを hooks に委譲する。
     *
     * executeHttpSummaryFlow と対称の Template Method。Gemini / OpenAI の
     * 2 adapter が使う real seam。
     */
    protected async executeHttpTestFlow(
        hooks: HttpTestHooks,
    ): Promise<AIProviderConnectionResult> {
        const credentialFailure = hooks.checkCredentials();
        if (credentialFailure) {
            return credentialFailure;
        }

        const built = await hooks.buildRequest();
        if ('failure' in built) {
            return built.failure;
        }

        const endpoint = `POST ${built.url}`;
        try {
            const allowedUrls = await this.getAllowedUrlsForRequests();

            const response = await fetchWithRetry(built.url, {
                method: 'POST',
                headers: built.headers,
                body: built.body,
                allowedUrls,
                timeoutMs: hooks.timeoutMs,
            }, {
                maxRetryCount: 1,
                initialDelayMs: 500,
                backoffMultiplier: 2,
                maxDelayMs: 3000,
            });

            if (!response.ok) {
                const mapped = this.mapConnectionError(response.status, hooks.providerLabel);
                return {
                    ...mapped,
                    debug: {
                        ...mapped.debug,
                        prompt: CONNECTION_TEST_PROMPT,
                        endpoint,
                        statusCode: response.status,
                    },
                };
            }

            const data = await readJsonCapped(response, MAX_AI_HTTP_RESPONSE_BYTES);
            return hooks.extractResponse(data, { endpoint, statusCode: response.status, modelName: built.modelName });
        } catch (e: unknown) {
            const msg = errorMessage(e);
            const errorName = e instanceof Error ? e.name : undefined;
            const mapped = this.parseAndMapFetchError(msg, hooks.providerLabel, errorName);
            return {
                ...mapped,
                debug: { ...mapped.debug, prompt: CONNECTION_TEST_PROMPT, endpoint },
            };
        }
    }

    /**
     * 接続テスト用の許可 URL 取得。testConnection 経路の共有断片。
     * 旧実装は ALLOWED_URLS ストアキーを読んでいたが、設定書き込み直後の
     * 再同期を待つ窓で新 origin が fail-closed 拒否される競合があるため、
     * 構築時に受け取った settings から毎回新鮮に導出する。キー自体は
     * allowedUrlsSync が永続化し続ける（監査修正の writer 契約）。
     */
    protected async getAllowedUrlsForRequests(): Promise<Set<string>> {
        return buildAllowedUrls(this.settings);
    }

    /**
     * Constructor ritual SSOT (PBI 2026-09-21-10): stored>0 wins,
     * otherwise local=120000 / cloud=30000.
     */
    protected resolveTimeoutMs(storedTimeoutMs: number, isLocal: boolean): number {
        return storedTimeoutMs > 0 ? storedTimeoutMs : isLocal ? 120000 : 30000;
    }

    /**
     * Constructor ritual SSOT (PBI 2026-09-21-10): diagnostics only —
     * the source name is logged, never key material.
     */
    protected logApiKeySource(source: string, providerName: string): void {
        void logDebug(`API key resolved from: ${source}`, { provider: providerName });
    }

    /**
     * Invalid-schema failure shared by the providers' _extractSummary twins
     * (PBI 2026-09-18-09). Logs the technical reason and returns the stable
     * user-facing message — pinned by aiExtract-twins-parity.test.ts.
     */
    protected failInvalidSchema(reason: string, traceId: string = ''): AISummaryResult {
        addLog(LogType.ERROR, reason, { traceId });
        return { success: false, summary: 'Error: Invalid API response format - unexpected schema.', error: reason };
    }

    /**
     * Test-debug base shared by the providers' extractResponse twins
     * (PBI 2026-09-18-09): prompt, endpoint, modelName, statusCode,
     * hasContent, and the response text (present only when non-empty).
     * Provider-specific token counts and empty-errors are spread on top.
     */
    protected buildTestDebugBase(
        ctx: HttpTestContext,
        hasContent: boolean,
        responseText?: string,
    ): NonNullable<AIProviderConnectionResult['debug']> {
        return {
            prompt: CONNECTION_TEST_PROMPT,
            endpoint: ctx.endpoint,
            ...pickDefined({ modelName: ctx.modelName }),
            statusCode: ctx.statusCode,
            hasContent,
            ...pickDefined({ response: hasContent ? responseText : undefined }),
        };
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
 * for one major version. Sunset: remove in next major (re-evaluate 2026-12-31).
 * New code must not import this alias (enforced by check-deprecated-aliases).
 * See CHANGELOG.
 */
export type ProviderStrategy = AIProviderStrategy;