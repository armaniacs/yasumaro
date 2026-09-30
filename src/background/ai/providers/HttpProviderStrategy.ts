/**
 * HttpProviderStrategy.ts
 *
 * The two HTTP flows, and only those.
 *
 * A summary request and a connection test are the same spine twice over:
 * credentials, transport, retry, error mapping, a size-capped body read, and a
 * provider-specific parse at the end. That spine used to live on the base class
 * beside identity, settings resolution and usage accounting, so a provider
 * that issues no request at all (on-device BuiltIn) inherited template methods
 * it must never call, and a change to the error wording sat two hundred lines
 * away from the wording it changed.
 *
 * The split is by reach, not by size: this class is what reaches a transport.
 * The base keeps what a provider needs either way (its settings, its name, the
 * settings ladder, the shared failure and usage policies), and the two HTTP
 * adapters inherit from here.
 *
 * Retry policy is deliberately absent: `fetchWithRetry`'s own predicate is the
 * single implementation and both flows inherit it, so a provider cannot install
 * a policy that differs from the one its sibling flow uses.
 */

import { applyCustomPrompt } from '../../../utils/customPromptUtils.js';
import { errorMessage } from '../../../utils/errorUtils.js';
import { fetchWithRetry } from '../../../utils/fetch.js';
import { readJsonCapped } from '../../../utils/readBodyCapped.js';
import { checkPromptSafety } from '../../../utils/promptSafety.js';
import { pickDefined } from '../../../utils/objectUtils.js';
import { buildAllowedUrls } from '../../../utils/storage/urlWhitelist.js';
import { checkHardLimit, checkRateLimit, checkUsageWarning, getRateLimitMessage } from '../../../utils/aiUsageTracker.js';
import {
  FailureKind,
  createFailure,
  failureFromHttpStatus,
  resolveFailure,
  withFailure,
} from '../../../utils/failureTaxonomy.js';
import {
  describeSummaryRequestFailure,
  mapHttpConnectionFailure,
  mapHttpFetchFailure,
  SUMMARY_FAILURE_MESSAGE,
} from '../../../utils/httpFailureMessages.js';
import { MAX_AI_HTTP_RESPONSE_BYTES } from '../../../utils/limits.js';
import {
  AIProviderStrategy,
  CONNECTION_TEST_PROMPT,
  type AIProviderConnectionResult,
  type AISummaryResult,
} from './ProviderStrategy.js';

/** HTTP要約リクエスト（hooks.prepareRequest の成功形） */
export interface HttpSummaryRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/**
 * HTTP要約フローのプロバイダー固有フック。順序・pre-flight・サニタイズ・
 * プロンプト・fetch・リトライ・timeout変換はテンプレートが所有し、ここには
 * 限度・資格文面・リクエスト構築・parse の癖だけを置く。
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
  /** Display label passed to both HTTP failure mappings */
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
 * Base for every provider that talks to a remote endpoint. Everything a
 * non-HTTP provider would have to avoid calling lives here, which is the point:
 * the on-device provider extends `AIProviderStrategy` and therefore cannot
 * reach a pre-flight budget or a request body cap by accident.
 */
export abstract class HttpProviderStrategy extends AIProviderStrategy {
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
   * HTTP要約フローのテンプレートメソッド。資格確認→pre-flight→切り詰め→
   * サニタイズ→プロンプト→fetch（共通リトライ方針）→timeout変換の順序を
   * 所有し、プロバイダー固有の癖だけを hooks に委譲する。
   */
  protected async executeHttpSummaryFlow(
    content: string,
    tagSummaryMode: boolean,
    traceId: string,
    hooks: HttpSummaryHooks,
  ): Promise<AISummaryResult> {
    const credentialError = hooks.checkCredentials();
    if (credentialError) {
      // A missing key is a configuration failure: no request will be made
      // and no amount of retrying fixes it.
      return withFailure(
        { success: false, summary: credentialError },
        createFailure(FailureKind.CONFIGURATION),
      );
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

      // No `shouldRetry`: the transport's own predicate is the single
      // implementation, so the summary flow cannot drift from the connection
      // test. It reads the structured kind only.
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
      });

      if (!response.ok) {
        // `fetchWithRetry` throws on non-ok, so this is unreachable through
        // the production transport. It stays because a transport that ever
        // resolves a non-ok must not have its error body parsed as a summary —
        // and it reports the same generic sentence the throw path reports,
        // instead of a provider-specific one no user has ever seen.
        return withFailure(
          { success: false, summary: SUMMARY_FAILURE_MESSAGE, error: `HTTP ${response.status}` },
          failureFromHttpStatus(response.status, 'POST'),
        );
      }

      const data = await readJsonCapped(response, MAX_AI_HTTP_RESPONSE_BYTES);
      return hooks.extractSummary(data, traceId);
    } catch (error: unknown) {
      return describeSummaryRequestFailure(error);
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
      // Same reading as the summary flow's own credential gate: no request is
      // made and no retry can fix a missing credential, so the test result
      // carries the configuration kind. A hook that already knows better (a
      // future provider with a structured reason) keeps its kind.
      return {
        ...credentialFailure,
        debug: {
          ...credentialFailure.debug,
          failure: credentialFailure.debug?.failure ?? createFailure(FailureKind.CONFIGURATION),
        },
      };
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
        const mapped = mapHttpConnectionFailure(response.status, hooks.providerLabel);
        return {
          ...mapped,
          debug: {
            ...mapped.debug,
            prompt: CONNECTION_TEST_PROMPT,
            endpoint,
            statusCode: response.status,
            failure: failureFromHttpStatus(response.status, 'POST'),
          },
        };
      }

      const data = await readJsonCapped(response, MAX_AI_HTTP_RESPONSE_BYTES);
      return hooks.extractResponse(data, { endpoint, statusCode: response.status, modelName: built.modelName });
    } catch (e: unknown) {
      const mapped = mapHttpFetchFailure(
        errorMessage(e),
        hooks.providerLabel,
        e instanceof Error ? e.name : undefined,
        resolveFailure(e),
      );
      return {
        ...mapped,
        debug: { ...mapped.debug, prompt: CONNECTION_TEST_PROMPT, endpoint },
      };
    }
  }
}
