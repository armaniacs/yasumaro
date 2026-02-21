import { RecordingLogic } from '../background/recordingLogic.js';
import { getSettings, getSavedUrlsWithTimestamps } from '../utils/storage.js';
import { isDomainAllowed, extractDomain, isDomainInList } from '../utils/domainUtils.js';

export interface StatusInfo {
  domainFilter: {
    allowed: boolean;
    mode: 'disabled' | 'whitelist' | 'blacklist';
    matched: boolean;
    matchedPattern?: string;
  };
  privacy: {
    isPrivate: boolean;
    reason?: 'cache-control' | 'set-cookie' | 'authorization';
    hasCache: boolean;
    piiRisk?: 'high' | 'medium' | 'low';
  };
  cache: {
    cacheControl?: string;
    hasCookie: boolean;
    hasAuth: boolean;
    hasCache: boolean;
  };
  lastSaved: {
    timestamp?: number;
    timeAgo?: string;
    formatted?: string;
    exists: boolean;
  };
}

interface TimeFormat {
  timeAgo: string;
  formatted: string;
}

export function formatTimeAgo(timestamp: number): TimeFormat {
  const now = Date.now();
  const diff = now - timestamp;
  const date = new Date(timestamp);

  // 相対時間
  let timeAgo: string;
  if (diff < 60 * 1000) {
    timeAgo = 'たった今';
  } else if (diff < 60 * 60 * 1000) {
    const minutes = Math.floor(diff / (60 * 1000));
    timeAgo = `${minutes}分前`;
  } else if (diff < 24 * 60 * 60 * 1000) {
    const hours = Math.floor(diff / (60 * 60 * 1000));
    timeAgo = `${hours}時間前`;
  } else if (diff < 48 * 60 * 60 * 1000) {
    timeAgo = '昨日';
  } else {
    const days = Math.floor(diff / (24 * 60 * 60 * 1000));
    timeAgo = `${days}日前`;
  }

  // 絶対時間
  const today = new Date(now);
  const isToday =
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear();

  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  let formatted: string;

  if (isToday) {
    formatted = `${hours}:${minutes}`;
  } else {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    formatted = `${month}/${day} ${hours}:${minutes}`;
  }

  return { timeAgo, formatted };
}

/**
 * Find matching pattern from domain list
 * @param domain - The domain to check
 * @param domainList - The list of domains/patterns to check against
 * @returns The matching pattern or undefined
 */
function findMatchedPattern(domain: string, domainList: string[] | undefined): string | undefined {
  if (!domainList || domainList.length === 0) {
    return undefined;
  }

  for (const pattern of domainList) {
    // Simple pattern matching (same logic as isDomainInList)
    const matches = pattern.includes('*')
      ? new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*')}$`, 'i').test(domain)
      : domain.toLowerCase() === pattern.toLowerCase();

    if (matches) {
      return pattern;
    }
  }
  return undefined;
}

/**
 * URL正規化（キャッシュキーの一貫性のため）
 * headerDetector.tsと同じロジック
 */
function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // フラグメントを削除
    parsed.hash = '';
    let normalized = parsed.toString();
    // 末尾のスラッシュを削除（ルートパス以外）
    if (normalized.endsWith('/') && parsed.pathname !== '/') {
      normalized = normalized.slice(0, -1);
    }
    return normalized;
  } catch {
    // パース失敗時は元のURLを返す
    return url;
  }
}

/**
 * fetch APIを使用してCache-Controlヘッダーを直接取得
 */
async function fetchCacheControlHeader(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      cache: 'no-store',
      mode: 'cors'
    });
    return response.headers.get('cache-control');
  } catch (error) {
    console.warn('[StatusChecker] Failed to fetch headers:', error);
    return null;
  }
}

export async function checkPageStatus(url: string): Promise<StatusInfo | null> {
  // 特殊URLのチェック
  if (url.startsWith('chrome://') || url.startsWith('about:') || url.startsWith('edge://')) {
    return null;
  }

  try {
    // URL正規化
    const normalizedUrl = normalizeUrl(url);
    console.log('[StatusChecker] Checking status for URL:', { original: url, normalized: normalizedUrl });

    // Service Workerからプライバシーキャッシュを取得
    let privacyInfo: any = null;
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_PRIVACY_CACHE' });
      console.log('[StatusChecker] Privacy cache response:', response);

      if (response && response.success && response.cache) {
        const cacheMap = new Map(response.cache);
        privacyInfo = cacheMap.get(normalizedUrl);
        console.log('[StatusChecker] Found privacy info in cache:', privacyInfo);
      }
    } catch (error) {
      console.warn('[StatusChecker] Failed to get privacy cache:', error);
    }

    // 並列処理で設定とURL履歴を取得
    const [settings, savedUrls, allowed] = await Promise.all([
      getSettings(),
      getSavedUrlsWithTimestamps(),
      isDomainAllowed(url)
    ]);

    // ドメインフィルタチェック
    const mode: 'disabled' | 'whitelist' | 'blacklist' = (settings.domain_filter_mode || 'disabled') as 'disabled' | 'whitelist' | 'blacklist';
    const whitelist = settings.domain_whitelist || [];
    const blacklist = settings.domain_blacklist || [];
    const domain = extractDomain(url);

    // matchedPatternを計算
    let matched = false;
    let matchedPattern: string | undefined = undefined;

    if (domain) {
      if (mode === 'whitelist' && isDomainInList(domain, whitelist)) {
        matched = true;
        matchedPattern = findMatchedPattern(domain, whitelist);
      } else if (mode === 'blacklist' && isDomainInList(domain, blacklist)) {
        matched = true;
        matchedPattern = findMatchedPattern(domain, blacklist);
      }
    }

    // キャッシュ情報（Service Workerから取得した情報を優先）
    const headers = privacyInfo?.headers;
    const cacheInfo = {
      cacheControl: headers?.cacheControl,
      hasCookie: headers?.hasCookie || false,
      hasAuth: headers?.hasAuth || false,
      hasCache: !!headers?.cacheControl
    };

    // プライバシー判定（Service Workerから取得した情報を使用）
    const isPrivate = privacyInfo?.isPrivate || false;
    const reason = privacyInfo?.reason;

    console.log('[StatusChecker] Privacy detection:', {
      isPrivate,
      reason,
      cacheControl: cacheInfo.cacheControl,
      hasCookie: cacheInfo.hasCookie,
      hasAuth: cacheInfo.hasAuth,
      hasCache: cacheInfo.hasCache
    });

    // 最終保存時刻
    const savedTimestamp = savedUrls.get(url);
    const lastSavedInfo = savedTimestamp
      ? {
          timestamp: savedTimestamp,
          ...formatTimeAgo(savedTimestamp),
          exists: true
        }
      : {
          exists: false
        };

    return {
      domainFilter: {
        allowed,
        mode,
        matched,
        matchedPattern
      },
      privacy: {
        isPrivate,
        reason,
        hasCache: cacheInfo.hasCache,
        piiRisk: undefined // 将来の拡張用
      },
      cache: cacheInfo,
      lastSaved: lastSavedInfo
    };
  } catch (error) {
    console.error('Error checking page status:', error);
    // エラー時はデフォルト値を返す
    return {
      domainFilter: {
        allowed: true,
        mode: 'disabled',
        matched: false
      },
      privacy: {
        isPrivate: false,
        hasCache: false
      },
      cache: {
        hasCookie: false,
        hasAuth: false,
        hasCache: false
      },
      lastSaved: {
        exists: false
      }
    };
  }
}