import { checkPrivacy, PrivacyInfo } from '../utils/privacyChecker.js';
import type { RecordingCacheInstance } from './recordingCache.js';
import { ErrorCode } from '../utils/logger/types.js';
import { logInfo, logDebug, logError } from '../utils/logger/api.js';
import { hashUrl } from '../utils/urlHash.js';
import { normalizeUrlSafe } from '../utils/urlUtils.js';
import { BADGE_COLORS } from '../constants/appConstants.js';
import { errorMessage } from '../utils/errorUtils.js';
import { shouldProcessHeadersResponse } from './pipeline/recordingDecision.js';

const MAX_CACHE_SIZE = 100;
// VULN-003: cap the number of `privacyCache_<url>` keys persisted to session
// storage. They mirror the in-memory cache for SW-restart fallback but, unlike
// it, were never evicted — a long-lived session visiting many distinct URLs
// accumulated unbounded keys until a manual invalidation.
const MAX_SESSION_PRIVACY_KEYS = 2000;

/**
 * VULN-003: number of session-cache keys to evict when the total exceeds `max`.
 * Pure helper so the cap logic is unit-testable.
 */
export function sessionCacheKeysToEvict(keyCount: number, max: number): number {
  return Math.max(0, keyCount - max);
}

export class HeaderDetector {
  constructor(private readonly cache: RecordingCacheInstance) {}

  /**
   * Fire-and-forget runner for diagnostic logging from the sync webRequest
   * callback. onHeadersReceived cannot await, so logging runs detached;
   * failures are diagnostic-only and must never surface as unhandled
   * rejections.
   */
  private fireAndForget(task: () => Promise<unknown>, context: string): void {
    void Promise.resolve()
      .then(() => task())
      .catch((error: unknown) => {
        void logDebug('HeaderDetector fire-and-forget failed', {
          context,
          error: errorMessage(error),
        });
      });
  }

  /**
   * webRequest.onHeadersReceivedリスナーを初期化する
   */
  async initialize(): Promise<void> {
    if (!chrome.webRequest) {
      await logError('webRequest API not available', { source: 'headerDetector' }, ErrorCode.UNKNOWN_ERROR);
      return;
    }

    try {
      chrome.webRequest.onHeadersReceived.addListener(
        this.onHeadersReceived,
        {
          urls: ['<all_urls>'],
          types: ['main_frame']
        },
        ['responseHeaders', 'extraHeaders']
      );

      await logInfo('Successfully initialized webRequest listener', { source: 'headerDetector' });
    } catch (error: unknown) {
      await logError('HeaderDetector initialization failed', { error: errorMessage(error), source: 'headerDetector' }, ErrorCode.UNKNOWN_ERROR);
    }
  }

  /**
   * URL正規化（キャッシュキーの一貫性のため）
   * SSOT の normalizeUrlSafe への委譲。状態を持たない純粋関数のため static のまま維持。
   */
  static normalizeUrl(url: string): string {
    return normalizeUrlSafe(url);
  }

  /**
   * HTTPレスポンスヘッダーを受信した際の処理
   */
  private onHeadersReceived = (details: chrome.webRequest.OnHeadersReceivedDetails): chrome.webRequest.BlockingResponse | undefined => {
    // 【注意】webRequest.onHeadersReceived は同期コールバックのため async 関数にできない
    // URLハッシュ化にはcrypto APIが必要なため、fire-and-forget 経由でログ出力を行う
    this.fireAndForget(async () => {
      const urlHash = await hashUrl(details.url);
      await logDebug('onHeadersReceived fired', { type: details.type, urlHash, source: 'headerDetector' });
    }, 'onHeadersReceived fired');

    try {
      // PBI 2026-09-19-08: main_frame + text/html の gate 判定は
      // recordingDecision.shouldProcessHeadersResponse に委譲
      const contentType = details.responseHeaders?.find(
        (h: chrome.webRequest.HttpHeader) => h.name?.toLowerCase() === 'content-type'
      );
      const gate = shouldProcessHeadersResponse(details.type, contentType?.value);
      this.fireAndForget(async () => logDebug('Content-Type check', { contentType: contentType?.value || 'unknown', source: 'headerDetector' }), 'Content-Type check');

      if (!gate.process) {
        if (gate.reason === 'non-main_frame') {
          this.fireAndForget(async () => logDebug('Skipping non-main_frame', { type: details.type, source: 'headerDetector' }), 'Skipping non-main_frame');
          return;
        }
        this.fireAndForget(async () => {
          const urlHash = await hashUrl(details.url);
          await logDebug('Skipping non-HTML response', {
            urlHash,
            contentType: contentType?.value || 'unknown',
            source: 'headerDetector'
          });
        }, 'Skipping non-HTML response');
        return;
      }

      // プライバシー判定
      const headers = details.responseHeaders || [];
      const privacyInfo = checkPrivacy(headers);

      this.fireAndForget(async () => {
        const urlHash = await hashUrl(details.url);
        await logDebug('Privacy detection result', {
          urlHash,
          isPrivate: privacyInfo.isPrivate,
          reason: privacyInfo.reason,
          hasCache: !!privacyInfo.headers?.cacheControl,
          hasCookie: privacyInfo.headers?.hasCookie,
          hasAuth: privacyInfo.headers?.hasAuth,
          source: 'headerDetector'
        });
      }, 'Privacy detection result');

      // キャッシュに保存
      this.cachePrivacyInfo(details.url, privacyInfo, details.tabId).catch(() => {
        // バッジ更新失敗は無視（非重要なUI操作）
      });

      const cacheSize = this.cache.getPrivacyCacheSize();
      this.fireAndForget(async () => {
        const urlHash = await hashUrl(details.url);
        await logDebug('Privacy info cached', { urlHash, isPrivate: privacyInfo.isPrivate, cacheSize, source: 'headerDetector' });
      }, 'Privacy info cached');
    } catch (error: unknown) {
      const msg = errorMessage(error);
      this.fireAndForget(async () => {
        const urlHash = await hashUrl(details.url);
        await logError('HeaderDetector error', {
          error: msg,
          urlHash,
          source: 'headerDetector'
        }, ErrorCode.UNKNOWN_ERROR);
      }, 'HeaderDetector error');
    }
    return; // Return undefined (non-blocking)
  };

  /**
   * プライバシー情報をキャッシュに保存する
   * キャッシュサイズが上限を超えたら最も古いエントリを削除
   */
  private async cachePrivacyInfo(url: string, info: PrivacyInfo, tabId?: number): Promise<void> {
    const cacheSize = this.cache.getPrivacyCacheSize();
    if (cacheSize >= MAX_CACHE_SIZE) {
      // 同期開始を保つため直接呼び出す（fireAndForget は起動を microtask に遅延させるため、
      // LRU 削除が後続の set より後に回って上限を一時的に超える）。reject はここで回収する。
      void this.evictOldestEntry().catch((error: unknown) => {
        void logDebug('HeaderDetector evictOldestEntry failed', {
          error: errorMessage(error),
        });
      });
    }

    // URL正規化してインメモリキャッシュに保存
    const normalizedUrl = HeaderDetector.normalizeUrl(url);
    this.cache.setPrivacyCacheEntry(normalizedUrl, info);
    this.cache.scheduleCacheSave();

    // Service Worker 再起動後もプライバシー情報を失わないよう session storage にも保存
    // chrome.storage.session はブラウザセッション中は永続 (SW 再起動をまたいでも保持される)
    if (chrome.storage.session) {
      const sessionKey = 'privacyCache_' + normalizedUrl;
      try {
        await chrome.storage.session.set({ [sessionKey]: info });
        // VULN-003: bound the total number of privacyCache_ session keys so a
        // long-lived session cannot accumulate them without limit.
        await this.capSessionPrivacyKeys();
      } catch (error: unknown) {
        // Session storage is auxiliary (in-memory cache is primary), so fall
        // back silently but leave a trace for diagnostics.
        await logDebug('Session privacy cache save failed, using in-memory only', {
          url: normalizedUrl,
          error: errorMessage(error),
        });
      }
    }

    // バッジ更新（プライベート検出時のみ設定。非プライベートでは上書きしない）
    // tabId=-1はバックグラウンドリクエストのためスキップ
    if (tabId !== undefined && tabId >= 0 && info.isPrivate) {
      try {
        await chrome.action.setBadgeText({ text: '!', tabId });
        await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLORS.ORANGE as string, tabId });
      } catch (error) {
        logError('Failed to set privacy badge', {
          tabId,
          url: normalizedUrl,
          error: errorMessage(error)
        }, ErrorCode.BADGE_UPDATE_FAILED, 'headerDetector.ts');
      }
    }
  }

  /**
   * VULN-003: enforce the cap on `privacyCache_` session-storage keys. If the
   * total exceeds the limit, evict the excess (arbitrary subset; frequently
   * visited URLs are re-written on each visit, so they survive).
   */
  private async capSessionPrivacyKeys(): Promise<void> {
    try {
      const all = await chrome.storage.session.get(null);
      const keys = Object.keys(all).filter(key => key.startsWith('privacyCache_'));
      const excess = sessionCacheKeysToEvict(keys.length, MAX_SESSION_PRIVACY_KEYS);
      if (excess > 0) {
        await chrome.storage.session.remove(keys.slice(0, excess));
      }
    } catch (error: unknown) {
      // session storage は補助（インメモリキャッシュが正本）のため失敗は非致命的。
      // 握りつぶさず診断用に debug ログのみ残す。
      await logDebug('Session privacy key cap failed, using in-memory only', {
        error: errorMessage(error),
      });
    }
  }

  /**
   * 最も古いキャッシュエントリを削除する（LRU実装）
   */
  private async evictOldestEntry(): Promise<void> {
    const cache = this.cache.getPrivacyCache();
    if (!cache || cache.size === 0) {
      return;
    }

    // timestampが最小のエントリを見つけて削除
    let oldestUrl: string | null = null;
    let oldestTimestamp = Infinity;

    for (const [url, info] of cache.entries()) {
      if (info.timestamp < oldestTimestamp) {
        oldestTimestamp = info.timestamp;
        oldestUrl = url;
      }
    }

    if (oldestUrl) {
      cache.delete(oldestUrl);
      const urlHash = await hashUrl(oldestUrl);
      await logDebug('Evicted oldest privacy cache entry', { urlHash, source: 'headerDetector' });
    }
  }
}
