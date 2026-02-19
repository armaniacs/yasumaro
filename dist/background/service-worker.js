import { ObsidianClient } from './obsidianClient.js';
import { AIClient } from './aiClient.js';
import { RecordingLogic } from './recordingLogic.js';
import { TabCache } from './tabCache.js';
import { validateUrlForFilterImport, fetchWithTimeout } from '../utils/fetch.js';
import { getSettings, buildAllowedUrls, saveSettingsWithAllowedUrls, migrateToSingleSettingsObject, updateDomainFilterCache } from '../utils/storage.js';
import { isDomainAllowed } from '../utils/domainUtils.js';
import { createErrorResponse } from '../utils/errorMessages.js';
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
// Message type whitelist for security validation
const VALID_MESSAGE_TYPES = ['VALID_VISIT', 'CHECK_DOMAIN', 'GET_CONTENT', 'FETCH_URL', 'MANUAL_RECORD', 'PREVIEW_RECORD', 'SAVE_RECORD', 'TEST_CONNECTIONS'];
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
            // CHECK_DOMAIN は payload 不要
            const NO_PAYLOAD_TYPES = ['CHECK_DOMAIN'];
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
                    skipDuplicateCheck: false
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
            // Manual Record Processing & Preview
            if (message.type === 'MANUAL_RECORD' || message.type === 'PREVIEW_RECORD') {
                const result = await recordingLogic.record({
                    title: message.payload.title,
                    url: message.payload.url,
                    content: message.payload.content,
                    force: message.payload.force,
                    skipDuplicateCheck: true,
                    previewOnly: message.type === 'PREVIEW_RECORD'
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
                    force: message.payload.force
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
//# sourceMappingURL=service-worker.js.map