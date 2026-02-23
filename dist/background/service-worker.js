import { ObsidianClient } from './obsidianClient.js';
import { AIClient } from './aiClient.js';
import { RecordingLogic } from './recordingLogic.js';
import { TabCache } from './tabCache.js';
import { HeaderDetector } from './headerDetector.js';
import { validateUrlForFilterImport, fetchWithTimeout } from '../utils/fetch.js';
import { getSettings, buildAllowedUrls, saveSettingsWithAllowedUrls, migrateToSingleSettingsObject, updateDomainFilterCache } from '../utils/storage.js';
import { isDomainAllowed } from '../utils/domainUtils.js';
import { createErrorResponse } from '../utils/errorMessages.js';
import { NotificationHelper, PRIVACY_CONFIRM_NOTIFICATION_PREFIX } from './notificationHelper.js';
import { getPendingPages, removePendingPages } from '../utils/pendingStorage.js';
// マイグレーション処理を実行
(async () => {
    try {
        const migrated = await migrateToSingleSettingsObject();
        if (migrated) {
            console.log('[ServiceWorker] Settings migrated to single object');
        }
    }
    catch (e) {
        console.error('[ServiceWorker] Failed to migrate settings:', e);
    }
})();
// Initialize clients
const obsidian = new ObsidianClient();
const aiClient = new AIClient();
const recordingLogic = new RecordingLogic(obsidian, aiClient);
// TabCache for storing tab data
const tabCache = new TabCache();
// Initialize HeaderDetector (must be initialized on Service Worker startup)
HeaderDetector.initialize();
// Message type whitelist for security validation
const VALID_MESSAGE_TYPES = ['VALID_VISIT', 'CHECK_DOMAIN', 'GET_CONTENT', 'FETCH_URL', 'MANUAL_RECORD', 'PREVIEW_RECORD', 'SAVE_RECORD', 'TEST_CONNECTIONS', 'GET_PRIVACY_CACHE'];
const INVALID_SENDER_ERROR = { success: false, error: 'Invalid sender' };
const INVALID_MESSAGE_ERROR = { success: false, error: 'Invalid message' };
// Listen for messages from Content Script and Popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const process = async () => {
        try {
            // 【パフォーマンス改善】: メッセージハンドラ関数をインライン化
            // TabCache初期化を必要な場合のみ実行
            // Message payload structure validation
            if (!message || typeof message !== 'object') {
                sendResponse(INVALID_MESSAGE_ERROR);
                return;
            }
            if (!VALID_MESSAGE_TYPES.includes(message.type)) {
                sendResponse(INVALID_MESSAGE_ERROR);
                return;
            }
            // CHECK_DOMAIN と GET_PRIVACY_CACHE は payload 不要
            const NO_PAYLOAD_TYPES = ['CHECK_DOMAIN', 'GET_PRIVACY_CACHE'];
            if (!NO_PAYLOAD_TYPES.includes(message.type)) {
                if (message.payload === undefined || typeof message.payload !== 'object') {
                    sendResponse(INVALID_MESSAGE_ERROR);
                    return;
                }
            }
            // Sender validation: Content Script only message types
            const CONTENT_SCRIPT_ONLY_TYPES = ['VALID_VISIT', 'CHECK_DOMAIN'];
            if (CONTENT_SCRIPT_ONLY_TYPES.includes(message.type)) {
                if (!sender.tab || !sender.tab.id || !sender.tab.url) {
                    sendResponse(INVALID_SENDER_ERROR);
                    return;
                }
                // 【Code Review #2】: フラグ設定を削除（簡素化）
            }
            // 【パフォーマンス改善】: 必要な場合のみTabCache初期化
            // messages that don't need tab cache: TEST_CONNECTIONS, CHECK_DOMAIN
            if (message.type !== 'TEST_CONNECTIONS' && message.type !== 'CHECK_DOMAIN') {
                await tabCache.initialize();
            }
            // Domain Check (Content Script only: loader が extractor を inject する前に確認)
            if (message.type === 'CHECK_DOMAIN' && sender.tab) {
                const url = sender.tab.url || '';
                const allowed = url ? await isDomainAllowed(url) : false;
                sendResponse({ success: true, allowed });
                return;
            }
            // Automatic Visit Processing (Content Script only)
            if (message.type === 'VALID_VISIT' && sender.tab) {
                // 【パフォーマンス改善】: 直接キャッシュにタブを追加
                tabCache.add(sender.tab);
                const result = await recordingLogic.record({
                    title: sender.tab.title || '',
                    url: sender.tab.url || '',
                    content: message.payload?.content || '',
                    skipDuplicateCheck: false,
                    recordType: 'auto'
                });
                // 【パフォーマンス改善】: 直接キャッシュを更新
                if (sender.tab.id) {
                    tabCache.update(sender.tab.id, {
                        title: sender.tab.title || '',
                        url: sender.tab.url || '',
                        content: message.payload?.content || '',
                        isValidVisit: true
                    });
                }
                // 自動保存モード confirm: ボタン付き通知で保存確認を促す
                if (result.confirmationRequired) {
                    const url = sender.tab.url || '';
                    const title = sender.tab.title || url;
                    const reason = result.reason || 'cache-control';
                    const reasonKey = `privatePageReason_${reason.replace('-', '')}`;
                    const reasonLabel = chrome.i18n.getMessage(reasonKey) || reason;
                    // URLをBase64エンコードして通知IDに埋め込む（URLsafe base64）
                    const notificationId = PRIVACY_CONFIRM_NOTIFICATION_PREFIX + btoa(unescape(encodeURIComponent(url))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
                    NotificationHelper.notifyPrivacyConfirm(notificationId, title, reasonLabel);
                }
                sendResponse(result);
                return;
            }
            // Fetch URL Content (CORS Bypass for Popup)
            if (message.type === 'FETCH_URL') {
                try {
                    // SSRF対策: 内部ネットワークブロック
                    validateUrlForFilterImport(message.payload.url);
                    // 許可されたURLのリストを動的に構築（Deadlock回避）
                    const settings = await getSettings();
                    const allowedUrls = buildAllowedUrls(settings);
                    const response = await fetchWithTimeout(message.payload.url, {
                        method: 'GET',
                        cache: 'no-cache',
                        allowedUrls // 最新の動的URL検証リストを使用
                    });
                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                    }
                    const contentType = response.headers.get('content-type');
                    const text = await response.text();
                    sendResponse({ success: true, data: text, contentType });
                }
                catch (error) {
                    console.error('Fetch URL Error:', error);
                    // P2: 技術情報漏洩対策 - ユーザー向けメッセージに変換
                    sendResponse(createErrorResponse(error, { url: message.payload?.url }));
                }
                return;
            }
            // Connection Test (Obsidian + AI)
            if (message.type === 'TEST_CONNECTIONS') {
                // 【パフォーマンス改善】: 接続テストはTabCacheを必要としない
                const obsidianResult = await obsidian.testConnection();
                const aiResult = await aiClient.testConnection();
                sendResponse({ success: true, obsidian: obsidianResult, ai: aiResult });
                return;
            }
            // Get Privacy Cache (for Popup status panel)
            if (message.type === 'GET_PRIVACY_CACHE') {
                const cache = RecordingLogic.cacheState.privacyCache;
                console.log('[ServiceWorker] GET_PRIVACY_CACHE requested, cache size:', cache?.size || 0);
                if (cache) {
                    // Map を配列に変換して送信
                    const cacheArray = Array.from(cache.entries());
                    console.log('[ServiceWorker] Sending', cacheArray.length, 'cache entries to popup');
                    sendResponse({ success: true, cache: cacheArray });
                }
                else {
                    console.log('[ServiceWorker] No cache available, sending empty array');
                    sendResponse({ success: true, cache: [] });
                }
                return;
            }
            // Manual Record Processing & Preview
            if (message.type === 'MANUAL_RECORD' || message.type === 'PREVIEW_RECORD') {
                const result = await recordingLogic.record({
                    title: message.payload.title,
                    url: message.payload.url,
                    content: message.payload.content,
                    force: message.payload.force,
                    skipDuplicateCheck: true,
                    previewOnly: message.type === 'PREVIEW_RECORD',
                    recordType: 'manual'
                });
                sendResponse(result);
                return;
            }
            // Save Confirmed Record (Post-Preview)
            if (message.type === 'SAVE_RECORD') {
                const result = await recordingLogic.record({
                    title: message.payload.title,
                    url: message.payload.url,
                    content: message.payload.content,
                    skipDuplicateCheck: true,
                    alreadyProcessed: true,
                    force: message.payload.force,
                    recordType: 'manual',
                    maskedCount: message.payload.maskedCount
                });
                sendResponse(result);
                return;
            }
            sendResponse(null);
        }
        catch (error) {
            console.error('Service Worker Error:', error);
            // P2: 技術情報漏洩対策 - ユーザー向けメッセージに変換
            sendResponse(createErrorResponse(error));
        }
    };
    process();
    return true; // Keep port open for async response
});
// Handle Tab Closure - Cleanup only
chrome.tabs.onRemoved.addListener((tabId) => {
    tabCache.remove(tabId);
});
// Extension Startup / Installation initialization
const initializeExtension = async () => {
    try {
        const settings = await getSettings();
        await saveSettingsWithAllowedUrls(settings);
        // 【Task #19 最適化】ドメインフィルタキャッシュを更新
        await updateDomainFilterCache(settings);
        console.log('Extension initialized: Allowed URLs list rebuilt and domain filter cache updated.');
    }
    catch (error) {
        console.error('Failed to initialize extension:', error);
    }
};
chrome.runtime.onInstalled.addListener(initializeExtension);
chrome.runtime.onStartup.addListener(initializeExtension);
// ============================================================================
// Privacy Confirmation Notification Handlers
// ============================================================================
/**
 * Decode URL from notification ID (URL-safe base64).
 * Encode: btoa(unescape(encodeURIComponent(url))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'')
 */
function decodeUrlFromNotificationId(notificationId) {
    if (!notificationId.startsWith(PRIVACY_CONFIRM_NOTIFICATION_PREFIX))
        return null;
    try {
        const b64safe = notificationId.slice(PRIVACY_CONFIRM_NOTIFICATION_PREFIX.length);
        const b64 = b64safe.replace(/-/g, '+').replace(/_/g, '/');
        const padded = b64.padEnd(b64.length + (4 - b64.length % 4) % 4, '=');
        return decodeURIComponent(escape(atob(padded)));
    }
    catch {
        return null;
    }
}
// Button 0: 保存する / Button 1: スキップ
chrome.notifications.onButtonClicked.addListener(async (notificationId, buttonIndex) => {
    if (!notificationId.startsWith(PRIVACY_CONFIRM_NOTIFICATION_PREFIX))
        return;
    chrome.notifications.clear(notificationId);
    const url = decodeUrlFromNotificationId(notificationId);
    if (!url)
        return;
    if (buttonIndex === 0) {
        // 「保存する」: pendingから取得してforce記録
        const pages = await getPendingPages();
        const page = pages.find(p => p.url === url);
        if (page) {
            await recordingLogic.record({
                title: page.title,
                url: page.url,
                content: '',
                force: true,
                skipDuplicateCheck: true,
                recordType: 'auto'
            });
        }
    }
    // buttonIndex === 1 「スキップ」: pending に残したまま何もしない（ダッシュボードから後で登録可能）
    await removePendingPages([url]);
});
// 通知本体クリック時も閉じる
chrome.notifications.onClicked.addListener((notificationId) => {
    if (notificationId.startsWith(PRIVACY_CONFIRM_NOTIFICATION_PREFIX)) {
        chrome.notifications.clear(notificationId);
    }
});
//# sourceMappingURL=service-worker.js.map