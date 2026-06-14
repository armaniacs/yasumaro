import { ObsidianClient } from './obsidianClient.js';
import { AIClient } from './aiClient.js';
import { RecordingLogic } from './recordingLogic.js';
import { TabCache } from './tabCache.js';
import { HeaderDetector } from './headerDetector.js';
import { SessionStore } from './sessionStore.js';
import { validateUrlForFilterImport, fetchWithTimeout } from '../utils/fetch.js';
import { BADGE_COLORS } from '../constants/appConstants.js';
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
import { SqliteClient } from './sqliteClient.js';
import { MigrationService } from './migrationService.js';
import { isSecureUrl, sanitizeUrlForLogging } from '../utils/urlUtils.js';
import { createErrorResponse, convertKnownErrorMessage } from '../utils/errorMessages.js';
import { errorMessage } from '../utils/errorUtils.js';
import { NotificationHelper } from './notificationHelper.js';
import { logInfo, logDebug, logWarn, logError, ErrorCode } from '../utils/logger.js';
import {
    cleanupOldDeniedEntries,
    cleanupDismissedEntries
} from '../utils/permissionManager.js';

import { updateActivity, initialize as initializeSessionAlarms } from './sessionAlarmsManager.js';
import { encodeUrlSafeBase64 } from './handlers/urlNotificationHandlers.js';
import { handleDashboardSqlite } from './handlers/dashboardSqliteHandlers.js';
import { createNotificationHandlers } from './handlers/notificationHandlers.js';
import { hasPrivacyConsent, migrateLegacyPrivacyConsent } from '../popup/privacyConsent.js';
import { RateLimiter } from './rateLimiter.js';
import { ManualContentFetcher } from './manualContentFetcher.js';
import { setUrlContent, setUrlCleansedReason } from '../utils/storageUrls.js';
import { stripPiiFromMaskedItems } from '../utils/piiStripper.js';
import { extractMainContent } from '../utils/contentExtractor.js';
import {
    VALID_MESSAGE_TYPES,
    CONTENT_SCRIPT_ONLY_TYPES,
    NO_PAYLOAD_TYPES
} from './messageTypes.js';
import type {
    ExtensionMessage,
    ValidVisitMessage,
    FetchUrlMessage,
    ManualRecordMessage,
    PreviewRecordMessage,
    SaveRecordMessage,
    ContentCleansingExecutedMessage,
    CheckDomainMessage,
    TestConnectionsMessage,
    TestObsidianMessage,
    TestAiMessage,
    GetPrivacyCacheMessage,
    ActivityUpdateMessage,
    SessionLockRequestMessage,
    PingMessage
} from './messageTypes.js';

// ============================================================================
// Service Worker Initialization
// ============================================================================

/**
 * Initialize Service Worker with all Chrome event listeners.
 * Extracted for testability - call this function instead of relying on
 * module-level side effects.
 */
export function init(): void {
    // Migration (already async, run at startup)
    runMigration();
    // SQLite data migration from chrome.storage.local
    migrationService.run().catch((err) => {
        logError('Yasumaro migration failed', { error: String(err) }, ErrorCode.STORAGE_MIGRATION_FAILURE, 'service-worker');
    });
    // Setup periodic snapshot alarm if enabled
    setupSnapshotAlarm(true).catch(err => {
        logWarn('Failed to setup snapshot alarm', { error: String(err) });
    });

    // Message listener
    chrome.runtime.onMessage.addListener(createMessageHandler());

    // Tab event listeners
    chrome.tabs.onRemoved.addListener(handleTabRemoved);
    chrome.tabs.onActivated.addListener(handleTabActivated);
    chrome.tabs.onUpdated.addListener(handleTabUpdated);

    // Extension lifecycle listeners
    chrome.runtime.onInstalled.addListener(handleInstalled);
    chrome.runtime.onStartup.addListener(handleStartup);

    // Notification listeners
    chrome.notifications.onButtonClicked.addListener(handleNotificationButtonClicked);
    chrome.notifications.onClicked.addListener(handleNotificationClicked);

    // Session alarm initialization for master password timeout
    initializeSessionAlarms();

    chrome.alarms.create('yasumaro-daily-purge', { periodInMinutes: 1440 });
}

/**
 * Run settings migration at startup.
 */
async function runMigration(): Promise<void> {
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
            { error: errorMessage(e) },
            ErrorCode.STORAGE_MIGRATION_FAILURE,
            'service-worker'
        );
    }
}

// Session store for cross-SW-restart persistence
const sessionStore = new SessionStore();

const CONFIRM_TOKEN_KEY = 'dashboardSqliteConfirmToken';
let CONFIRM_TOKEN: string | null = null;

export async function ensureConfirmToken(): Promise<string> {
    if (CONFIRM_TOKEN) return CONFIRM_TOKEN;

    try {
        const stored = await chrome.storage.session.get(CONFIRM_TOKEN_KEY) as Record<string, string | undefined>;
        if (stored[CONFIRM_TOKEN_KEY]) {
            CONFIRM_TOKEN = stored[CONFIRM_TOKEN_KEY] as string;
            return CONFIRM_TOKEN;
        }
    } catch {
        // Best-effort persistence; in-memory token still protects this SW lifetime.
    }

    const token = typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : Array.from(crypto.getRandomValues(new Uint8Array(16)))
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('');

    try {
        await chrome.storage.session.set({ [CONFIRM_TOKEN_KEY]: token });
    } catch {
        // Best-effort persistence; in-memory token still protects this SW lifetime.
    }

    CONFIRM_TOKEN = token;
    return token;
}

// Initialize clients
const obsidian = new ObsidianClient();
const aiClient = new AIClient();
const sqliteClient = new SqliteClient();
const recordingLogic = new RecordingLogic(obsidian, aiClient, undefined, sqliteClient);
const migrationService = new MigrationService(sqliteClient);

// Import RecordingPipeline
import { RecordingPipeline } from './pipeline/RecordingPipeline.js';

// TabCache for storing tab data
const tabCache = new TabCache(sessionStore);

// 自動保存成功バッジを表示中のタブIDセット
const autoSavedBadgeTabs = new Set<number>();

// Initialize HeaderDetector (must be initialized on Service Worker startup)
HeaderDetector.initialize();

const INVALID_SENDER_ERROR = { success: false, error: 'Invalid sender' };
const INVALID_MESSAGE_ERROR = { success: false, error: 'Invalid message' };

// Rate limiter for skipAi operations
const rateLimiter = new RateLimiter(sessionStore);
rateLimiter.initialize();

// Track whether cache has been initialized (for startup rehydration)
let isCacheInitialized = false;

// Snapshot alarm: cache last settings hash to avoid unnecessary clear/create on every ping
let cachedSnapshotSettingsHash: string | null = null;

const manualContentFetcher = new ManualContentFetcher();

export function resetManualRecordCache(): void {
    manualContentFetcher.clear();
}

// ============================================================================
// Extracted Message Handlers (for testability)
// ============================================================================

async function isRecordingAllowed(): Promise<boolean> {
    return hasPrivacyConsent();
}

/**
 * Handle VALID_VISIT message from Content Script.
 * Processes automatic visit recording, updates tab cache, and manages badges.
 */
export async function handleValidVisit(
    message: ValidVisitMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
): Promise<void> {
    if (!sender.tab) {
        sendResponse(INVALID_SENDER_ERROR);
        return;
    }

    if (!(await isRecordingAllowed())) {
        sendResponse({ success: false, reason: 'privacy_consent_required' });
        return;
    }

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
        aiSummaryCleansedReason: message.payload?.aiSummaryCleansedReason,
        aiSummaryCleansedReasons: message.payload?.aiSummaryCleansedReasons
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
        chrome.action.setBadgeBackgroundColor({ color: BADGE_COLORS.BLUE as string, tabId: savedTabId });
    }

    // 自動保存モード confirm: ボタン付き通知で保存確認を促す
    if (result.confirmationRequired) {
        const url = sender.tab.url || '';
        const title = sender.tab.title || url;
        const reason = result.reason || 'cache-control';
        const reasonKey = `privatePageReason_${reason.replace('-', '')}`;
        const reasonLabel = chrome.i18n.getMessage(reasonKey) || reason;
        // URLをBase64エンコードして通知IDに埋め込む（URLsafe base64 + HMAC署名）
        try {
            const notificationId = await encodeUrlSafeBase64(url);
            NotificationHelper.notifyPrivacyConfirm(notificationId, title, reasonLabel);
        } catch (error) {
            await logWarn(
                'Failed to encode URL for notification',
                { error: errorMessage(error) },
                ErrorCode.CRYPTO_HMAC_FAILURE,
                'service-worker'
            );
        }
    }

    // PII保護: maskedItemsからoriginalフィールドを削除してからレスポンスを返す
    if (result.maskedItems && Array.isArray(result.maskedItems)) {
        result.maskedItems = stripPiiFromMaskedItems(result.maskedItems);
    }

    sendResponse(result);
}

/**
 * Handle FETCH_URL message from Popup.
 * Fetches URL content with CORS bypass for filter import.
 */
export async function handleFetchUrl(
    message: FetchUrlMessage,
    sendResponse: (response?: unknown) => void
): Promise<void> {
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
                error: errorMessage(error)
            },
            ErrorCode.API_REQUEST_FAILURE,
            'service-worker'
        );
        // P2: 技術情報漏洩対策 - ユーザー向けメッセージに変換
        sendResponse(createErrorResponse(error, { url: message.payload?.url }));
    }
}

/**
 * Handle MANUAL_RECORD or PREVIEW_RECORD message from Popup.
 * Processes manual recording with optional AI summarization.
 */
export async function handleManualRecord(
    message: ManualRecordMessage | PreviewRecordMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
): Promise<void> {
    if (!(await isRecordingAllowed())) {
        sendResponse({ success: false, reason: 'privacy_consent_required' });
        return;
    }

    let content = message.payload.content;
    const skipAi = message.type === 'MANUAL_RECORD' ? message.payload.skipAi : false;
    const settings = await getSettings();

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
        const rateLimitResult = await rateLimiter.check(sender, settings);
        if (!rateLimitResult.allowed) {
            sendResponse({ success: false, error: rateLimitResult.error });
            return;
        }
    }

    // 【プライバシー（v4.2.1）】コンテンツフェッチ設定のチェック
    const autoContentFetchEnabled = settings[StorageKeys.AUTO_CONTENT_FETCH_ENABLED] as boolean;
    const sanitizedUrl = sanitizeUrlForLogging(message.payload.url);

    // contentが空でskipAiでない場合、タブからページ本文を取得（明示的同意が必要）
    // Google Sitesなどの特殊的なサイトではコンテンツが取得できない場合がある
    const isGoogleSites = message.payload.url.includes('sites.google.com');
    if (!content && !skipAi) {
        // Google SitesではCSPの問題でコンテンツが取得できない場合がある
        // force=true の場合はスキップして続行
        if (isGoogleSites && message.payload.force) {
            await logDebug('Google Sites detected with force flag, skipping content fetch', { url: sanitizedUrl }, 'service-worker');
            // 空のコンテンツで続行
        } else {
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

            content = await manualContentFetcher.fetchContent(message.payload.url);
        }
    }

    // Use RecordingPipeline for manual recording
    const pipeline = new RecordingPipeline(
        recordingLogic.getPrivacyInfoWithCache.bind(recordingLogic),
        obsidian,
        aiClient,
        sqliteClient
    );

    const result = await pipeline.execute({
        title: message.payload.title,
        url: message.payload.url,
        content,
        force: message.payload.force,
        skipDuplicateCheck: true,
        previewOnly: message.type === 'PREVIEW_RECORD',
        recordType: 'manual',
        skipAi,
        pageBytes: message.payload.pageBytes,
        candidateBytes: message.payload.candidateBytes,
        originalBytes: message.payload.originalBytes,
        cleansedBytes: message.payload.cleansedBytes,
        aiSummaryOriginalBytes: message.payload.aiSummaryOriginalBytes,
        aiSummaryCleansedBytes: message.payload.aiSummaryCleansedBytes,
        aiSummaryCleansedElements: message.payload.aiSummaryCleansedElements,
        aiSummaryCleansedReason: message.payload.aiSummaryCleansedReason,
        aiSummaryCleansedReasons: message.payload.aiSummaryCleansedReasons
    }, settings);

    // コンテンツを記録履歴に保存（成功時のみ）
    if (result.success) {
        await setUrlContent(message.payload.url, content);
    }

    // PII保護: maskedItemsからoriginalフィールドを削除してからレスポンスを返す
    if (result.maskedItems && Array.isArray(result.maskedItems)) {
        result.maskedItems = stripPiiFromMaskedItems(result.maskedItems);
    }

    sendResponse(result);
}

/**
 * Handle SAVE_RECORD message from Popup.
 * Saves a confirmed record after preview.
 */
export async function handleSaveRecord(
    message: SaveRecordMessage,
    sendResponse: (response?: unknown) => void
): Promise<void> {
    if (!(await isRecordingAllowed())) {
        sendResponse({ success: false, reason: 'privacy_consent_required' });
        return;
    }

    const settings = await getSettings();
    // Use RecordingPipeline for saving confirmed record
    const pipeline = new RecordingPipeline(
        recordingLogic.getPrivacyInfoWithCache.bind(recordingLogic),
        obsidian,
        aiClient,
        sqliteClient
    );

    const result = await pipeline.execute({
        title: message.payload.title,
        url: message.payload.url,
        content: message.payload.content,
        skipDuplicateCheck: true,
        alreadyProcessed: true,
        force: message.payload.force,
        recordType: 'manual',
        maskedCount: message.payload.maskedCount,
        pageBytes: message.payload.pageBytes,
        candidateBytes: message.payload.candidateBytes,
        originalBytes: message.payload.originalBytes,
        cleansedBytes: message.payload.cleansedBytes,
        aiSummaryOriginalBytes: message.payload.aiSummaryOriginalBytes,
        aiSummaryCleansedBytes: message.payload.aiSummaryCleansedBytes,
        aiSummaryCleansedElements: message.payload.aiSummaryCleansedElements,
        aiSummaryCleansedReason: message.payload.aiSummaryCleansedReason,
        aiSummaryCleansedReasons: message.payload.aiSummaryCleansedReasons
    }, settings);

    // コンテンツを記録履歴に保存（成功時のみ）
    if (result.success && message.payload.content) {
        await setUrlContent(message.payload.url, message.payload.content);
    }

    // PII保護: maskedItemsからoriginalフィールドを削除してからレスポンスを返す
    if (result.maskedItems && Array.isArray(result.maskedItems)) {
        result.maskedItems = stripPiiFromMaskedItems(result.maskedItems);
    }

    sendResponse(result);
}

/**
 * Handle CONTENT_CLEANSING_EXECUTED message from Content Script.
 * Updates badge to show cleansing count, sets timeout to clear badge,
 * and records cleansing reason in storage.
 */
export async function handleContentCleansingExecuted(
    message: ContentCleansingExecutedMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
): Promise<void> {
    const { hardStripRemoved, keywordStripRemoved, totalRemoved } = message.payload || {};
    const tabId = sender.tab!.id!;

    chrome.action.setBadgeText({ text: `C${totalRemoved || 0}`, tabId });
    chrome.action.setBadgeBackgroundColor({ color: BADGE_COLORS.GREEN as string, tabId });

    setTimeout(() => {
        if (!autoSavedBadgeTabs.has(tabId)) {
            chrome.action.setBadgeText({ text: '', tabId });
        }
    }, 3000);

    if (sender.tab?.url && (totalRemoved ?? 0) > 0) {
        const hardEnabled = (hardStripRemoved ?? 0) > 0;
        const keywordEnabled = (keywordStripRemoved ?? 0) > 0;
        let cleansedReason: 'hard' | 'keyword' | 'both' = 'both';
        if (hardEnabled && !keywordEnabled) {
            cleansedReason = 'hard';
        } else if (!hardEnabled && keywordEnabled) {
            cleansedReason = 'keyword';
        }
        await setUrlCleansedReason(sender.tab.url, cleansedReason);
    }

    sendResponse({ success: true });
}

/**
 * Handle CHECK_DOMAIN message from Content Script.
 * Checks if the sender's URL is in the allowed domain list.
 */
export async function handleCheckDomain(
    message: CheckDomainMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
): Promise<void> {
    const url = sender.tab?.url || '';
    const allowed = url ? await isDomainAllowed(url) : false;
    sendResponse({ success: true, allowed });
}

/**
 * Handle TEST_CONNECTIONS message from Popup.
 * Tests both Obsidian and AI provider connections.
 */
export async function handleTestConnections(
    message: TestConnectionsMessage,
    sendResponse: (response?: unknown) => void
): Promise<void> {
    const obsidianResult = await obsidian.testConnection();
    const aiResult = await aiClient.testConnection();
    sendResponse({ success: true, obsidian: obsidianResult, ai: aiResult });
}

/**
 * Handle TEST_OBSIDIAN message from Popup.
 * Tests Obsidian connection only, optionally with an API key override.
 */
export async function handleTestObsidian(
    message: TestObsidianMessage,
    sendResponse: (response?: unknown) => void
): Promise<void> {
    const override = message.payload?.apiKey ? message.payload : undefined;
    const obsidianResult = await obsidian.testConnection(override);
    sendResponse({ success: true, obsidian: obsidianResult });
}

/**
 * Handle TEST_AI message from Popup.
 * Tests AI provider connection only.
 */
export async function handleTestAi(
    message: TestAiMessage,
    sendResponse: (response?: unknown) => void
): Promise<void> {
    const aiResult = await aiClient.testConnection();
    sendResponse({ success: true, ai: aiResult });
}

/**
 * Handle GET_PRIVACY_CACHE message from Popup.
 * Returns the privacy cache contents for the status panel.
 */
export async function handleGetPrivacyCache(
    message: GetPrivacyCacheMessage,
    sendResponse: (response?: unknown) => void
): Promise<void> {
    const cache = RecordingLogic.cacheState.privacyCache;
    await logDebug('GET_PRIVACY_CACHE requested', { cacheSize: cache?.size || 0 }, 'service-worker');
    if (cache) {
        const cacheArray = Array.from(cache.entries());
        await logDebug('Sending cache entries to popup', { count: cacheArray.length }, 'service-worker');
        sendResponse({ success: true, cache: cacheArray });
    } else {
        await logDebug('No cache available, sending empty array', undefined, 'service-worker');
        sendResponse({ success: true, cache: [] });
    }
}

/**
 * Handle ACTIVITY_UPDATE message from Popup.
 * Updates session activity timestamp.
 */
export async function handleActivityUpdate(
    message: ActivityUpdateMessage,
    sendResponse: (response?: unknown) => void
): Promise<void> {
    await updateActivity();
    sendResponse({ success: true });
}

/**
 * Handle SESSION_LOCK_REQUEST message.
 * Locks the current session.
 */
export async function handleSessionLockRequest(
    message: SessionLockRequestMessage,
    sendResponse: (response?: unknown) => void
): Promise<void> {
    await lockSession();
    sendResponse({ success: true });
}

/**
 * Handle PING message for Service Worker health check.
 */
/**
 * Setup chrome.alarms for periodic snapshots based on current trigger settings.
 * Skips work if settings haven't changed since the last successful run.
 */
async function setupSnapshotAlarm(force = false): Promise<boolean> {
  try {
    const result = await chrome.storage.local.get([StorageKeys.RECORDING_TRIGGERS, StorageKeys.SNAPSHOT_INTERVAL_MINUTES]);
    const raw = result[StorageKeys.RECORDING_TRIGGERS];
    const triggers = raw ? JSON.parse(raw as string) : {};
    const isEnabled = triggers.periodicSnapshot === true;
    const intervalMinutes = (result[StorageKeys.SNAPSHOT_INTERVAL_MINUTES] as number) || 5;

    const settingsHash = `${isEnabled}-${intervalMinutes}`;
    if (!force && settingsHash === cachedSnapshotSettingsHash) {
      return false;
    }
    cachedSnapshotSettingsHash = settingsHash;

    // Clear existing alarm first
    chrome.alarms.clear('yasumaro-snapshot');
    if (isEnabled) {
      chrome.alarms.create('yasumaro-snapshot', { periodInMinutes: intervalMinutes });
      logInfo('Snapshot alarm created', { intervalMinutes }, 'service-worker');
    }
    return true;
  } catch (err) {
    logWarn('setupSnapshotAlarm failed', { error: String(err) });
    return false;
  }
}

// Handle snapshot alarm
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'yasumaro-daily-purge') {
    try {
      const result = await sqliteClient.purgeOldRecords();
      if (result) {
        logInfo('Daily purge completed', { purged: result.purged }, 'service-worker');
      }
    } catch (err) {
      logWarn('Daily purge failed', { error: errorMessage(err) }, undefined, 'service-worker');
    }
    return;
  }

  if (alarm.name !== 'yasumaro-snapshot') return;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url || !tab.id) return;

    // Save active tab to SQLite
    const record = {
      url: tab.url,
      title: tab.title || null,
      created_at: Date.now(),
      domain: tab.url ? extractDomainFromUrl(tab.url) : null,
    };
    const result = await sqliteClient.insert(record);
    if (result) {
      logInfo('Snapshot saved', { url: tab.url, id: result.id }, 'service-worker');
    }
  } catch (err) {
    logWarn('Snapshot alarm failed', { error: String(err) });
  }
});

function extractDomainFromUrl(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

export async function handlePing(
    message: PingMessage,
    sendResponse: (response?: unknown) => void
): Promise<void> {
    // Re-setup snapshot alarm only when trigger settings have changed since the last ping
    await setupSnapshotAlarm(false);
    sendResponse({ success: true });
}


// ============================================================================
// Message Handler Factory (extracted for testability)
// ============================================================================

/**
 * Creates the message handler for chrome.runtime.onMessage.
 * Returns a listener function that can be tested in isolation.
 */
export function createMessageHandler(): (
    rawMessage: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
) => boolean {
    return (rawMessage: unknown, sender, sendResponse) => {
        const process = async () => {
            try {
                // 【パフォーマンス改善】: メッセージハンドラ関数をインライン化
                // TabCache初期化を必要な場合のみ実行

                // Message payload structure validation
                if (!rawMessage || typeof rawMessage !== 'object') {
                    sendResponse(INVALID_MESSAGE_ERROR);
                    return;
                }
                const msg = rawMessage as Record<string, unknown>;
                if (typeof msg.type !== 'string' || !VALID_MESSAGE_TYPES.includes(msg.type as typeof VALID_MESSAGE_TYPES[number])) {
                    sendResponse(INVALID_MESSAGE_ERROR);
                    return;
                }
                // CHECK_DOMAIN、GET_PRIVACY_CACHE、ACTIVITY_UPDATE、SESSION_LOCK_REQUEST は payload 不要
                if (!NO_PAYLOAD_TYPES.includes(msg.type as typeof NO_PAYLOAD_TYPES[number])) {
                    if (msg.payload === undefined || typeof msg.payload !== 'object') {
                        sendResponse(INVALID_MESSAGE_ERROR);
                        return;
                    }
                }

                // Cast to discriminated union for type-safe narrowing in handlers
                const message = rawMessage as ExtensionMessage;

                // Sender validation: Content Script only message types
                if (CONTENT_SCRIPT_ONLY_TYPES.includes(message.type as typeof CONTENT_SCRIPT_ONLY_TYPES[number])) {
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
                    await handleContentCleansingExecuted(message, sender, sendResponse);
                    return;
                }

                // Domain Check (Content Script only: loader が extractor を inject する前に確認)
                if (message.type === 'CHECK_DOMAIN' && sender.tab) {
                    await handleCheckDomain(message, sender, sendResponse);
                    return;
                }

                // Automatic Visit Processing (Content Script only)
                if (message.type === 'VALID_VISIT' && sender.tab) {
                    await handleValidVisit(message, sender, sendResponse);
                    return;
                }

                // Fetch URL Content (CORS Bypass for Popup)
                if (message.type === 'FETCH_URL') {
                    await handleFetchUrl(message, sendResponse);
                    return;
                }

                // Connection Test (Obsidian + AI)
                if (message.type === 'TEST_CONNECTIONS') {
                    await handleTestConnections(message, sendResponse);
                    return;
                }

                // Obsidian のみ接続テスト
                if (message.type === 'TEST_OBSIDIAN') {
                    await handleTestObsidian(message, sendResponse);
                    return;
                }

                // AI のみ接続テスト
                if (message.type === 'TEST_AI') {
                    await handleTestAi(message, sendResponse);
                    return;
                }

                // Get Privacy Cache (for Popup status panel)
                if (message.type === 'GET_PRIVACY_CACHE') {
                    await handleGetPrivacyCache(message, sendResponse);
                    return;
                }

                // Manual Record Processing & Preview
                if (message.type === 'MANUAL_RECORD' || message.type === 'PREVIEW_RECORD') {
                    await handleManualRecord(message, sender, sendResponse);
                    return;
                }

                // Save Confirmed Record (Post-Preview)
                if (message.type === 'SAVE_RECORD') {
                    await handleSaveRecord(message, sendResponse);
                    return;
                }

                // Activity Update (Popupからのアクティビティ通知)
                if (message.type === 'ACTIVITY_UPDATE') {
                    await handleActivityUpdate(message, sendResponse);
                    return;
                }

                // Session Lock Request (from sessionAlarmsManager.ts)
                if (message.type === 'SESSION_LOCK_REQUEST') {
                    await handleSessionLockRequest(message, sendResponse);
                    return;
                }

                // PING - Service Worker health check
                if (message.type === 'PING') {
                    await handlePing(message, sendResponse);
                    return;
                }

                // DASHBOARD_SQLITE - Dashboard SQLite operations (from options page or dashboard)
                if (message.type === 'DASHBOARD_SQLITE') {
                    // Allow from extension pages (options.html, dashboard), block from content scripts
                    if (sender.tab && (!sender.url || !sender.url.startsWith('chrome-extension://'))) {
                        sendResponse({ success: false, error: 'DASHBOARD_SQLITE is not allowed from content scripts' });
                        return;
                    }
                    const result = await handleDashboardSqlite(
                        message.payload || {},
                        sqliteClient,
                        async () => {
                            // Reset progress for manual re-run via diagnostics panel
                            await chrome.storage.local.remove([
                                'yasumaro_migration_status',
                                'yasumaro_migration_progress',
                            ]);
                            const beforeCount = await sqliteClient.getCount();
                            await migrationService.run();
                            const afterCount = await sqliteClient.getCount();
                            return {
                                success: true,
                                count: afterCount ?? 0,
                                read: 0,
                                inserted: Math.max(0, (afterCount ?? 0) - (beforeCount ?? 0)),
                            };
                        },
                        await ensureConfirmToken()
                    );
                    sendResponse(result);
                    return;
                }

                sendResponse(null);
            } catch (error) {
                logError(
                    'Service Worker Error',
                    { error: errorMessage(error) },
                    ErrorCode.INTERNAL_ERROR,
                    'service-worker'
                );
                // P2: 技術情報漏洩対策 - ユーザー向けメッセージに変換
                sendResponse(createErrorResponse(error));
            }
        };

        process();
        return true; // Keep port open for async response
    };
}

// ============================================================================
// Tab Event Handlers
// ============================================================================

export function handleTabRemoved(tabId: number): void {
    tabCache.remove(tabId);
    autoSavedBadgeTabs.delete(tabId);
}

export async function handleTabActivated(activeInfo: { tabId: number }): Promise<void> {
    try {
        const tab = await chrome.tabs.get(activeInfo.tabId);
        // 自動保存バッジ表示中のタブは ◎ を維持
        if (autoSavedBadgeTabs.has(activeInfo.tabId)) {
            chrome.action.setBadgeText({ text: '◎', tabId: activeInfo.tabId });
            chrome.action.setBadgeBackgroundColor({ color: BADGE_COLORS.BLUE as string, tabId: activeInfo.tabId });
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
            chrome.action.setBadgeBackgroundColor({ color: BADGE_COLORS.ORANGE as string });
        } else {
            chrome.action.setBadgeText({ text: '' });
        }
    } catch (error) {
        await logError('Failed to update badge on tab activation', {
            tabId: activeInfo.tabId,
            error: errorMessage(error)
        }, ErrorCode.BADGE_UPDATE_FAILED, 'service-worker.ts');
        chrome.action.setBadgeText({ text: '' });
    }
}

/**
 * Handle tab navigation - update badge after page load completes.
 */
export function handleTabUpdated(tabId: number, changeInfo: { status?: string }, tab: { url?: string }): void {
    if (changeInfo.status !== 'complete' || !tab.url) return;
    // ページ遷移完了時は自動保存バッジをクリア（新しいページのため）
    autoSavedBadgeTabs.delete(tabId);
    const normalizedUrl = HeaderDetector.normalizeUrl(tab.url);
    const privacyInfo = RecordingLogic.cacheState.privacyCache?.get(normalizedUrl);
    if (privacyInfo?.isPrivate) {
        chrome.action.setBadgeText({ text: '!', tabId });
        chrome.action.setBadgeBackgroundColor({ color: BADGE_COLORS.ORANGE as string, tabId });
    } else {
        chrome.action.setBadgeText({ text: '', tabId });
    }
}

// ============================================================================
// Extension Lifecycle Handlers
// ============================================================================

/**
 * Initialize extension on install/update.
 */
export async function handleInstalled(details: { reason?: string; previousVersion?: string }): Promise<void> {
    if (details.reason === 'install') {
        logInfo('Service Worker installed', {}, 'service-worker');
    } else if (details.reason === 'update') {
        logInfo(`Service Worker updated from ${details.previousVersion}`, {}, 'service-worker');

        // 更新時はキャッシュをクリアして再初期化
        RecordingLogic.invalidateSettingsCache();
        const settings = await getSettings();
        await updateDomainFilterCache(settings);

        // Migrate legacy privacy consent for existing users
        // This ensures users who had boolean consent get the new object format
        // with version info, so isRecordingAllowed() works correctly
        try {
            await migrateLegacyPrivacyConsent();
        } catch (error) {
            await logWarn(
                'Legacy privacy consent migration failed',
                { error: errorMessage(error) },
                ErrorCode.UNKNOWN_ERROR,
                'service-worker'
            );
        }
    }
}

/**
 * Service Worker startup - rehydrate caches and cleanup.
 */
export async function handleStartup(): Promise<void> {
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

        // Reload recording cache from session
        await RecordingLogic.loadCacheFromSession();

        // Reload rate limiter from session
        await rateLimiter.reload();

        logInfo('Service Worker startup - cache rehydration complete', {}, 'service-worker');
    } catch (error) {
        await logError(
            'Service Worker startup - cache rehydration failed',
            { error: errorMessage(error) },
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
            { error: errorMessage(error) },
            undefined,
            'service-worker'
        );
    }
}

// ============================================================================
// Notification Handlers
// ============================================================================
export { isValidNotificationUrl } from './handlers/notificationHandlers.js';

const _notificationHandlers = createNotificationHandlers(recordingLogic);
export const handleNotificationButtonClicked = _notificationHandlers.onButtonClicked;
export const handleNotificationClicked = _notificationHandlers.onClicked;

// ============================================================================
// Module-level initialization - register all Chrome event listeners directly
// Guard allows this module to be imported in test environments where
// globalThis.chrome is undefined, without causing errors.
// ============================================================================

if (typeof globalThis.chrome !== 'undefined' && chrome.tabs?.onRemoved) {
    // Message listener
    chrome.runtime.onMessage.addListener(createMessageHandler());

    // Tab event listeners
    chrome.tabs.onRemoved.addListener(handleTabRemoved);
    chrome.tabs.onActivated.addListener(handleTabActivated);
    chrome.tabs.onUpdated.addListener(handleTabUpdated);

    // Extension lifecycle listeners
    chrome.runtime.onInstalled.addListener(handleInstalled);
    chrome.runtime.onStartup.addListener(handleStartup);

    // Notification listeners
    chrome.notifications.onButtonClicked.addListener(handleNotificationButtonClicked);
    chrome.notifications.onClicked.addListener(handleNotificationClicked);
}