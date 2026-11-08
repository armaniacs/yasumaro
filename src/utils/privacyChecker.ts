import { pickDefined } from './objectUtils.js';

/**
 * Cap for attacker-controlled header values echoed into a persisted
 * PrivacyInfo. Matches the 1024-char truncation precedent used elsewhere
 * for untrusted strings. A response header value beyond this length carries
 * no additional signal for privacy detection and only bloats storage.
 */
export const MAX_HEADER_VALUE_LENGTH = 1024;

function capHeaderValue(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value.length > MAX_HEADER_VALUE_LENGTH
    ? value.slice(0, MAX_HEADER_VALUE_LENGTH)
    : value;
}

export interface PrivacyInfo {
  isPrivate: boolean;
  reason?: 'cache-control' | 'set-cookie' | 'authorization';
  timestamp: number;
  headers?: {
    cacheControl?: string;
    hasCookie: boolean;
    hasAuth: boolean;
  };
}

/**
 * Type guard for PrivacyInfo
 * Validates that an unknown value from external storage matches the expected shape.
 * Beyond the two required fields, the optional reason/headers shapes are also
 * checked so corrupt cache entries (wrong reason literal, non-boolean flags,
 * non-finite/negative timestamps) are detected instead of trusted
 * (PBI 2026-11-08-09 (7)). Rejected entries fail safe: callers fall through
 * to a fresh privacy check.
 */
export function isPrivacyInfo(value: unknown): value is PrivacyInfo {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const obj = value as {
    isPrivate?: boolean;
    timestamp?: number;
    reason?: string;
    headers?: { cacheControl?: string; hasCookie?: boolean; hasAuth?: boolean } | null;
  };
  if (typeof obj.isPrivate !== 'boolean') {
    return false;
  }
  if (typeof obj.timestamp !== 'number' || !Number.isFinite(obj.timestamp) || obj.timestamp < 0) {
    return false;
  }
  if (
    obj.reason !== undefined &&
    obj.reason !== 'cache-control' &&
    obj.reason !== 'set-cookie' &&
    obj.reason !== 'authorization'
  ) {
    return false;
  }
  if (obj.headers !== undefined) {
    if (typeof obj.headers !== 'object' || obj.headers === null) {
      return false;
    }
    const headers = obj.headers;
    if (headers.cacheControl !== undefined && typeof headers.cacheControl !== 'string') {
      return false;
    }
    if (headers.hasCookie !== undefined && typeof headers.hasCookie !== 'boolean') {
      return false;
    }
    if (headers.hasAuth !== undefined && typeof headers.hasAuth !== 'boolean') {
      return false;
    }
  }
  return true;
}

/**
 * プライバシー判定ロジック
 *
 * 詳細な判定基準と技術的根拠については以下を参照:
 * dev-docs/ADR/2026-02-21-privacy-detection-logic-refinement.md
 */
export function checkPrivacy(headers: chrome.webRequest.HttpHeader[]): PrivacyInfo {
  const timestamp = Date.now();

  // 1. Cache-Control チェック（最優先）
  // 注意: no-cache は「再検証必須」を意味するだけで、プライベートページではない
  // ニュースサイトなど公開ページでも頻繁に使用されるため、プライベート判定から除外
  // private = 共有キャッシュ禁止（CDN/プロキシ経由で他ユーザーに漏れるのを防ぐ）
  // no-store = キャッシュ完全禁止（機密性の高いページ）
  //   ただし、no-store単独では判定せず、Set-Cookieとの組み合わせで判定
  const cacheControl = findHeader(headers, 'cache-control');
  const cacheControlValue = capHeaderValue(cacheControl?.value);
  const hasCookie = hasHeader(headers, 'set-cookie');
  const hasAuth = hasHeader(headers, 'authorization');
  const vary = findHeader(headers, 'vary');
  const varyCookie = vary?.value?.toLowerCase().includes('cookie') || false;

  if (cacheControl) {
    const value = cacheControl.value?.toLowerCase() || '';

    // private ディレクティブは単独でプライベート判定
    if (value.includes('private')) {
      return {
        isPrivate: true,
        reason: 'cache-control',
        timestamp,
        headers: {
          ...pickDefined({ cacheControl: cacheControlValue }),
          hasCookie,
          hasAuth
        }
      };
    }

    // no-store は Set-Cookie と組み合わせた場合のみプライベート判定
    if (value.includes('no-store') && hasCookie) {
      return {
        isPrivate: true,
        reason: 'cache-control',
        timestamp,
        headers: {
          ...pickDefined({ cacheControl: cacheControlValue }),
          hasCookie,
          hasAuth
        }
      };
    }
  }

  // 2. Set-Cookie + Vary: Cookie チェック
  // Set-Cookie があり、かつ Vary: Cookie がある場合はプライベート判定
  // 理由: サーバーが「このページは見る人（クッキー）によって中身を出し分けている」と宣言しているため
  if (hasCookie && varyCookie) {
    return {
      isPrivate: true,
      reason: 'set-cookie',
      timestamp,
      headers: {
        ...pickDefined({ cacheControl: cacheControlValue }),
        hasCookie: true,
        hasAuth
      }
    };
  }

  // 3. Authorization チェック
  if (hasAuth) {
    return {
      isPrivate: true,
      reason: 'authorization',
      timestamp,
      headers: {
        ...pickDefined({ cacheControl: cacheControlValue }),
        hasCookie: false,
        hasAuth: true
      }
    };
  }

  // 4. いずれも該当しない
  return {
    isPrivate: false,
    timestamp,
    headers: {
      ...pickDefined({ cacheControl: cacheControlValue }),
      hasCookie,
      hasAuth
    }
  };
}

function findHeader(headers: chrome.webRequest.HttpHeader[], name: string): chrome.webRequest.HttpHeader | undefined {
  return headers.find(h => h.name?.toLowerCase() === name.toLowerCase());
}

function hasHeader(headers: chrome.webRequest.HttpHeader[], name: string): boolean {
  // Presence alone is not a signal: an empty Set-Cookie / Authorization value
  // carries no cookie or credential, so blank values must not flip a public
  // page to private (PBI 2026-11-08-09 (8)).
  const found = findHeader(headers, name);
  return typeof found?.value === 'string' && found.value.trim().length > 0;
}
