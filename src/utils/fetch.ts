/**
 * fetch.ts
 * タイムアウト付きfetchラッパー
 *
 * Security features (from P1 code review):
 * - Parameter validation for timeoutMs
 * - Support for optional URL validation
 * - CSPValidator integration for AI provider URL validation (P1)
 *
 * SSRF防止・IP分類・localhostポリシーは ssrfGuard.ts に分離されている。
 * このファイルはHTTPトランスポート（timeout/retry/abort）のみを扱う。
 */

import { normalizeUrl } from './urlUtils.js';
import { CSPValidator, getCspErrorMessage } from './cspValidator.js';
import { toError } from './errorUtils.js';
import { settingsRepository } from './storage/SettingsRepository.js';
import type { Settings } from './storage/types.js';
import { StorageKeys } from './storage/types.js';
import { logDebug, logWarn } from './logger/api.js';
import { validateUrl, validateUrlForFilterImport } from './ssrfGuard.js';
import { backoffDelayMs } from './backoff.js';
import {
  FailureKind,
  createFailure,
  failureFromHttpStatus,
  shouldRetryHttpResponse,
  shouldRetryTransportFailure,
  tagFailure,
} from './failureTaxonomy.js';

export {
  normalizeIpHostname,
  isPrivateIpAddress,
  validateUrlForFilterImport,
  ALLOWED_LOCALHOST_PORTS,
  isLocalhostAddress,
  validateUrlForAIRequests,
  validateUrl,
  type ValidateUrlOptions,
} from './ssrfGuard.js';

const MIN_TIMEOUT_MS = 100;      // 最小100ms
const MAX_TIMEOUT_MS = 300000;   // 最大5分
/** 既定のリクエストタイムアウト（ミリ秒）。各ラッパーのデフォルト引数と
 *  呼び出し側のフォールバックで 1 定義を共有する（PBI 04）。 */
const DEFAULT_TIMEOUT_MS = 30000;

/**
 * 接続テスト用の fetch キャッシュポリシー。
 *
 * 接続テストは「今この瞬間その API へ到達できるか」を確かめる機能なので、
 * ブラウザの HTTP キャッシュに当たってはならない。指定しないと
 * GET /models や GET /user などの冪等な GET がキャッシュヒットし、
 * ネットワーク往復なしで応答が返る。その結果、
 *
 * - 所要時間が 0.0 秒と表示され計測値として意味をなさない
 * - API キー失効後やオフラインでも「接続成功」を返しうる
 *
 * という二重の問題が生じる。後者はテスト結果そのものが信頼できない
 * ことを意味するため、接続テストの fetch では必ずこれを渡す。
 */
export const CONNECTION_TEST_CACHE_MODE: RequestCache = 'no-store';

/**
 * リダイレクトを追従しない fetch 方針。ADR 2026-08-29 が FETCH_URL 経路で
 * `redirect: 'error'` を採用して以降、宛先をユーザーが設定できる経路
 * (AI プロバイダの OpenAI 互換 baseUrl、Obsidian の vault URL) にも同じ
 * 方針が必要になった。platform 既定の `'follow'` のままだと、許可済みの
 * origin が 30x を返しただけで、`Location` が指す未検証アドレスへ資格情報
 * ヘッダーと本文が再送される。
 *
 * `fetchWithTimeout` は残りの fetchOptions と一緒にこの値を platform fetch へ
 * 素通しするので、呼び出し側はこの定数を spread するだけでよい。片方の経路
 * だけに適用すると、同じ資格情報を持つもう一方が抜け道として残る。
 */
export const NO_REDIRECT_FETCH_POLICY = { redirect: 'error' } as const;

/**
 * Options accepted by {@link noRedirectInit}: everything the fetch helpers take,
 * minus `redirect` (which the policy owns).
 */
export type NoRedirectFetchInit = Omit<FetchOptions, 'redirect'>;

/**
 * Builds a fetch init around {@link NO_REDIRECT_FETCH_POLICY} (PBI 2026-10-19-05).
 *
 * The policy used to be spread first and then, in principle, overridden by a
 * later `redirect:` key in the same object literal — silently and with no type
 * or lint complaint. Taking the rest of the options through
 * `Omit<FetchOptions, 'redirect'>` makes that override a compile error
 * (`TS2353`) while the correct form (policy + other options) still type-checks.
 *
 * Narrow only this seam: `FetchOptions` stays as wide as `RequestInit` because
 * `fetchWithRedirectGuard` legitimately passes `redirect: 'manual'`.
 */
export function noRedirectInit(options: NoRedirectFetchInit = {}): RequestInit {
  return { ...NO_REDIRECT_FETCH_POLICY, ...options };
}

interface FetchOptions extends RequestInit {
  requireValidProtocol?: boolean;
  blockLocalhost?: boolean;
  allowedUrls?: Set<string> | null;
  skipCspValidation?: boolean; // P1: CSP検証をスキップするフラグ
  timeoutMs?: number; // リクエストタイムアウト時間（ミリ秒）
  resolveSettings?: () => Promise<Settings>;
}

/**
 * タイムアウトパラメータを検証
 * @param {number} timeoutMs - 検証するタイムアウト値（ミリ秒）
 * @throws {Error} タイムアウト値が無効な場合
 */
function validateTimeout(timeoutMs: number): void {
  if (typeof timeoutMs !== 'number') {
    throw new Error(`Timeout must be a number, got ${typeof timeoutMs}`);
  }

  if (!Number.isFinite(timeoutMs)) {
    throw new Error(`Timeout must be a finite number, got ${timeoutMs}`);
  }

  if (timeoutMs < MIN_TIMEOUT_MS) {
    throw new Error(`Timeout must be at least ${MIN_TIMEOUT_MS}ms, got ${timeoutMs}ms`);
  }

  if (timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error(`Timeout must not exceed ${MAX_TIMEOUT_MS}ms, got ${timeoutMs}ms`);
  }
}

/**
 * タイムアウト付きfetchラッパー
 * @param {string} url - リクエストURL
 * @param {FetchOptions} options - fetchオプションとURL検証オプション
 * @param {number} timeoutMs - タイムアウト時間（ミリ秒）、デフォルト30000ms
 * @returns {Promise<Response>} fetchレスポンス
 * @throws {Error} 無効なURL、タイムアウト、またはネットワークエラー
 */
export async function fetchWithTimeout(url: string, options: FetchOptions = {}, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<Response> {
  // URL検証（オプション - デフォルトではlocalhostを許可）
  const {
    requireValidProtocol = true,
    blockLocalhost = false,
    allowedUrls = null, // 動的URL検証用オプション
    skipCspValidation = false, // CSP検証をスキップするフラグ（テスト等で使用）
    timeoutMs: optionTimeoutMs,
    resolveSettings = () => settingsRepository.getAll(),
    ...fetchOptions
  } = options;
  validateUrl(url, { requireValidProtocol, blockLocalhost });

  // options.timeoutMs が指定された場合は最優先で使用する
  const effectiveTimeout = optionTimeoutMs ?? timeoutMs;

  // P1: CSPValidatorによるAIプロバイダーURL検証
  if (!skipCspValidation) {
    const settings = await resolveSettings();
    const conditionalCspEnabled = settings[StorageKeys.CONDITIONAL_CSP_ENABLED] !== false; // デフォルトはtrue

    if (conditionalCspEnabled) {
      // Always re-initialize CSPValidator with fresh settings
      // (settings may have been updated since last call)
      CSPValidator.initializeFromSettings(settings);

      // CSP検証
      if (!CSPValidator.isUrlAllowed(url)) {
        const cspError = getCspErrorMessage(url);
        if (cspError) {
          throw tagFailure(new Error(cspError), createFailure(FailureKind.CSP));
        }
        // メッセージがない場合は汎用エラー
        throw tagFailure(new Error(`URL blocked by CSP policy: ${url}`), createFailure(FailureKind.CSP));
      }
    }
  }

  // 動的URL検証（オプション）
  if (allowedUrls) {
    if (!isUrlAllowed(url, allowedUrls)) {
      throw tagFailure(new Error(`URL is not allowed: ${url}`), createFailure(FailureKind.CSP));
    }
  }

  // タイムアウト検証
  validateTimeout(effectiveTimeout);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, effectiveTimeout);

  try {
    const response = await fetch(url, { ...fetchOptions, signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (error: unknown) {
    clearTimeout(timeoutId);
    // タイムアウト判定は環境依存のメッセージではなく error.name で行う
    if (error instanceof Error && error.name === 'AbortError') {
      const timeoutError = new Error(`Request timed out after ${effectiveTimeout}ms`);
      // 下流のリトライ判定やエラーハンドラが name ベースで検出できるようにする
      timeoutError.name = 'AbortError';
      // 旧 error は cause に渡さない: message には response body が混入しうる
      // ため、診断に必要な name だけを構造化 metadata として残す。
      throw tagFailure(timeoutError, createFailure(FailureKind.TIMEOUT, { cause: timeoutError }));
    }
    throw error;
  }
}

/**
 * Maximum number of redirect hops fetchWithRedirectGuard will follow before
 * giving up. Matches the browser default (20) is unnecessary here; filter-list
 * mirrors realistically need at most a couple of hops.
 */
const MAX_REDIRECT_HOPS = 5;

const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);

/**
 * fetch that follows redirects manually, re-validating every hop's target with
 * validateUrlForFilterImport (protocol + private-IP + localhost guard).
 *
 * The platform `fetch` follows redirects silently with `redirect: 'follow'`,
 * so an allow-listed URL can 30x-redirect to an internal address (SSRF /
 * CWE-918). This helper closes that hole for attacker-influenced URLs (e.g.
 * user-supplied uBlock filter-list sources) by using `redirect: 'manual'` and
 * checking each `Location` before issuing the next request.
 *
 * The current FETCH_URL handler uses `redirect: 'error'` (see ADR
 * 2026-08-29-fetch-redirect-policy); this helper is the contract for any future
 * fetch of an attacker-influenced URL that legitimately needs to follow
 * redirects.
 *
 * @param url - initial request URL (assumed already validated by the caller)
 * @param options - fetch options; `redirect` is forced to `'manual'`
 * @param timeoutMs - per-hop timeout
 */
export async function fetchWithRedirectGuard(
  url: string,
  options: FetchOptions = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  let currentUrl = url;

  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
    const response = await fetchWithTimeout(
      currentUrl,
      // CSP validation targets AI-provider URLs; filter-list fetches gate on
      // allowedUrls + validateUrlForFilterImport instead, applied per hop below.
      { ...options, redirect: 'manual', skipCspValidation: true },
      timeoutMs,
    );

    if (!REDIRECT_STATUS_CODES.has(response.status)) {
      return response;
    }

    const location = response.headers.get('location');
    if (!location) {
      throw new Error(`Redirect response ${response.status} is missing a Location header`);
    }

    // Resolve relative Location against the current hop URL.
    let nextUrl: string;
    try {
      nextUrl = new URL(location, currentUrl).toString();
    } catch {
      throw new Error(`Invalid redirect Location: ${location}`);
    }

    // Re-apply the full SSRF guard to the redirect target.
    validateUrlForFilterImport(nextUrl);

    logDebug('Following validated redirect', { from: currentUrl, to: nextUrl, status: response.status }, 'fetchWithRedirectGuard');
    currentUrl = nextUrl;
  }

  throw new Error(`Too many redirects (limit ${MAX_REDIRECT_HOPS})`);
}

/**
 * 動的URL検証
 * @param {string} url - 検証するURL
 * @param {Set<string> | null} allowedUrls - 許可されたURLのセット
 * @returns {boolean} 許可されたURLの場合true
 */
export function isUrlAllowed(url: string, allowedUrls: Set<string> | null): boolean {
  if (!allowedUrls || allowedUrls.size === 0) {
    // Fail-closed: an empty set means the persisted allowlist was never
    // seeded (or was wiped), not "allow everything". Callers seed
    // ALLOWED_URLS from buildAllowedUrls on settings writes and at SW
    // startup, so a legitimate request never reaches this branch.
    return false;
  }

  // URLの正規化（無効なURLの場合はfalseを返す）
  let normalizedUrl: string;
  try {
    normalizedUrl = normalizeUrl(url);
  } catch {
    // 無効なURLは許可しない
    return false;
  }

  // 完全一致チェック
  if (allowedUrls.has(normalizedUrl)) {
    return true;
  }

  // プレフィックスチェック（サブパスを許可）
  for (const allowedUrl of allowedUrls) {
    if (normalizedUrl.startsWith(allowedUrl + '/')) {
      return true;
    }
  }

  return false;
}

/**
 * リトライ間の待機関数。AGENTS.md の待機ポリシーにより、本番コードの意図的待機は
 * 注入可能にする。両リトライ経路（HTTP 5xx / ネットワークエラー）が同一ヘルパーを
 * 経由しないと、片方だけが遅延ゼロの連打リトライに戻るためここで一元化する。
 */
export type SleepFn = (ms: number) => Promise<void>;

const defaultSleep: SleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function backoffWait(
  sleepFn: SleepFn,
  delay: number,
  payload: { message: string; data: Record<string, unknown> },
): Promise<void> {
  logWarn(payload.message, payload.data, undefined, 'fetchWithRetry');
  await sleepFn(delay);
}

/**
 * リトライ設定
 */
export interface RetryOptions {
  /** リトライ回数（デフォルト: 3） */
  maxRetryCount?: number;
  /** 初期遅延時間（ミリ秒、デフォルト: 1000） */
  initialDelayMs?: number;
  /** バックオフ倍率（デフォルト: 2） */
  backoffMultiplier?: number;
  /** 最大遅延時間（ミリ秒、デフォルト: 60000） */
  maxDelayMs?: number;
  /** リトライすべきエラー条件 */
  shouldRetry?: (error: Error, attempt: number, response: Response | null, method?: string) => boolean;
  /** 待機関数（リトライ間のバックオフ。既定は setTimeout ラッパ） */
  sleep?: SleepFn;
  /** HTTPメソッドの明示的な指定（省略時はリクエストオプションのmethodを使用） */
  method?: string;
}

/**
 * デフォルトのリトライ条件判定
 * - HTTP 429 / 401 / 403（rate_limit / auth）: リトライしない
 * - HTTP 5xx（http）: 冪等なメソッド（GET等）のみ maxRetryCount まで通常リトライ。
 *   POST/PUT/PATCH/DELETE は二重生成・二重課金を防ぐためリトライしない
 * - タイムアウト（timeout）: 最大1回リトライ（合計2試行）
 * - ネットワークエラー（network）: リトライする
 * @param {string} method - HTTPメソッド（デフォルト 'GET'）
 *
 * 判定は構造化 failure kind のみに依存する（src/utils/failureTaxonomy.ts が
 * SSOT）。429 を http のまま扱うと retry 資格が曖昧になるため、必ず
 * rate_limit へ閉じる。message 部分文字列を retry 判断に使わない。
 */
function defaultShouldRetry(error: Error, attempt: number, response: Response | null, method: string = 'GET'): boolean {
  if (response) {
    return shouldRetryHttpResponse(response.status, method);
  }
  return shouldRetryTransportFailure(error, attempt);
}

/**
 * Everything one retry decision inside {@link fetchWithRetry} needs. The
 * loop-level values are the same for both failure paths; only `attempt`,
 * `logPrefix`, and `kindData` differ per path.
 */
interface RetryDecisionContext {
  url: string;
  /** 0-origin index of the attempt that failed. */
  attempt: number;
  maxRetryCount: number;
  sleepFn: SleepFn;
  initialDelayMs: number;
  backoffMultiplier: number;
  maxDelayMs: number;
  /** Log wording shared by the retrying and exhausted messages. */
  logPrefix: string;
  /** Failure-kind fields merged into both log payloads (`status` / `error`). */
  kindData: Record<string, unknown>;
}

/**
 * One shared "retry, wait, or give up" step for {@link fetchWithRetry} (PBI 18).
 *
 * The HTTP-status path and the catch path used to hold identical copies of
 * this block, so a fix to the shouldRetry condition or the backoff formula
 * applied to one copy could silently miss the other. Both paths now call this
 * single helper; only the log wording and the failure-kind log fields differ.
 *
 * Contract (unchanged): while retries remain and shouldRetry allows the next
 * attempt, log the retry through backoffWait and wait
 * `backoffDelayMs(attempt, ...)` on the injected SleepFn; otherwise log one
 * warn line and throw the given error with no further sleep.
 */
async function decideRetryAndBackoff(
  shouldRetry: NonNullable<RetryOptions['shouldRetry']>,
  error: Error,
  response: Response | null,
  method: string,
  ctx: RetryDecisionContext,
): Promise<void> {
  if (ctx.attempt < ctx.maxRetryCount && shouldRetry(error, ctx.attempt + 1, response, method)) {
    const delay = backoffDelayMs(ctx.attempt, {
      baseMs: ctx.initialDelayMs,
      multiplier: ctx.backoffMultiplier,
      maxMs: ctx.maxDelayMs,
    });
    await backoffWait(ctx.sleepFn, delay, {
      message: `${ctx.logPrefix}, retrying in ${delay}ms...`,
      data: {
        url: ctx.url,
        attempt: ctx.attempt + 1,
        maxRetryCount: ctx.maxRetryCount,
        delay,
        ...ctx.kindData,
      },
    });
    return;
  }

  logWarn(`${ctx.logPrefix}, no more retries`, {
    url: ctx.url,
    attempt: ctx.attempt,
    maxRetryCount: ctx.maxRetryCount,
    ...ctx.kindData,
  }, undefined, 'fetchWithRetry');
  throw error;
}

/**
 * 指数バックオフ付きリトライ機能付きフェッチ
 * ネットワークエラーや5xxエラー時に自動リトライ
 *
 * ネットワークエラー・HTTP 5xx のどちらのリトライも同一の指数バックオフ
 * （backoffDelayMs + SleepFn）で待機する。下記の totalBackoff 契約は両経路で成立する。
 *
 * **タイムアウト動作:**
 * - 各リトライ試行は `timeoutMs` でタイムアウト
 * - 全リトライ失敗時の最大待機時間: `(maxRetryCount + 1) * timeoutMs + totalBackoff`
 * - 例: maxRetryCount=3, timeoutMs=30000, initialDelayMs=1000, backoffMultiplier=2 の場合
 *   - 最大待機時間: 4 * 30000 + (1000 + 2000 + 4000) = 127000ms (約2分)
 *
 * @param {string} url - リクエストURL
 * @param {RequestInit} options - fetchオプション
 * @param {RetryOptions} retryOptions - リトライ設定
 * @returns {Promise<Response>} fetchレスポンス
 * @throws {Error} 全リトライ失敗時
 */
export async function fetchWithRetry(
  url: string,
  options: FetchOptions = {},
  retryOptions: RetryOptions = {}
): Promise<Response> {
  const {
    maxRetryCount = 3,
    initialDelayMs = 1000,
    backoffMultiplier = 2,
    maxDelayMs = 10000,
    shouldRetry = defaultShouldRetry,
    sleep: sleepFn = defaultSleep
  } = retryOptions;

  const requestMethod = retryOptions.method ?? options.method ?? 'GET';

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetryCount; attempt++) {
    try {
      const response = await fetchWithTimeout(url, options, options.timeoutMs || DEFAULT_TIMEOUT_MS);

      // レスポンスが正常な場合は返却
      if (response.ok) {
        // 成功時のログ（リトライがあった場合のみ）
        if (attempt > 0) {
          logDebug(`Request succeeded after ${attempt} retries`, { url, attempt, maxRetryCount }, 'fetchWithRetry');
        }
        return response;
      }

      // エラーレスポンスの場合、リトライ条件をチェック
      // HTTP status は構造化 failure として持たせる: 呼び出し側が
      // 「429 / 401 / 403 / 5xx か」を message から推測しなくて済む。
      const attemptError = tagFailure(
        new Error(`HTTP ${response.status}: ${response.statusText}`),
        failureFromHttpStatus(response.status, requestMethod),
      );
      lastError = attemptError;
      // リトライ判定・バックオフ・諦めは catch 経路と同一の decideRetryAndBackoff で行う
      await decideRetryAndBackoff(shouldRetry, attemptError, response, requestMethod, {
        url,
        attempt,
        maxRetryCount,
        sleepFn,
        initialDelayMs,
        backoffMultiplier,
        maxDelayMs,
        logPrefix: 'HTTP error',
        kindData: { status: response.status },
      });
    } catch (error: unknown) {
      lastError = toError(error);

      // response を null で渡すのは catch 経路の既定（transport 失敗として判定）
      await decideRetryAndBackoff(shouldRetry, lastError, null, requestMethod, {
        url,
        attempt,
        maxRetryCount,
        sleepFn,
        initialDelayMs,
        backoffMultiplier,
        maxDelayMs,
        logPrefix: 'Request failed',
        kindData: { error: lastError.message },
      });
    }
  }

  // ここには到達しないはず（全リトライ失敗時は上でthrowされている）
  throw lastError || new Error('Request failed after retry');
}
