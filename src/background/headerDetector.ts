import { checkPrivacy, PrivacyInfo } from '../utils/privacyChecker.js';
import { RecordingLogic } from './recordingLogic.js';
import { addLog, LogType } from '../utils/logger.js';

const MAX_CACHE_SIZE = 100;

export class HeaderDetector {
  /**
   * webRequest.onHeadersReceivedリスナーを初期化する
   */
  static initialize(): void {
    if (!chrome.webRequest) {
      addLog(LogType.ERROR, 'webRequest API not available');
      return;
    }

    chrome.webRequest.onHeadersReceived.addListener(
      HeaderDetector.onHeadersReceived,
      {
        urls: ['<all_urls>'],
        types: ['main_frame']
      },
      ['responseHeaders']
    );

    addLog(LogType.INFO, 'HeaderDetector initialized');
  }

  /**
   * HTTPレスポンスヘッダーを受信した際の処理
   */
  private static onHeadersReceived(details: chrome.webRequest.OnHeadersReceivedDetails): chrome.webRequest.BlockingResponse | undefined {
    try {
      // メインフレームのHTMLのみ処理
      if (details.type !== 'main_frame') {
        return;
      }

      // Content-Typeチェック（HTMLのみ）
      const contentType = details.responseHeaders?.find(
        (h: chrome.webRequest.HttpHeader) => h.name?.toLowerCase() === 'content-type'
      );
      if (!contentType?.value?.includes('text/html')) {
        return;
      }

      // プライバシー判定
      const headers = details.responseHeaders || [];
      const privacyInfo = checkPrivacy(headers);

      // キャッシュに保存
      HeaderDetector.cachePrivacyInfo(details.url, privacyInfo);

      if (privacyInfo.isPrivate) {
        addLog(LogType.DEBUG, 'Privacy info cached', {
          url: details.url,
          reason: privacyInfo.reason
        });
      }
    } catch (error: any) {
      // エラーは握りつぶしてログのみ記録
      addLog(LogType.ERROR, 'HeaderDetector error', {
        error: error.message,
        url: details.url
      });
    }
    return; // Return undefined (non-blocking)
  }

  /**
   * プライバシー情報をキャッシュに保存する
   * キャッシュサイズが上限を超えたら最も古いエントリを削除
   */
  private static cachePrivacyInfo(url: string, info: PrivacyInfo): void {
    if (!RecordingLogic.cacheState.privacyCache) {
      RecordingLogic.cacheState.privacyCache = new Map();
      RecordingLogic.cacheState.privacyCacheTimestamp = Date.now();
    }

    // キャッシュサイズ制限チェック
    if (RecordingLogic.cacheState.privacyCache.size >= MAX_CACHE_SIZE) {
      HeaderDetector.evictOldestEntry();
    }

    RecordingLogic.cacheState.privacyCache.set(url, info);
  }

  /**
   * 最も古いキャッシュエントリを削除する（LRU実装）
   */
  private static evictOldestEntry(): void {
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
      addLog(LogType.DEBUG, 'Evicted oldest privacy cache entry', { url: oldestUrl });
    }
  }
}
