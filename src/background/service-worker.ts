import { ObsidianClient } from './obsidianClient.js';
import { AIClient } from './aiClient.js';
import { RecordingLogic } from './recordingLogic.js';
import { TabCache } from './tabCache.js';
import { HeaderDetector } from './headerDetector.js';
import { validateUrlForFilterImport, fetchWithTimeout } from '../utils/fetch.js';
import {
    getAllowedUrls,
    getSettings,
    buildAllowedUrls,
    saveSettingsWithAllowedUrls,
    migrateToSingleSettingsObject,
    updateDomainFilterCache,
    lockSession,
    StorageKeys
} from '../utils/storage.js';
import { isDomainAllowed } from '../utils/domainUtils.js';
import { isSecureUrl, sanitizeUrlForLogging } from '../utils/urlUtils.js';
import { createErrorResponse, convertKnownErrorMessage } from '../utils/errorMessages.js';
import { NotificationHelper, PRIVACY_CONFIRM_NOTIFICATION_PREFIX } from './notificationHelper.js';
import { getPendingPages, removePendingPages } from '../utils/pendingStorage.js';
import { logInfo, logDebug, logWarn, logError, ErrorCode } from '../utils/logger.js';
import {
    cleanupOldDeniedEntries,
    cleanupDismissedEntries
} from '../utils/permissionManager.js';
import {
    getNotificationHmacKey,
    generateHmacSignature,
    verifyHmacSignature
} from '../utils/crypto.js';
import { updateActivity, initialize as initializeSessionAlarms } from './sessionAlarmsManager.js';
import { setUrlContent, setUrlCleansedReason } from '../utils/storageUrls.js';

// マイグレーション処理を実行
(async () => {
    try {
        const migrated = await migrateToSingleSettingsObject();
        if (migrated) {
            logInfo(
                'Settings migrated to single object',
                { migrated: true },
                'service-worker'
            );
        }
    } catch (e) {
        logError(
            'Failed to migrate settings',
            { error: e instanceof Error ? e.message : String(e) },
            ErrorCode.STORAGE_MIGRATION_FAILURE,
            'service-worker'
        );
    }
})();

// Initialize clients
const obsidian = new ObsidianClient();
const aiClient = new AIClient();
const recordingLogic = new RecordingLogic(obsidian, aiClient);

// TabCache for storing tab data
const tabCache = new TabCache();

// 自動保存成功バッジを表示中のタブIDセット
const autoSavedBadgeTabs = new Set<number>();

// Initialize HeaderDetector (must be initialized on Service Worker startup)
HeaderDetector.initialize();

// Message type whitelist for security validation
const VALID_MESSAGE_TYPES = ['VALID_VISIT', 'CHECK_DOMAIN', 'GET_CONTENT', 'FETCH_URL', 'MANUAL_RECORD', 'PREVIEW_RECORD', 'SAVE_RECORD', 'TEST_CONNECTIONS', 'TEST_OBSIDIAN', 'TEST_AI', 'GET_PRIVACY_CACHE', 'ACTIVITY_UPDATE', 'SESSION_LOCK_REQUEST', 'CONTENT_CLEANSING_EXECUTED'];
const INVALID_SENDER_ERROR = { success: false, error: 'Invalid sender' };
const INVALID_MESSAGE_ERROR = { success: false, error: 'Invalid message' };

// Rate limit configuration for skipAi operations
const SKIP_AI_RATE_LIMIT_MAX = 5; // Max 5 operations per window
const SKIP_AI_RATE_LIMIT_WINDOW_MS = 60000; // 1 minute window
const skipAiRateLimiter = new Map<string, { count: number; resetTime: number }>();

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
            // CHECK_DOMAIN、GET_PRIVACY_CACHE、ACTIVITY_UPDATE、SESSION_LOCK_REQUEST は payload 不要
            const NO_PAYLOAD_TYPES = ['CHECK_DOMAIN', 'GET_PRIVACY_CACHE', 'ACTIVITY_UPDATE', 'SESSION_LOCK_REQUEST'];
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
            // messages that don't need tab cache: TEST_CONNECTIONS, TEST_OBSIDIAN, TEST_AI, CHECK_DOMAIN
            if (message.type !== 'TEST_CONNECTIONS' && message.type !== 'TEST_OBSIDIAN' && message.type !== 'TEST_AI' && message.type !== 'CHECK_DOMAIN') {
                await tabCache.initialize();
            }

            // Content Cleansing executed notification (Content Script only)
            if (message.type === 'CONTENT_CLEANSING_EXECUTED' && sender.tab && sender.tab?.id) {
                const { hardStripRemoved, keywordStripRemoved, totalRemoved } = message.payload || {};
                const tabId = sender.tab.id;

                // Badge にクレンジング情報を表示（C + 削除数）
                const badgeText = `C${totalRemoved || 0}`;
                chrome.action.setBadgeText({ text: badgeText, tabId });
                chrome.action.setBadgeBackgroundColor({ color: '#10B981', tabId: tabId }); // Green

                // 3秒後に Badge をクリア
                setTimeout(() => {
                    // まだ自動保存されていない場合のみクリア
                    if (!autoSavedBadgeTabs.has(tabId)) {
                        chrome.action.setBadgeText({ text: '', tabId });
                    }
                }, 3000);

                // 記録履歴にクレンジング理由を保存
                if (sender.tab?.url && totalRemoved > 0) {
                    // クレンジング理由を決定
                    const hardEnabled = hardStripRemoved > 0;
                    const keywordEnabled = keywordStripRemoved > 0;
                    let cleansedReason: 'hard' | 'keyword' | 'both' = 'both';
                    if (hardEnabled && !keywordEnabled) {
                        cleansedReason = 'hard';
                    } else if (!hardEnabled && keywordEnabled) {
                        cleansedReason = 'keyword';
                    }
                    await setUrlCleansedReason(sender.tab.url, cleansedReason);
                }

                sendResponse({ success: true });
                return;
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
                    recordType: 'auto',
                    pageBytes: message.payload?.pageBytes,
                    candidateBytes: message.payload?.candidateBytes,
                    originalBytes: message.payload?.originalBytes,
                    cleansedBytes: message.payload?.cleansedBytes,
                    aiSummaryOriginalBytes: message.payload?.aiSummaryOriginalBytes,
                    aiSummaryCleansedBytes: message.payload?.aiSummaryCleansedBytes,
                    aiSummaryCleansedElements: message.payload?.aiSummaryCleansedElements,
                    aiSummaryCleansedReason: message.payload?.aiSummaryCleansedReason
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

                // 自動保存成功時: 青色バッジ ◎ を表示（タブを離れるまで継続）
                // スキップされた場合は表示しない
                if (result.success && !result.skipped && sender.tab.id) {
                    const savedTabId = sender.tab.id;
                    autoSavedBadgeTabs.add(savedTabId);
                    chrome.action.setBadgeText({ text: '◎', tabId: savedTabId });
                    chrome.action.setBadgeBackgroundColor({ color: '#3B82F6', tabId: savedTabId });
                }

                // 自動保存モード confirm: ボタン付き通知で保存確認を促す
                if (result.confirmationRequired) {
                    const url = sender.tab.url || '';
                    const title = sender.tab.title || url;
                    const reason = result.reason || 'cache-control';
                    const reasonKey = `privatePageReason_${reason.replace('-', '')}`;
                    const reasonLabel = chrome.i18n.getMessage(reasonKey) || reason;
                    // URLをBase64エンコードして通知IDに埋め込む（URLsafe base64 + HMAC署名）
                    const encodedUrl = await encodeUrlSafeBase64(url);
                    if (encodedUrl) {
                        const notificationId = PRIVACY_CONFIRM_NOTIFICATION_PREFIX + encodedUrl;
                        NotificationHelper.notifyPrivacyConfirm(notificationId, title, reasonLabel);
                    }
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
                } catch (error) {
                    await logError(
                        'Fetch URL Error',
                        {
                            url: message.payload?.url,
                            error: error instanceof Error ? error.message : String(error)
                        },
                        ErrorCode.API_REQUEST_FAILURE,
                        'service-worker'
                    );
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

            // Obsidian のみ接続テスト
            if (message.type === 'TEST_OBSIDIAN') {
                const override = message.payload?.apiKey ? message.payload : undefined;
                const obsidianResult = await obsidian.testConnection(override);
                sendResponse({ success: true, obsidian: obsidianResult });
                return;
            }

            // AI のみ接続テスト
            if (message.type === 'TEST_AI') {
                const aiResult = await aiClient.testConnection();
                sendResponse({ success: true, ai: aiResult });
                return;
            }

            // Get Privacy Cache (for Popup status panel)
            if (message.type === 'GET_PRIVACY_CACHE') {
                const cache = RecordingLogic.cacheState.privacyCache;
                await logDebug(
                    'GET_PRIVACY_CACHE requested',
                    { cacheSize: cache?.size || 0 },
                    'service-worker'
                );
                if (cache) {
                    // Map を配列に変換して送信
                    const cacheArray = Array.from(cache.entries());
                    await logDebug(
                        'Sending cache entries to popup',
                        { count: cacheArray.length },
                        'service-worker'
                    );
                    sendResponse({ success: true, cache: cacheArray });
                } else {
                    await logDebug(
                        'No cache available, sending empty array',
                        undefined,
                        'service-worker'
                    );
                    sendResponse({ success: true, cache: [] });
                }
                return;
            }

            // Manual Record Processing & Preview
            if (message.type === 'MANUAL_RECORD' || message.type === 'PREVIEW_RECORD') {
                let content = message.payload.content;
                const skipAi = message.type === 'MANUAL_RECORD' ? message.payload.skipAi : false;

                // URLバリデーション - http/httpsのみ許可
                if (!isSecureUrl(message.payload.url)) {
                    await logWarn(
                        'Blocked MANUAL_RECORD with insecure URL',
                        { url: message.payload.url, type: message.type },
                        undefined,
                        'service-worker'
                    );
                    sendResponse({ success: false, error: 'Insecure URL protocol not allowed' });
                    return;
                }

                // skipAi操作のレート制限
                if (skipAi) {
                    const now = Date.now();
                    const senderKey = sender.tab?.id?.toString() || 'unknown';
                    const limiterState = skipAiRateLimiter.get(senderKey);

                    if (limiterState) {
                        // ウィンドウが期限切れならリセット
                        if (now > limiterState.resetTime) {
                            skipAiRateLimiter.set(senderKey, { count: 1, resetTime: now + SKIP_AI_RATE_LIMIT_WINDOW_MS });
                        } else if (limiterState.count >= SKIP_AI_RATE_LIMIT_MAX) {
                            await logWarn(
                                'Rate limit exceeded for skipAi operation',
                                { sender: senderKey, limit: SKIP_AI_RATE_LIMIT_MAX },
                                undefined,
                                'service-worker'
                            );
                            sendResponse({ success: false, error: 'Rate limit exceeded. Please try again later.' });
                            return;
                        } else {
                            limiterState.count++;
                        }
                    } else {
                        skipAiRateLimiter.set(senderKey, { count: 1, resetTime: now + SKIP_AI_RATE_LIMIT_WINDOW_MS });
                    }
                }

                // 【プライバシー（v4.2.1）】コンテンツフェッチ設定のチェック
                const settings = await getSettings();
                const autoContentFetchEnabled = settings[StorageKeys.AUTO_CONTENT_FETCH_ENABLED] as boolean;
                const sanitizedUrl = sanitizeUrlForLogging(message.payload.url);

                // contentが空でskipAiでない場合、タブからページ本文を取得（明示的同意が必要）
                if (!content && !skipAi) {
                    if (!autoContentFetchEnabled && !message.payload.force) {
                        // 通常フローではコンテンツフェッチ無効を通知して終了
                        await logDebug(
                            'Content fetch disabled (AUTO_CONTENT_FETCH_ENABLED=false)',
                            { url: sanitizedUrl },
                            'service-worker'
                        );
                        sendResponse({
                            success: true,
                            warning: 'Content fetch is disabled. Enable it in settings or provide content directly.'
                        });
                        return;
                    }

                    let createdTabId: number | undefined;
                    try {
                        // 既存タブを探す
                        const allTabs = await chrome.tabs.query({});
                        const existingTab = allTabs.find(t => t.url === message.payload.url && t.id !== undefined);
                        let targetTabId: number | undefined = existingTab?.id;

                        // タブが開いていなければバックグラウンドで開く
                        if (!targetTabId) {
                            const newTab = await chrome.tabs.create({ url: message.payload.url, active: false });
                            createdTabId = newTab.id;
                            targetTabId = newTab.id;

                            // ページが読み込まれるまで待機（最大15秒）
                            await new Promise<void>((resolve) => {
                                const timeout = setTimeout(resolve, 15000);
                                const listener = (tabId: number, info: { status?: string }): void => {
                                    if (tabId === targetTabId && info.status === 'complete') {
                                        clearTimeout(timeout);
                                        chrome.tabs.onUpdated.removeListener(listener);
                                        resolve();
                                    }
                                };
                                chrome.tabs.onUpdated.addListener(listener);
                            });
                        }

                        // scripting.executeScriptでページ本文を取得（Content Script不要）
                        if (targetTabId) {
                            const results = await chrome.scripting.executeScript({
                                target: { tabId: targetTabId },
                                func: () => document.body?.innerText || ''
                            });
                            content = results?.[0]?.result?.trim().substring(0, 10000) || '';
                        }
                    } catch (err: any) {
                        await logWarn('Failed to get page content from tab', { url: sanitizedUrl, error: err.message }, undefined, 'service-worker');
                    } finally {
                        // 新規作成したタブを閉じる
                        if (createdTabId !== undefined) {
                            chrome.tabs.remove(createdTabId).catch(() => {});
                        }
                    }
                }

                const result = await recordingLogic.record({
                    title: message.payload.title,
                    url: message.payload.url,
                    content,
                    force: message.payload.force,
                    skipDuplicateCheck: true,
                    previewOnly: message.type === 'PREVIEW_RECORD',
                    recordType: 'manual',
                    skipAi
                });

                // コンテンツを記録履歴に保存（成功時のみ）
                if (result.success) {
                    await setUrlContent(message.payload.url, content);
                }

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

                // コンテンツを記録履歴に保存（成功時のみ）
                if (result.success && message.payload.content) {
                    await setUrlContent(message.payload.url, message.payload.content);
                }

                sendResponse(result);
                return;
            }

            // Activity Update (Popupからのアクティビティ通知)
            if (message.type === 'ACTIVITY_UPDATE') {
                await updateActivity();
                sendResponse({ success: true });
                return;
            }

            // Session Lock Request (from sessionAlarmsManager.ts)
            if (message.type === 'SESSION_LOCK_REQUEST') {
                lockSession();
                sendResponse({ success: true });
                return;
            }

            sendResponse(null);
        } catch (error) {
            logError(
                'Service Worker Error',
                { error: error instanceof Error ? error.message : String(error) },
                ErrorCode.INTERNAL_ERROR,
                'service-worker'
            );
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
    autoSavedBadgeTabs.delete(tabId);
    // skipAiRateLimiterからも削除（メモリリーク防止）
    skipAiRateLimiter.delete(tabId.toString());
});

// Handle Tab Activation - Update badge to reflect privacy status of new active tab
chrome.tabs.onActivated.addListener(async (activeInfo) => {
    try {
        const tab = await chrome.tabs.get(activeInfo.tabId);
        // 自動保存バッジ表示中のタブは ◎ を維持
        if (autoSavedBadgeTabs.has(activeInfo.tabId)) {
            chrome.action.setBadgeText({ text: '◎', tabId: activeInfo.tabId });
            chrome.action.setBadgeBackgroundColor({ color: '#3B82F6', tabId: activeInfo.tabId });
            return;
        }
        if (!tab.url) {
            chrome.action.setBadgeText({ text: '' });
            return;
        }
        const normalizedUrl = HeaderDetector.normalizeUrl(tab.url);
        const privacyInfo = RecordingLogic.cacheState.privacyCache?.get(normalizedUrl);
        if (privacyInfo?.isPrivate) {
            chrome.action.setBadgeText({ text: '!' });
            chrome.action.setBadgeBackgroundColor({ color: '#F97316' });
        } else {
            chrome.action.setBadgeText({ text: '' });
        }
    } catch (error) {
        await logError('Failed to update badge on tab activation', {
            tabId: activeInfo.tabId,
            error: error instanceof Error ? error.message : String(error)
        }, ErrorCode.BADGE_UPDATE_FAILED, 'service-worker.ts');
        chrome.action.setBadgeText({ text: '' });
    }
});

// Handle Tab Navigation - Update badge after page load completes
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete' || !tab.url) return;
    // ページ遷移完了時は自動保存バッジをクリア（新しいページのため）
    autoSavedBadgeTabs.delete(tabId);
    const normalizedUrl = HeaderDetector.normalizeUrl(tab.url);
    const privacyInfo = RecordingLogic.cacheState.privacyCache?.get(normalizedUrl);
    if (privacyInfo?.isPrivate) {
        chrome.action.setBadgeText({ text: '!', tabId });
        chrome.action.setBadgeBackgroundColor({ color: '#F97316', tabId });
    } else {
        chrome.action.setBadgeText({ text: '', tabId });
    }
});

// Extension Startup / Installation initialization
const initializeExtension = async () => {
    try {
        const settings = await getSettings();
        await saveSettingsWithAllowedUrls(settings);
        // 【Task #19 最適化】ドメインフィルタキャッシュを更新
        await updateDomainFilterCache(settings);

        // セッションタイムアウト監視開始
        await initializeSessionAlarms();

        logInfo(
            'Extension initialized: Allowed URLs list rebuilt, domain filter cache updated, and session timeout monitoring started.',
            undefined,
            'service-worker'
        );
    } catch (error) {
        logError(
            'Failed to initialize extension',
            { error: error instanceof Error ? error.message : String(error) },
            ErrorCode.INTERNAL_ERROR,
            'service-worker'
        );
    }
};

chrome.runtime.onInstalled.addListener(initializeExtension);
chrome.runtime.onStartup.addListener(initializeExtension);

// ============================================================================
// Privacy Confirmation Notification Handlers
// ============================================================================

// URLスキーマの許可リスト
const ALLOWED_URL_SCHEMES = ['http:', 'https:', 'chrome-extension:', 'moz-extension:', 'edge:'];
const BLOCKED_URL_SCHEMES = ['javascript:', 'data:', 'file:', 'vbscript:', 'about:'];

// 最大URL長（Base64エンコード後の通知ID上限を考慮）
const MAX_URL_LENGTH = 2000;
const MAX_ENCODED_LENGTH = 5000;

/**
 * URLのバリデーションを行う
 * @param {string} url - 検証するURL
 * @returns {boolean} URLが有効で安全な場合はtrue
 */
function isValidUrl(url: string): boolean {
    if (typeof url !== 'string' || url.length === 0) {
        return false;
    }

    if (url.length > MAX_URL_LENGTH) {
        return false;
    }

    try {
        const parsedUrl = new URL(url);

        // ブロックされたスキーマを拒否
        for (const blockedScheme of BLOCKED_URL_SCHEMES) {
            if (parsedUrl.protocol === blockedScheme && url.startsWith(blockedScheme)) {
                return false;
            }
        }

        // 許可されたスキーマのみ受け付ける
        // chrome-extension: は内部使用のみ
        for (const allowedScheme of ALLOWED_URL_SCHEMES) {
            if (parsedUrl.protocol === allowedScheme) {
                return true;
            }
        }

        return false;
    } catch {
        return false;
    }
}

/**
 * 署名を生成する（crypto.tsのgenerateHmacSignatureをラップ）
 * @param {string} data - 署名するデータ
 * @param {CryptoKey} key - HMAC署名キー
 * @returns {Promise<string>} URL-safe base64エンコードされた署名
 */
async function generateSignature(data: string, key: CryptoKey): Promise<string> {
    return generateHmacSignature(data, key);
}

/**
 * 署名を検証する（crypto.tsのverifyHmacSignatureをラップ）
 * @param {string} data - 元データ
 * @param {string} signature - URL-safe base64エンコードされた署名
 * @param {CryptoKey} key - HMAC署名キー
 * @returns {Promise<boolean>} 署名が有効な場合はtrue
 */
async function verifySignature(data: string, signature: string, key: CryptoKey): Promise<boolean> {
    return verifyHmacSignature(data, signature, key);
}

/**
 * URLをURL-safe base64でエンコードし、HMAC署名を付与する（P0: 通知ID偽造脆弱性対策）
 * @param {string} url - エンコードするURL
 * @param {number} [maxLength] - 最大エンコード長（デフォルト: 256）
 * @returns {Promise<string>} URL-safe base64エンコードされたURLと署名
 *
 * @example
 * const notificationId = await encodeUrlSafeBase64('https://example.com/path');
 */
async function encodeUrlSafeBase64(url: string, maxLength: number = 256): Promise<string> {
    try {
        // 入力バリデーション
        if (!isValidUrl(url)) {
            await logWarn(
                'encodeUrlSafeBase64: Invalid URL',
                { urlLength: url.length },
                ErrorCode.INVALID_INPUT,
                'service-worker'
            );
            return '';
        }

        // プレフィックス長を考慮してURL長を制限
        // 完全なHMAC-SHA256署名は32バイト → URL-safe base64で43文字
        const prefixLength = PRIVACY_CONFIRM_NOTIFICATION_PREFIX.length;
        const signatureLength = 43; // 完全な署名長（URL-safe base64）
        const maxUrlLength = (maxLength - prefixLength - signatureLength) * 0.75; // Base64オーバーヘッドを考慮
        if (url.length > maxUrlLength) {
            await logWarn(
                'encodeUrlSafeBase64: URL too long',
                { urlLength: url.length, maxLength: maxUrlLength },
                ErrorCode.INVALID_INPUT,
                'service-worker'
            );
            return '';
        }

        const encoder = new TextEncoder();
        const data = encoder.encode(url);

        // ループベースでスタックオーバーフロー回避（P1: `String.fromCharCode(...data)` の改善）
        const binaryString = Array.from(data, b => String.fromCharCode(b)).join('');

        const urlB64 = btoa(binaryString)
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=/g, '');

        // HMAC署名を付与（P0: 通知ID偽造脆弱性対策）
        const key = await getNotificationHmacKey();
        const signature = await generateSignature(url, key);

        return `${urlB64}.${signature}`;
    } catch (error) {
        await logError(
            'encodeUrlSafeBase64: Failed to encode URL',
            { error: error instanceof Error ? error.message : String(error) },
            ErrorCode.CRYPTO_HMAC_FAILURE,
            'service-worker'
        );
        return '';
    }
}

/**
 * 通知IDからURLをデコードし、署名を検証する（P0: 通知ID偽造脆弱性対策）
 * CRITICAL: レガシーフォーマット（署名なし）は廃止済み - 有効な署名必須
 * @param {string} notificationId - デコードする通知ID
 * @returns {Promise<string | null>} デコードされたURL、またはnull（無効な場合）
 *
 * @example
 * const url = await decodeUrlFromNotificationId('privacy-confirm-abc123.def456');
 */
async function decodeUrlFromNotificationId(notificationId: string): Promise<string | null> {
    // プレフィックスチェック
    if (!notificationId.startsWith(PRIVACY_CONFIRM_NOTIFICATION_PREFIX)) {
        return null;
    }

    const encodedPart = notificationId.slice(PRIVACY_CONFIRM_NOTIFICATION_PREFIX.length);

    // 入力長チェック（P1: 入力バリデーション）
    if (encodedPart.length > MAX_ENCODED_LENGTH) {
        await logWarn(
            'decodeUrlFromNotificationId: Notification ID too long',
            { length: encodedPart.length, maxLength: MAX_ENCODED_LENGTH },
            ErrorCode.INVALID_INPUT,
            'service-worker'
        );
        return null;
    }

    try {
        // 署名とURLの部分を分離
        const parts = encodedPart.split('.');
        if (parts.length !== 2) {
            await logWarn(
                'decodeUrlFromNotificationId: Invalid format (must be URL.signature)',
                { format: 'missing_signature' },
                ErrorCode.CRYPTO_HMAC_FAILURE,
                'service-worker'
            );
            return null;
        }

        const [urlB64, signature] = parts;

        // デコードしてURLを取得
        const b64 = urlB64.replace(/-/g, '+').replace(/_/g, '/');
        const padded = b64.padEnd(b64.length + (4 - b64.length % 4) % 4, '=');
        const binaryString = atob(padded);
        const bytes = Uint8Array.from(binaryString, c => c.charCodeAt(0));
        const decoder = new TextDecoder();
        const url = decoder.decode(bytes);

        // URLバリデーション（署名検証の前）
        if (!isValidUrl(url)) {
            await logWarn(
                'decodeUrlFromNotificationId: Invalid URL after decoding',
                { urlHash: url.substring(0, 10) + '...' },
                ErrorCode.INVALID_INPUT,
                'service-worker'
            );
            return null;
        }

        // 署名検証（P0: 通知ID偽造脆弱性対策）- 必須
        const key = await getNotificationHmacKey();
        const isValid = await verifySignature(url, signature, key);

        if (isValid) {
            return url;
        } else {
            await logWarn(
                'decodeUrlFromNotificationId: Invalid signature - forged notification rejected',
                { urlHash: url.substring(0, 10) + '...' },
                ErrorCode.CRYPTO_HMAC_FAILURE,
                'service-worker'
            );
            return null;
        }
    } catch (error) {
        await logError(
            'decodeUrlFromNotificationId: Failed to decode notification ID',
            { error: error instanceof Error ? error.message : String(error) },
            ErrorCode.CRYPTO_HMAC_FAILURE,
            'service-worker'
        );
        return null;
    }
}

// Button 0: 保存する / Button 1: スキップ
chrome.notifications.onButtonClicked.addListener(async (notificationId, buttonIndex) => {
    try {
        if (!notificationId.startsWith(PRIVACY_CONFIRM_NOTIFICATION_PREFIX)) {
            return;
        }

        chrome.notifications.clear(notificationId).catch(e => {
            logWarn(
                'Failed to clear notification',
                { notificationId, error: e instanceof Error ? e.message : String(e) },
                ErrorCode.UNKNOWN_ERROR,
                'service-worker'
            );
        });

        const url = await decodeUrlFromNotificationId(notificationId);
        if (!url) {
            // デコード失敗時はsilent return（既存の挙動）
            return;
        }

        // URLのバリデーション（P1: 入力バリデーション）
        if (!isValidUrl(url)) {
            await logWarn(
                'Invalid URL decoded from notification ID',
                { urlHash: url.substring(0, 10) + '...' },
                ErrorCode.INVALID_INPUT,
                'service-worker'
            );
            return;
        }

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
    } catch (error) {
        await logError(
            'Notification button click handler failed',
            {
                notificationId: notificationId.substring(0, 20) + '...',
                buttonIndex,
                error: error instanceof Error ? error.message : String(error)
            },
            ErrorCode.INTERNAL_ERROR,
            'service-worker'
        );
    }
});

// 通知本体クリック時も閉じる
chrome.notifications.onClicked.addListener((notificationId) => {
    if (notificationId.startsWith(PRIVACY_CONFIRM_NOTIFICATION_PREFIX)) {
        chrome.notifications.clear(notificationId);
    }
});

/**
 * 既にキャッシュが初期化済みかチェック
 */
let isCacheInitialized = false;

/**
 * Service Worker アクティベート時のキャッシュ再水和
 * Chrome が Service Worker を再起動した場合、キャッシュを再初期化
 */
chrome.runtime.onStartup.addListener(async () => {
    logInfo('Service Worker startup - rehydrating caches', {}, 'service-worker');

    // 既にキャッシュが初期化済みの場合はスキップ（onInstalledで実行済み）
    if (isCacheInitialized) {
        logDebug('Cache already initialized, skipping startup rehydration', {}, 'service-worker');
        return;
    }

    try {
        // 関連キャッシュを無効化して再読み込みを強制
        RecordingLogic.invalidateSettingsCache();
        const settings = await getSettings();
        await updateDomainFilterCache(settings);
        isCacheInitialized = true;

        logInfo('Service Worker startup - cache rehydration complete', {}, 'service-worker');
    } catch (error) {
        await logError(
            'Service Worker startup - cache rehydration failed',
            { error: error instanceof Error ? error.message : String(error) },
            ErrorCode.STORAGE_READ_FAILURE,
            'service-worker'
        );
    }

    // 期限切れの権限データをクリーンアップ（起動時のみ実行）
    try {
        await cleanupOldDeniedEntries(90);
        await cleanupDismissedEntries(7);
        logDebug('Permission cleanup completed on startup', {}, 'service-worker');
    } catch (error) {
        logWarn(
            'Permission cleanup failed on startup',
            { error: error instanceof Error ? error.message : String(error) },
            undefined,
            'service-worker'
        );
    }
});

/**
 * Service Worker インストール/更新時の処理
 */
chrome.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === 'install') {
        logInfo('Service Worker installed', {}, 'service-worker');
    } else if (details.reason === 'update') {
        logInfo(`Service Worker updated from ${details.previousVersion}`, {}, 'service-worker');

        // 更新時はキャッシュをクリアして再初期化
        RecordingLogic.invalidateSettingsCache();
        const settings = await getSettings();
        await updateDomainFilterCache(settings);
    }
});