/**
 * fetch.ts
 * タイムアウト付きfetchラッパー
 *
 * Security features (from P1 code review):
 * - Parameter validation for timeoutMs
 * - Support for optional URL validation
 * - CSPValidator integration for AI provider URL validation (P1)
 */

import { normalizeUrl } from './urlUtils.js';
import { CSPValidator, getCspErrorMessage } from './cspValidator.js';
import { getSettings, StorageKeys } from './storage.js';
import { logDebug, logWarn } from './logger.js';

// セキュリティ定数
const ALLOWED_PROTOCOLS = new Set(['https:', 'http:']);
const BLOCKED_PATTERNS = [
  // 注: 127.0.0.1 は Obsidian API で使用されるため除外
  // 注: localhost は Obsidian API で使用される可能性があるため除外
  /^0x7f\./i,         // 0x7f.0.0.1 (alternative localhost format, 除外済み)
  /^::1/,             // IPv6 localhost (除外済み)
  /^\[::f{0,4}:1\]$/i // ::1 in brackets (除外済み)
];

const MIN_TIMEOUT_MS = 100;      // 最小100ms
const MAX_TIMEOUT_MS = 300000;   // 最大5分

interface ValidateUrlOptions {
  requireValidProtocol?: boolean;
  blockLocalhost?: boolean;
}

interface FetchOptions extends RequestInit {
  requireValidProtocol?: boolean;
  blockLocalhost?: boolean;
  allowedUrls?: Set<string> | null;
  skipCspValidation?: boolean; // P1: CSP検証をスキップするフラグ
  timeoutMs?: number; // リクエストタイムアウト時間（ミリ秒）
}

/**
 * URLを検証（オプション）
 * @param {string} url - 検証するURL
 * @param {ValidateUrlOptions} options - 検証オプション
 * @throws {Error} URLが無効またはブロックされている場合
 */
function validateUrl(url: string, options: ValidateUrlOptions = {}): void {
  const { requireValidProtocol = true, blockLocalhost = false } = options;

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch (e: any) {
    throw new Error(`Invalid URL: ${e.message}`);
  }

  // プロトコル検証（オプション）
  if (requireValidProtocol && !ALLOWED_PROTOCOLS.has(parsedUrl.protocol)) {
    throw new Error(`Unsupported protocol: ${parsedUrl.protocol}. Only http:// and https:// are allowed.`);
  }

  // localhostブロック（オプション）
  // Obsidian APIでlocalhostを使用するためデフォルトではブロックしない
  if (blockLocalhost) {
    for (const pattern of BLOCKED_PATTERNS) {
      if (pattern.test(parsedUrl.hostname)) {
        throw new Error(`Blocked hostname: ${parsedUrl.hostname}. Access to localhost addresses is not allowed.`);
      }
    }
  }
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
    ...fetchOptions
  } = options;
  validateUrl(url, { requireValidProtocol, blockLocalhost });

  // P1: CSPValidatorによるAIプロバイダーURL検証
  if (!skipCspValidation) {
    const settings = await getSettings();
    const conditionalCspEnabled = settings[StorageKeys.CONDITIONAL_CSP_ENABLED] !== false; // デフォルトはtrue

    if (conditionalCspEnabled) {
      // CSPValidatorが初期化されていない場合、設定から初期化
      if (!CSPValidator.isInitialized()) {
        CSPValidator.initializeFromSettings(settings);
      }

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
  validateTimeout(timeoutMs);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(url, { ...fetchOptions, signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      // 技術的な詳細を除外して一般的なエラーメッセージを返す
      throw new Error('Error: Request timed out. Please check your connection and try again.');
    }
    throw error;
  }
}

/**
 * プライベートIPアドレスかどうか判定
 * @param {string} hostname - チェックするホスト名
 * @returns {boolean} プライベートIPの場合true
 */
export function isPrivateIpAddress(hostname: string): boolean {
  // IPv4形式（xxx.xxx.xxx.xxx）
  const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [, a, b, c, d] = ipv4Match.map(Number);

    // 各オクテットが0-255の範囲内かチェック
    // 無効なIPアドレス（999.999.999.999など）を識別するため
    if (a < 0 || a > 255 || b < 0 || b > 255 || c < 0 || c > 255 || d < 0 || d > 255) {
      return false; // 無効なIPv4アドレスはプライベートアドレスとして扱わない
    }

    // 10.x.x.x (10.0.0.0/8)
    if (a === 10) return true;

    // 172.16.x.x - 172.31.x.x (172.16.0.0/12)
    if (a === 172 && b >= 16 && b <= 31) return true;

    // 192.168.x.x (192.168.0.0/16)
    if (a === 192 && b === 168) return true;

    // 127.x.x.x (ループバック)
    if (a === 127) return true;

    // 169.254.x.x (リンクローカル、クラウドメタデータ含む)
    if (a === 169 && b === 254) return true;

    return false;
  }

  // IPv6形式のプライベートアドレスの完全なチェック
  const ipv6Lower = hostname.toLowerCase();

  // ::1 - ループバックアドレス
  if (ipv6Lower === '::1') {
    return true;
  }

  // ::ffff:127.x.x.x - IPv4マップアドレス（ループバック）
  if (ipv6Lower.startsWith('::ffff:127.')) {
    return true;
  }

  // fe80::/10 - リンクローカルアドレス (fe80:: ~ febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff)
  if (/^fe[89ab][0-9a-f](:|$)/i.test(ipv6Lower)) {
    return true;
  }

  // fc00::/7 - ユニークローカルアドレス (ULAs)
  // fc00::/7 には fc00::/8 と fd00::/8 が含まれます (fc00:: ~ fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff)
  if (/^fc[0-9a-f]{0,2}:/i.test(ipv6Lower) || /^fd[0-9a-f]{0,2}:/i.test(ipv6Lower)) {
    return true;
  }

  return false;
}

/**
 * uBlockインポート用URLの検証（内部ネットワークブロック）
 * SSRF対策 - 内部ネットワークアドレスへのアクセスを防止
 * @param {string} url - 検証するURL
 * @throws {Error} URLが無効またはプライベートネットワークの場合
 */
export function validateUrlForFilterImport(url: string): void {
  // 既存のバリデーションを使用（プロトコル検証等）
  // Obsidian API用localhostは許可（フィルターインポートのみ別途ブロック）
  validateUrl(url, {
    requireValidProtocol: true,
    blockLocalhost: false
  });

  const parsedUrl = new URL(url);

  // プライベートIPチェック
  if (isPrivateIpAddress(parsedUrl.hostname)) {
    throw new Error(`Access to private network address is not allowed: ${parsedUrl.hostname}`);
  }

  // ドメイン名形式のlocalhostチェック（フィルターインポートのみ）
  if (parsedUrl.hostname === 'localhost' || parsedUrl.hostname.endsWith('.localhost')) {
    throw new Error(`Access to localhost is not allowed for filter imports`);
  }
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
 * AIリクエスト用URLの検証（SSRF対策）
 * 内部ネットワークアドレスへのアクセスを防止
 * @param {string} url - 検証するURL
 * @throws {Error} URLが無効またはプライベートネットワークの場合
 */
export function validateUrlForAIRequests(url: string): void {
  // 既存のバリデーションを使用（プロトコル検証等）
  validateUrl(url, {
    requireValidProtocol: true,
    blockLocalhost: false // AIプロバイダーはlocalhostも許可（開発環境等）
  });

  const parsedUrl = new URL(url);

  // プライベートIPチェック
  if (isPrivateIpAddress(parsedUrl.hostname)) {
    throw new Error(`Access to private network address is not allowed: ${parsedUrl.hostname}`);
  }

  // 既知のAIプロバイダードメインでない場合の警告用チェック
  // 注: これは検証エラーを投げるものではありません
  // const KNOWN_AI_PROVIDERS = [
  //   'api.openai.com',
  //   'generativelanguage.googleapis.com',
  //   'groq.com',
  //   // ユーザー定義のbaseUrlも許可（カスタムAIプロバイダー対応）
  // ];
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
  shouldRetry?: (error: Error, attempt: number, response: Response | null) => boolean;
}

/**
 * デフォルトのリトライ条件判定
 * ネットワークエラー、5xxサーバーエラー、429 Too Many Requestsの場合はリトライ
 */
function defaultShouldRetry(error: Error, attempt: number, response: Response | null): boolean {
  // ネットワークエラー（タイムアウト、接続失敗等）
  if (error.name === 'AbortError' || error.message.includes('NetworkError') || error.message.includes('fetch failed')) {
    return true;
  }

  // 5xxサーバーエラーまたは429 Too Many Requests
  if (response && (response.status >= 500 || response.status === 429)) {
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
    maxDelayMs = 60000,
    shouldRetry = defaultShouldRetry
  } = retryOptions;

  let lastError: Error | null = null;
  let lastResponse: Response | null = null;

  for (let attempt = 0; attempt <= maxRetryCount; attempt++) {
    try {
      const response = await fetchWithTimeout(url, options, options.timeoutMs || 30000);
      lastResponse = response;

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
      if (attempt < maxRetryCount && shouldRetry(attemptError, attempt + 1, response)) {
        // リトライ
        lastError = attemptError;
        logWarn(`HTTP error, retrying...`, { url, attempt: attempt + 1, maxRetryCount, status: response.status }, undefined, 'fetchWithRetry');
      } else {
        // リトライなしまたは全リトライ失敗
        logWarn(`HTTP error, no more retries`, { url, attempt, maxRetryCount, status: response.status }, undefined, 'fetchWithRetry');
        throw attemptError;
      }
    } catch (error: any) {
      lastResponse = null;
      lastError = error;

      // リトライ条件チェック
      if (attempt < maxRetryCount && shouldRetry(error, attempt + 1, null)) {
        // リトライ遅延（指数バックオフ）
        const delay = Math.min(
          initialDelayMs * Math.pow(backoffMultiplier, attempt),
          maxDelayMs
        );
        logWarn(`Request failed, retrying in ${delay}ms...`, { url, attempt: attempt + 1, maxRetryCount, delay, error: error.message }, undefined, 'fetchWithRetry');
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        // リトライなしまたは全リトライ失敗
        logWarn(`Request failed, no more retries`, { url, attempt, maxRetryCount, error: error.message }, undefined, 'fetchWithRetry');
        throw error;
      }
    }
  }

  // ここには到達しないはず（全リトライ失敗時は上でthrowされている）
  throw lastError || new Error('Request failed after retry');
}