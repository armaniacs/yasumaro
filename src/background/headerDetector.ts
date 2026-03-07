import { checkPrivacy, PrivacyInfo } from '../utils/privacyChecker.js';
import { RecordingLogic } from './recordingLogic.js';
import { logInfo, logDebug, logError, logWarn, ErrorCode } from '../utils/logger.js';
import { hashUrl } from '../utils/crypto.js';

const MAX_CACHE_SIZE = 100;

export class HeaderDetector {
  /**
   * webRequest.onHeadersReceivedリスナーを初期化する
   */
  static async initialize(): Promise<void> {
    if (!chrome.webRequest) {
      await logError('webRequest API not available', { source: 'headerDetector' }, ErrorCode.UNKNOWN_ERROR);
      return;
    }

    try {
      chrome.webRequest.onHeadersReceived.addListener(
        HeaderDetector.onHeadersReceived,
        {
          urls: ['<all_urls>'],
          types: ['main_frame']
        },
        ['responseHeaders', 'extraHeaders']
      );

      await logInfo('Successfully initialized webRequest listener', { source: 'headerDetector' });
    } catch (error: any) {
      await logError('HeaderDetector initialization failed', { error: error.message, source: 'headerDetector' }, ErrorCode.UNKNOWN_ERROR);
    }
  }

  /**
   * URL正規化（キャッシュキーの一貫性のため）
   * - 末尾のスラッシュを削除
   * - フラグメント（#...）を削除
   */
  static normalizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      parsed.hash = '';
      let normalized = parsed.toString();
      if (normalized.endsWith('/') && parsed.pathname !== '/') {
        normalized = normalized.slice(0, -1);
      }
      return normalized;
    } catch {
      return url;
    }
  }

  /**
   * HTTPレスポンスヘッダーを受信した際の処理
   */
  private static onHeadersReceived(details: chrome.webRequest.OnHeadersReceivedDetails): chrome.webRequest.BlockingResponse | undefined {
    // 【注意】webRequest.onHeadersReceived は同期コールバックのため async 関数にできない
    // URLハッシュ化にはcrypto APIが必要なため、即時実行の非同期関数を経由してログ出力を行う
    (async () => {
      const urlHash = await hashUrl(details.url);
      await logDebug('onHeadersReceived fired', { type: details.type, urlHash, source: 'headerDetector' });
    })();

    try {
      // メインフレームのHTMLのみ処理
      if (details.type !== 'main_frame') {
        (async () => await logDebug('Skipping non-main_frame', { type: details.type, source: 'headerDetector' }))();
        return;
      }

      // Content-Typeチェック（HTMLのみ）
      const contentType = details.responseHeaders?.find(
        (h: chrome.webRequest.HttpHeader) => h.name?.toLowerCase() === 'content-type'
      );
      (async () => await logDebug('Content-Type check', { contentType: contentType?.value || 'unknown', source: 'headerDetector' }))();

      if (!contentType?.value?.includes('text/html')) {
        (async () => {
          const urlHash = await hashUrl(details.url);
          await logDebug('Skipping non-HTML response', {
            urlHash,
            contentType: contentType?.value || 'unknown',
            source: 'headerDetector'
          });
        })();
        return;
      }

      // プライバシー判定
      const headers = details.responseHeaders || [];
      const privacyInfo = checkPrivacy(headers);

      (async () => {
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
      })();

      // キャッシュに保存
      HeaderDetector.cachePrivacyInfo(details.url, privacyInfo, details.tabId).catch(() => {
        // バッジ更新失敗は無視（非重要なUI操作）
      });

      const cacheSize = RecordingLogic.cacheState.privacyCache?.size || 0;
      (async () => {
        const urlHash = await hashUrl(details.url);
        await logDebug('Privacy info cached', { urlHash, isPrivate: privacyInfo.isPrivate, cacheSize, source: 'headerDetector' });
      })();
    } catch (error: any) {
      // エラーは握りつぶしてログのみ記録
      (async () => {
        const urlHash = await hashUrl(details.url);
        await logError('HeaderDetector error', {
          error: error.message,
          urlHash,
          source: 'headerDetector'
        }, ErrorCode.UNKNOWN_ERROR);
      })();
    }
    return; // Return undefined (non-blocking)
  }

  /**
   * プライバシー情報をキャッシュに保存する
   * キャッシュサイズが上限を超えたら最も古いエントリを削除
   */
  private static async cachePrivacyInfo(url: string, info: PrivacyInfo, tabId?: number): Promise<void> {
    if (!RecordingLogic.cacheState.privacyCache) {
      RecordingLogic.cacheState.privacyCache = new Map();
      RecordingLogic.cacheState.privacyCacheTimestamp = Date.now();
    }

    // キャッシュサイズ制限チェック
    if (RecordingLogic.cacheState.privacyCache.size >= MAX_CACHE_SIZE) {
      HeaderDetector.evictOldestEntry();
    }

    // URL正規化してインメモリキャッシュに保存
    const normalizedUrl = HeaderDetector.normalizeUrl(url);
    RecordingLogic.cacheState.privacyCache.set(normalizedUrl, info);

    // Service Worker 再起動後もプライバシー情報を失わないよう session storage にも保存
    // chrome.storage.session はブラウザセッション中は永続 (SW 再起動をまたいでも保持される)
    if (chrome.storage.session) {
      const sessionKey = 'privacyCache_' + normalizedUrl;
      chrome.storage.session.set({ [sessionKey]: info }).catch(() => {
        // session storage エラーは握りつぶす（インメモリが主、sessionは補助）
      });
    }

    // バッジ更新（プライベート検出時のみ設定。非プライベートでは上書きしない）
    // tabId=-1はバックグラウンドリクエストのためスキップ
    if (tabId !== undefined && tabId >= 0 && info.isPrivate) {
      try {
        await chrome.action.setBadgeText({ text: '!', tabId });
        await chrome.action.setBadgeBackgroundColor({ color: '#F97316', tabId });
      } catch (error) {
        logError('Failed to set privacy badge', {
          tabId,
          url: normalizedUrl,
          error: error instanceof Error ? error.message : String(error)
        }, ErrorCode.BADGE_UPDATE_FAILED, 'headerDetector.ts');
      }
    }
  }

  /**
   * 最も古いキャッシュエントリを削除する（LRU実装）
   */
  private static async evictOldestEntry(): Promise<void> {
    const cache = RecordingLogic.cacheState.privacyCache;
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
