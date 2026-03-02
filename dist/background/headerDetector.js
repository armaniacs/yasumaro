import { checkPrivacy } from '../utils/privacyChecker.js';
import { RecordingLogic } from './recordingLogic.js';
import { logInfo, logDebug, logError, ErrorCode } from '../utils/logger.js';
import { hashUrl } from '../utils/crypto.js';
const MAX_CACHE_SIZE = 100;
export class HeaderDetector {
    /**
     * webRequest.onHeadersReceivedリスナーを初期化する
     */
    static async initialize() {
        if (!chrome.webRequest) {
            await logError('webRequest API not available', { source: 'headerDetector' }, ErrorCode.UNKNOWN_ERROR);
            return;
        }
        try {
            chrome.webRequest.onHeadersReceived.addListener(HeaderDetector.onHeadersReceived, {
                urls: ['<all_urls>'],
                types: ['main_frame']
            }, ['responseHeaders', 'extraHeaders']);
            await logInfo('Successfully initialized webRequest listener', { source: 'headerDetector' });
        }
        catch (error) {
            await logError('HeaderDetector initialization failed', { error: error.message, source: 'headerDetector' }, ErrorCode.UNKNOWN_ERROR);
        }
    }
    /**
     * HTTPレスポンスヘッダーを受信した際の処理
     */
    static onHeadersReceived(details) {
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
            const contentType = details.responseHeaders?.find((h) => h.name?.toLowerCase() === 'content-type');
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
            HeaderDetector.cachePrivacyInfo(details.url, privacyInfo);
            const cacheSize = RecordingLogic.cacheState.privacyCache?.size || 0;
            (async () => {
                const urlHash = await hashUrl(details.url);
                await logDebug('Privacy info cached', { urlHash, isPrivate: privacyInfo.isPrivate, cacheSize, source: 'headerDetector' });
            })();
        }
        catch (error) {
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
    static async evictOldestEntry() {
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
            const urlHash = await hashUrl(oldestUrl);
            await logDebug('Evicted oldest privacy cache entry', { urlHash, source: 'headerDetector' });
        }
    }
}
//# sourceMappingURL=headerDetector.js.map