/**
 * AIプロバイダーのベースクラス
 * 新しいAIプロバイダーを追加する際はこのクラスを継承する
 *
 * ここに置くもの: 設定の保持、設定解決（`providerSettingsResolver`）、
 * 名前とID、応答parse失敗と使用量計上の共有ポリシー。
 *
 * ここに置かないもの: HTTP の送信に関わるすべて。送信するプロバイダは
 * `HttpProviderStrategy` を挟んで継承するので、オンデバイス実行の
 * `BuiltInAiProvider` は送信前ガードも送信リトライも持ち得ない。
 *
 * リトライ述語と HTTP→メッセージ写像はどちらもこのクラスにない。前者は
 * `src/utils/fetch.ts` の述語が唯一の定義で、要約・接続テストの両フローが
 * それを継承する（provider 側で上書きすると 2 つのフローが食い違う）。後者は
 * `src/utils/httpFailureMessages.ts` に集約されている。
 */

import { Settings } from '../../../utils/storage/types.js';
import { recordUsage } from '../../../utils/aiUsageTracker.js';
import {
    FailureKind,
    createFailure,
    withFailure,
    type FailureMetadata,
} from '../../../utils/failureTaxonomy.js';
import { addLog } from '../../../utils/logger/core.js';
import { logDebug } from '../../../utils/logger/api.js';
import { LogType } from '../../../utils/logger/types.js';

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
        /** Structured failure (kind / status / method), PBI 2026-09-25-11. Never carries key material or a response body. */
        failure?: FailureMetadata;
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
    /** Structured failure of the slot, when the provider classified it (PBI 2026-09-25-11). */
    failure?: FailureMetadata;
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
    /**
     * Structured failure behind this result (PBI 2026-09-25-11). This result is a
     * failure *carrier*, not an exception: a total provider failure keeps flowing
     * back as `success: false` so privacyPipeline's branch stays intact, and the
     * kind travels alongside the sanitized `summary` for the retry decision.
     */
    failure?: FailureMetadata;
    error?: string;         // スキーマ不整合等の詳細エラー（ユーザー向け summary とは別）
}

export abstract class AIProviderStrategy {
    protected settings: Settings;

    constructor(settings: Settings) {
        this.settings = settings;
    }

    /**
     * 要約を生成する
     * @param {string} content - 要約対象のコンテンツ
     * @param {boolean} [tagSummaryMode=false] - タグ付き要約モード
     * @param {string} [traceId] - 記録パイプラインのトレースID
     */
    abstract generateSummary(content: string, tagSummaryMode?: boolean, traceId?: string): Promise<AISummaryResult>;

    /**
     * Diagnostics for the constructor's key resolution: the source name only.
     * Never the key itself — this line is not a place secrets may reach.
     */
    protected logApiKeySource(source: string, providerName: string): void {
        void logDebug(`API key resolved from: ${source}`, { provider: providerName });
    }

    /**
     * Invalid-schema failure shared by the providers' _extractSummary twins
     * (PBI 2026-09-18-09). Logs the technical reason and returns the stable
     * user-facing message — pinned by aiExtract-twins-parity.test.ts — plus the
     * structured kind the breaker gate branches on.
     */
    protected failInvalidSchema(reason: string, traceId: string = ''): AISummaryResult {
        addLog(LogType.ERROR, reason, { traceId });
        // WHY `http` and not `configuration`: the taxonomy has no schema kind,
        // and the two candidates mean opposite things to the breaker. A
        // malformed payload is a fault of the *response* (the provider answered
        // and the answer was unusable) and is not repaired by any setting, so it
        // must count toward the breaker — `configuration` would be ignored there
        // and a provider serving garbage would never be cooled down. `http` is
        // the taxonomy's "the response, not the request, was at fault" bucket,
        // and it keeps the failure out of the offline-recovery queue.
        return withFailure(
            { success: false, summary: 'Error: Invalid API response format - unexpected schema.', error: reason },
            createFailure(FailureKind.HTTP),
        );
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