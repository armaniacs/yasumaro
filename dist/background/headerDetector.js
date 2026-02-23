import { checkPrivacy } from '../utils/privacyChecker.js';
import { RecordingLogic } from './recordingLogic.js';
import { addLog, LogType } from '../utils/logger.js';
const MAX_CACHE_SIZE = 100;
export class HeaderDetector {
    /**
     * webRequest.onHeadersReceivedリスナーを初期化する
     */
    static initialize() {
        if (!chrome.webRequest) {
            console.error('[HeaderDetector] webRequest API not available');
            addLog(LogType.ERROR, 'webRequest API not available');
            return;
        }
        try {
            chrome.webRequest.onHeadersReceived.addListener(HeaderDetector.onHeadersReceived, {
                urls: ['<all_urls>'],
                types: ['main_frame']
            }, ['responseHeaders', 'extraHeaders']);
            console.log('[HeaderDetector] Successfully initialized webRequest listener');
            addLog(LogType.INFO, 'HeaderDetector initialized');
        }
        catch (error) {
            console.error('[HeaderDetector] Failed to initialize:', error);
            addLog(LogType.ERROR, 'HeaderDetector initialization failed: ' + error.message);
        }
    }
    /**
     * HTTPレスポンスヘッダーを受信した際の処理
     */
    static onHeadersReceived(details) {
        console.log('[HeaderDetector] onHeadersReceived fired for:', details.url);
        try {
            // メインフレームのHTMLのみ処理
            if (details.type !== 'main_frame') {
                console.log('[HeaderDetector] Skipping non-main_frame:', details.type);
                return;
            }
            // Content-Typeチェック（HTMLのみ）
            const contentType = details.responseHeaders?.find((h) => h.name?.toLowerCase() === 'content-type');
            console.log('[HeaderDetector] Content-Type:', contentType?.value || 'unknown');
            if (!contentType?.value?.includes('text/html')) {
                addLog(LogType.DEBUG, 'Skipping non-HTML response', {
                    url: details.url,
                    contentType: contentType?.value || 'unknown'
                });
                return;
            }
            // プライバシー判定
            const headers = details.responseHeaders || [];
            const privacyInfo = checkPrivacy(headers);
            console.log('[HeaderDetector] Privacy info:', {
                url: details.url,
                isPrivate: privacyInfo.isPrivate,
                reason: privacyInfo.reason,
                cacheControl: privacyInfo.headers?.cacheControl,
                hasCookie: privacyInfo.headers?.hasCookie,
                hasAuth: privacyInfo.headers?.hasAuth
            });
            // キャッシュに保存
            HeaderDetector.cachePrivacyInfo(details.url, privacyInfo);
            console.log('[HeaderDetector] Privacy info cached, cache size:', RecordingLogic.cacheState.privacyCache?.size || 0);
            // すべてのケースでログ出力（デバッグ用）
            addLog(LogType.DEBUG, 'Privacy info cached', {
                url: details.url,
                isPrivate: privacyInfo.isPrivate,
                reason: privacyInfo.reason,
                cacheControl: privacyInfo.headers?.cacheControl
            });
        }
        catch (error) {
            // エラーは握りつぶしてログのみ記録
            addLog(LogType.ERROR, 'HeaderDetector error', {
                error: error.message,
                url: details.url
            });
        }
        return; // Return undefined (non-blocking)
    }
    /**
     * URL正規化（キャッシュキーの一貫性のため）
     * - 末尾のスラッシュを削除
     * - フラグメント（#...）を削除
     */
    static normalizeUrl(url) {
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
        }
        catch {
            // パース失敗時は元のURLを返す
            return url;
        }
    }
    /**
     * プライバシー情報をキャッシュに保存する
     * キャッシュサイズが上限を超えたら最も古いエントリを削除
     */
    static cachePrivacyInfo(url, info) {
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
    }
    /**
     * 最も古いキャッシュエントリを削除する（LRU実装）
     */
    static evictOldestEntry() {
        const cache = RecordingLogic.cacheState.privacyCache;
        if (!cache || cache.size === 0) {
            return;
        }
        // timestampが最小のエントリを見つけて削除
        let oldestUrl = null;
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
//# sourceMappingURL=headerDetector.js.map