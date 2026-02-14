/**
 * fetch.js
 * タイムアウト付きfetchラッパー
 *
 * Security features (from P1 code review):
 * - Parameter validation for timeoutMs
 * - Support for optional URL validation
 */

import { normalizeUrl } from './urlUtils.js';

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

/**
 * URLを検証（オプション）
 * @param {string} url - 検証するURL
 * @param {object} options - 検証オプション
 * @param {boolean} options.requireValidProtocol - プロトコル検証を要求するかどうか（デフォルトtrue）
 * @param {boolean} options.blockLocalhost - localhostをブロックするかどうか（デフォルトfalse）
 * @throws {Error} URLが無効またはブロックされている場合
 */
function validateUrl(url, options = {}) {
  const { requireValidProtocol = true, blockLocalhost = false } = options;

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch (e) {
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
function validateTimeout(timeoutMs) {
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
 * @param {object} options - fetchオプションとURL検証オプション
 * @param {number} timeoutMs - タイムアウト時間（ミリ秒）、デフォルト30000ms
 * @returns {Promise<Response>} fetchレスポンス
 * @throws {Error} 無効なURL、タイムアウト、またはネットワークエラー
 */
export async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
  // URL検証（オプション - デフォルトではlocalhostを許可）
  const { 
    requireValidProtocol = true, 
    blockLocalhost = false, 
    allowedUrls = null, // 動的URL検証用オプション
    ...fetchOptions 
  } = options;
  validateUrl(url, { requireValidProtocol, blockLocalhost });

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
  } catch (error) {
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
function isPrivateIpAddress(hostname) {
  // IPv4形式（xxx.xxx.xxx.xxx）
  const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [, a, b, c, d] = ipv4Match.map(Number);

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

  // IPv6形式のローカルアドレス
  if (hostname === '::1' || hostname.startsWith('::ffff:127.') || hostname.startsWith('fe80:')) {
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
export function validateUrlForFilterImport(url) {
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
 * @param {Set<string>} allowedUrls - 許可されたURLのセット
 * @returns {boolean} 許可されたURLの場合true
 */
export function isUrlAllowed(url, allowedUrls) {
  if (!allowedUrls || allowedUrls.size === 0) {
    // 許可されたURLのリストがない場合は検証をスキップ（後方互換性）
    return true;
  }

  // URLの正規化
  const normalizedUrl = normalizeUrl(url);

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
export function validateUrlForAIRequests(url) {
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
  const KNOWN_AI_PROVIDERS = [
    'api.openai.com',
    'generativelanguage.googleapis.com',
    'groq.com',
    // ユーザー定義のbaseUrlも許可（カスタムAIプロバイダー対応）
  ];
}