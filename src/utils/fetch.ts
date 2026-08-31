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
import { settingsRepository } from './storage/SettingsRepository.js';
import { StorageKeys } from './storage/types.js';
import { logDebug, logWarn } from './logger.js';
import { validateUrl, validateUrlForFilterImport } from './ssrfGuard.js';

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

interface FetchOptions extends RequestInit {
  requireValidProtocol?: boolean;
  blockLocalhost?: boolean;
  allowedUrls?: Set<string> | null;
  skipCspValidation?: boolean; // P1: CSP検証をスキップするフラグ
  timeoutMs?: number; // リクエストタイムアウト時間（ミリ秒）
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
export async function fetchWithTimeout(url: string, options: FetchOptions = {}, timeoutMs: number = 30000): Promise<Response> {
  // URL検証（オプション - デフォルトではlocalhostを許可）
  const {
    requireValidProtocol = true,
    blockLocalhost = false,
    allowedUrls = null, // 動的URL検証用オプション
    skipCspValidation = false, // CSP検証をスキップするフラグ（テスト等で使用）
    timeoutMs: optionTimeoutMs,
    ...fetchOptions
  } = options;
  validateUrl(url, { requireValidProtocol, blockLocalhost });

  // options.timeoutMs が指定された場合は最優先で使用する
  const effectiveTimeout = optionTimeoutMs ?? timeoutMs;

  // P1: CSPValidatorによるAIプロバイダーURL検証
  if (!skipCspValidation) {
    const settings = await settingsRepository.getAll();
    const conditionalCspEnabled = settings[StorageKeys.CONDITIONAL_CSP_ENABLED] !== false; // デフォルトはtrue

    if (conditionalCspEnabled) {
      // Always re-initialize CSPValidator with fresh settings
      // (settings may have been updated since last call)
      CSPValidator.initializeFromSettings(settings);

      // CSP検証
      if (!CSPValidator.isUrlAllowed(url)) {
        const cspError = getCspErrorMessage(url);
        if (cspError) {
          throw new Error(cspError);
        }
        // メッセージがない場合は汎用エラー
        throw new Error(`URL blocked by CSP policy: ${url}`);
      }
    }
  }

  // 動的URL検証（オプション）
  if (allowedUrls) {
    if (!isUrlAllowed(url, allowedUrls)) {
      throw new Error(`URL is not allowed: ${url}`);
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
      throw timeoutError;
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
  timeoutMs: number = 30000,
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
    // 許可されたURLのリストがない場合は検証をスキップ（後方互換性）
    return true;
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
  /** HTTPメソッドの明示的な指定（省略時はリクエストオプションのmethodを使用） */
  method?: string;
}

/**
 * デフォルトのリトライ条件判定
 * - AbortError（タイムアウト）: 最大1回リトライ（合計2試行）
 * - HTTP 429 Too Many Requests: リトライなし（即時終了）
 * - HTTP 5xx サーバーエラー: 冪等なメソッド（GET等）のみ maxRetryCount まで通常リトライ。
 *   POST/PUT/PATCH/DELETE は二重生成・二重課金を防ぐためリトライしない
 * @param {string} method - HTTPメソッド（デフォルト 'GET'）
 */
function defaultShouldRetry(error: Error, attempt: number, response: Response | null, method: string = 'GET'): boolean {
  // 429 Too Many Requests: リトライしない
  if (response && response.status === 429) {
    return false;
  }

  // 5xxサーバーエラー: 冪等なメソッドのみリトライ
  if (response && response.status >= 500) {
    const nonIdempotentMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
    return !nonIdempotentMethods.has(method.toUpperCase());
  }

  // AbortError（タイムアウト）: 最大1回のみリトライ（attempt=1 のとき、つまり2回目の試行まで）
  // fetchWithTimeout converts AbortError to Error('Request timed out...'), so check both
  if (error.name === 'AbortError' || error.message.includes('timed out')) {
    return attempt <= 1;
  }

  // その他のネットワークエラー（接続失敗等）
  if (error.message.includes('NetworkError') || error.message.includes('fetch failed')) {
    return true;
  }

  return false;
}

/**
 * 指数バックオフ付きリトライ機能付きフェッチ
 * ネットワークエラーや5xxエラー時に自動リトライ
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
    shouldRetry = defaultShouldRetry
  } = retryOptions;

  const requestMethod = retryOptions.method ?? options.method ?? 'GET';

  let lastError: Error | null = null;
  let _lastResponse: Response | null = null;

  for (let attempt = 0; attempt <= maxRetryCount; attempt++) {
    try {
      const response = await fetchWithTimeout(url, options, options.timeoutMs || 30000);
      _lastResponse = response;

      // レスポンスが正常な場合は返却
      if (response.ok) {
        // 成功時のログ（リトライがあった場合のみ）
        if (attempt > 0) {
          logDebug(`Request succeeded after ${attempt} retries`, { url, attempt, maxRetryCount }, 'fetchWithRetry');
        }
        return response;
      }

      // エラーレスポンスの場合、リトライ条件をチェック
      const attemptError = new Error(`HTTP ${response.status}: ${response.statusText}`);
      if (attempt < maxRetryCount && shouldRetry(attemptError, attempt + 1, response, requestMethod)) {
        // リトライ
        lastError = attemptError;
        logWarn(`HTTP error, retrying...`, { url, attempt: attempt + 1, maxRetryCount, status: response.status }, undefined, 'fetchWithRetry');
      } else {
        // リトライなしまたは全リトライ失敗
        logWarn(`HTTP error, no more retries`, { url, attempt, maxRetryCount, status: response.status }, undefined, 'fetchWithRetry');
        throw attemptError;
      }
    } catch (error: unknown) {
      _lastResponse = null;
      lastError = error instanceof Error ? error : new Error(String(error));

      // リトライ条件チェック
      if (attempt < maxRetryCount && shouldRetry(lastError, attempt + 1, null, requestMethod)) {
        // リトライ遅延（指数バックオフ）
        const delay = Math.min(
          initialDelayMs * Math.pow(backoffMultiplier, attempt),
          maxDelayMs
        );
        logWarn(`Request failed, retrying in ${delay}ms...`, { url, attempt: attempt + 1, maxRetryCount, delay, error: lastError.message }, undefined, 'fetchWithRetry');
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        // リトライなしまたは全リトライ失敗
        logWarn(`Request failed, no more retries`, { url, attempt, maxRetryCount, error: lastError.message }, undefined, 'fetchWithRetry');
        throw lastError;
      }
    }
  }

  // ここには到達しないはず（全リトライ失敗時は上でthrowされている）
  throw lastError || new Error('Request failed after retry');
}
