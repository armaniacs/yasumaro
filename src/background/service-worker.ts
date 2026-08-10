import { ObsidianClient } from './obsidianClient.js';
import { AIClient } from './aiClient.js';
import { notifyAiTestProgress } from './aiTestProgressNotifier.js';
import { createAIService } from './ai/aiServiceFactory.js';
import { RecordingCache } from './recordingCache.js';
import { RecordingLogic } from './recordingLogic.js';
import { getTabCacheInstance } from './tabCacheFactory.js';
import { HeaderDetector } from './headerDetector.js';
import { SessionStore } from './sessionStore.js';
import { BADGE_COLORS } from '../constants/appConstants.js';
import { createTabEventHandlers } from './handlers/tabEventHandlers.js';
import { createLifecycleHandlers, restoreRecordingCacheOnWake } from './handlers/lifecycleHandlers.js';
import { registerManualRecordContextMenu as _registerManualRecordContextMenu, createContextClickHandler } from './handlers/contextMenuHandlers.js';
import {
    getSettings,
    buildAllowedUrls,
    migrateToSingleSettingsObject,
    lockSession,
    StorageKeys,
    clearSettingsCache
} from '../utils/storage.js';
import { isDomainAllowed } from '../utils/domainUtils.js';
import { migrateLegacyPendingPagesKey } from '../utils/pendingStorage.js';
import { flushPendingRecords } from './pendingSqliteQueue.js';
import { flushPendingWrites, type PendingChromeStorageWrite } from './pendingChromeStorageQueue.js';
import { getSharedSqliteClient } from './sqliteClient.js';
import { withOptimisticLock } from '../utils/optimisticLock.js';
import type { SavedUrlEntry } from '../utils/urlEntry.js';
import { MigrationService } from './migrationService.js';
import { createErrorResponse } from '../utils/errorMessages.js';
import { errorMessage } from '../utils/errorUtils.js';
import { NotificationHelper } from './notificationHelper.js';
import { logInfo, logDebug, logWarn, logError, ErrorCode } from '../utils/logger.js';
import { updateSavedUrlEntry } from '../utils/storage/savedUrlStore.js';

import { updateActivity, initialize as initializeSessionAlarms } from './sessionAlarmsManager.js';
import { handleDailyPurgeAlarm } from './dailyPurgeHandler.js';
import { hasPrivacyConsent } from '../popup/privacyConsent.js';
import { RateLimiter } from './rateLimiter.js';
import { ManualContentFetcher } from './manualContentFetcher.js';
import { formatEntriesToMarkdown } from '../dashboard/obsidianFormatter.js';
import {
    VALID_MESSAGE_TYPES,
    CONTENT_SCRIPT_ONLY_TYPES,
    NO_PAYLOAD_TYPES,
    CURRENT_PROTOCOL_VERSION,
} from './messageTypes.js';
import type { ExtensionMessage } from './messageTypes.js';
import { MessageHandlerRegistry } from './handlers/MessageHandlerRegistry.js';
import {
    createValidVisitHandler,
    createFetchUrlHandler,
    createManualRecordHandler,
    createSaveRecordHandler,
    createContentCleansingExecutedHandler,
    createCheckDomainHandler,
    createTestConnectionsHandler,
    createTestObsidianHandler,
    createTestAiHandler,
    createGetPrivacyCacheHandler,
    createActivityUpdateHandler,
    createSessionLockRequestHandler,
    createPingHandler,
    createRefreshLocalMarkdownSchedulerHandler,
    createConsentStateChangedHandler,
    createGenerateReviewSummaryHandler,
    createLogForwardHandler,
} from './handlers/messageHandlers.js';
import type {
    ManualRecordHandlerDeps,
    SaveRecordHandlerDeps,
} from './handlers/messageHandlers.js';
import { createDashboardSqliteHandler, createSqliteClientDeps } from './handlers/dashboardSqliteHandlers.js';
import { createNotificationHandlers } from './handlers/notificationHandlers.js';
import { sharedOfflineNetworkQueue } from './offlineNetworkQueue.js';
import { createOfflineQueueProcessor } from './offlineQueueProcessor.js';
import { createCacheInitializedFlag, createAutoSavedBadgeTabs } from './swStatePersistence.js';
import type { DashboardSqliteRequest } from './handlers/dashboardSqliteProtocol.js';

// ============================================================================
// Service Worker Initialization
// ============================================================================

/**
 * Initialize Service Worker with all Chrome event listeners.
 * Extracted for testability - call this function instead of relying on
 * module-level side effects.
 */
export function init(): void {
    // Session alarm initialization for master password timeout
    initializeSessionAlarms();

    // Alarms for daily purge and offline network retry
    chrome.alarms.create('yasumaro-daily-purge', { periodInMinutes: 1440 });
    chrome.alarms.create('yasumaro-offline-network-retry', { periodInMinutes: 5 });

    // PBI 2026-07-09-03 / 2026-07-10: schedule local Markdown export per LOCAL_MARKDOWN_EXPORT_TIMING
    (async () => {
      try {
        const { initExportScheduler } = await import('./localMarkdownIdleFlusher.js');
        await initExportScheduler();
      } catch (err) {
        logError('Failed to init export scheduler', { error: String(err) }, ErrorCode.INTERNAL_ERROR, 'service-worker');
      }
    })();

    // Initialize weekly/monthly review summary alarms
    (async () => {
      try {
        const { initializeReviewSummaryAlarms, setupReviewSummaryAlarmListener } = await import('./reviewSummaryAlarm.js');
        await initializeReviewSummaryAlarms();
        setupReviewSummaryAlarmListener();
      } catch (err) {
        logError('Failed to init review summary alarms', { error: String(err) }, ErrorCode.INTERNAL_ERROR, 'service-worker');
      }
    })();
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

    await migrateLegacyPendingPagesKey();
}

// Session store for cross-SW-restart persistence
const sessionStore = new SessionStore();
SessionStore.registerSuspendHandler(sessionStore);

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
const aiService = createAIService({ aiClient });
const sqliteClient = getSharedSqliteClient();
const recordingLogic = new RecordingLogic(obsidian, aiService, undefined, sqliteClient);
const migrationService = new MigrationService(sqliteClient);

const processOfflineNetworkQueue = createOfflineQueueProcessor({
    offlineNetworkQueue: sharedOfflineNetworkQueue,
    recordingLogic,
});

// TabCache for storing tab data (lazy-initialized singleton)
const tabCache = getTabCacheInstance(sessionStore);

// 自動保存成功バッジを表示中のタブIDセット（SW再起動をまたいで永続化）
const autoSavedBadgeTabs = createAutoSavedBadgeTabs();

// Initialize HeaderDetector (must be initialized on Service Worker startup)
HeaderDetector.initialize();

const INVALID_SENDER_ERROR = { success: false, error: 'Invalid sender' };
const INVALID_MESSAGE_ERROR = { success: false, error: 'Invalid message' };

// Rate limiter for skipAi operations
const rateLimiter = new RateLimiter(sessionStore);
rateLimiter.initialize();

// Track whether cache has been initialized (for startup rehydration; persisted
// across Service Worker restarts via chrome.storage.session)
const isCacheInitialized = createCacheInitializedFlag();

const manualContentFetcher = new ManualContentFetcher();

export function resetManualRecordCache(): void {
    manualContentFetcher.clear();
}

// ---------------------------------------------------------------------------
// Deferred startup migrations
//
// These async migrations (SessionStore + SQLite data) previously ran inside
// init() at SW startup.  They caused a race with E2E tests that seed
// chrome.storage.local, and with the logger batch-flush logic, resulting in
// all sanitization_logs being lost.  We now defer them to run once before the
// first message handler invocation.  Alarms (the core fix for PBI-01) remain
// in init() and execute immediately.
// ---------------------------------------------------------------------------
let _startupMigrationsRan = false;
async function runDeferredStartupMigrations(): Promise<void> {
    if (_startupMigrationsRan) return;
    _startupMigrationsRan = true;
    try {
        await runMigration();
        SessionStore.migrateFromLocalStorage().catch((err) => {
            logError('SessionStore migration failed', { error: String(err) }, ErrorCode.STORAGE_MIGRATION_FAILURE, 'service-worker');
        });
        await migrationService.run();
        const needsRecovery = await migrationService.needsOpfsRecoveryMigration();
        if (needsRecovery) {
            logInfo('OPFS recovery migration triggered', {}, 'service-worker');
            const result = await migrationService.migrateOpfsRecovery();
            if (result.success) {
                logInfo('OPFS recovery completed', { migrated: result.migrated }, 'service-worker');
            } else {
                logError('OPFS recovery failed', { error: result.error || 'Unknown error' }, ErrorCode.STORAGE_MIGRATION_FAILURE, 'service-worker');
            }
        }
    } catch (err) {
        logError('Deferred startup migration failed', { error: String(err) }, ErrorCode.STORAGE_MIGRATION_FAILURE, 'service-worker');
    }
}

// ============================================================================
// Message Handler Registry
// ============================================================================

const registry = new MessageHandlerRegistry();

const _manualRecordDeps: ManualRecordHandlerDeps = {
  isRecordingAllowed: () => hasPrivacyConsent(),
  checkRateLimit: (sender: import('./rateLimiter.js').MessageSenderLike | undefined, settings: Record<string, unknown>) => rateLimiter.check(sender, settings),
  fetchContent: (url: string) => manualContentFetcher.fetchContent(url),
  getPrivacyInfoWithCache: (url: string) => RecordingCache.getPrivacyInfoWithCache(url),
  obsidian,
  aiService,
  sqliteClient,
  getSettings: () => getSettings(),
  setUrlContent: async (url: string, content: string) => {
    await updateSavedUrlEntry(url, (entry) => ({ ...entry, content }));
  },
};

const _saveRecordDeps: SaveRecordHandlerDeps = {
  isRecordingAllowed: () => hasPrivacyConsent(),
  getPrivacyInfoWithCache: (url: string) => RecordingCache.getPrivacyInfoWithCache(url),
  obsidian,
  aiService,
  sqliteClient,
  getSettings: () => getSettings(),
  setUrlContent: async (url: string, content: string) => {
    await updateSavedUrlEntry(url, (entry) => ({ ...entry, content }));
  },
};

export const handleValidVisit = createValidVisitHandler({
  isRecordingAllowed: () => hasPrivacyConsent(),
  cacheTab: tabCache.add.bind(tabCache),
  updateCachedTab: tabCache.update.bind(tabCache),
  recordVisit: (data) => recordingLogic.record(data),
  addBadgeTab: (tabId) => { autoSavedBadgeTabs.add(tabId); },
  hasBadgeTab: (tabId) => autoSavedBadgeTabs.has(tabId),
});
// A content script reporting a completed visit is the whole point of this
// message; the handler additionally requires sender.tab.
registry.register('VALID_VISIT', handleValidVisit, 'content-script-allowed');

export const handleFetchUrl = createFetchUrlHandler({
  getSettings: () => getSettings(),
  buildAllowedUrls: (settings) => buildAllowedUrls(settings),
});
registry.register('FETCH_URL', handleFetchUrl, 'extension-only');

export const handleManualRecord = createManualRecordHandler(_manualRecordDeps);
registry.register('MANUAL_RECORD', handleManualRecord, 'extension-only');

export const handlePreviewRecord = createManualRecordHandler(_manualRecordDeps);
registry.register('PREVIEW_RECORD', handlePreviewRecord, 'extension-only');

export const handleSaveRecord = createSaveRecordHandler(_saveRecordDeps);
registry.register('SAVE_RECORD', handleSaveRecord, 'extension-only');

export const handleContentCleansingExecuted = createContentCleansingExecutedHandler({
  hasBadgeTab: (tabId) => autoSavedBadgeTabs.has(tabId),
});
// Sent by the content extractor running in the page.
registry.register('CONTENT_CLEANSING_EXECUTED', handleContentCleansingExecuted, 'content-script-allowed');

export const handleCheckDomain = createCheckDomainHandler({
  isDomainAllowed: (url) => isDomainAllowed(url),
});
// The content script loader asks whether it should activate on this page.
registry.register('CHECK_DOMAIN', handleCheckDomain, 'content-script-allowed');

export const handleTestConnections = createTestConnectionsHandler({
  testObsidian: () => obsidian.testConnection(),
  testAi: () => aiService.testConnection(),
});
registry.register('TEST_CONNECTIONS', handleTestConnections, 'extension-only');

export const handleTestObsidian = createTestObsidianHandler({
  testConnection: (override?: { apiKey?: string }) => obsidian.testConnection(override),
});
registry.register('TEST_OBSIDIAN', handleTestObsidian, 'extension-only');

export const handleTestAi = createTestAiHandler({
  clearSettingsCache: () => clearSettingsCache(),
  testConnection: (onProgress, runId) => aiService.testConnection(onProgress, runId),
  notifyProgress: notifyAiTestProgress,
});
registry.register('TEST_AI', handleTestAi, 'extension-only');

export const handleGetPrivacyCache = createGetPrivacyCacheHandler({
  getPrivacyCache: () => RecordingCache.getPrivacyCache(),
});
registry.register('GET_PRIVACY_CACHE', handleGetPrivacyCache, 'extension-only');

export const handleActivityUpdate = createActivityUpdateHandler({
  updateActivity: () => updateActivity(),
});
registry.register('ACTIVITY_UPDATE', handleActivityUpdate, 'extension-only');

export const handleSessionLockRequest = createSessionLockRequestHandler({
  lockSession: () => lockSession(),
});
registry.register('SESSION_LOCK_REQUEST', handleSessionLockRequest, 'extension-only');

export const handlePing = createPingHandler({});
// Liveness probe with no payload and no side effects; the content script
// loader uses it to tell a sleeping Service Worker from a broken one.
registry.register('PING', handlePing, 'content-script-allowed');

export const handleRefreshLocalMarkdownScheduler = createRefreshLocalMarkdownSchedulerHandler({
  initExportScheduler: async () => {
    const { initExportScheduler } = await import('./localMarkdownIdleFlusher.js');
    await initExportScheduler();
  },
});
// Only the dashboard changes the export schedule. Previously unguarded, so a
// content script could restart the scheduler.
registry.register('REFRESH_LOCAL_MARKDOWN_SCHEDULER', handleRefreshLocalMarkdownScheduler, 'extension-only');

export const handleConsentStateChanged = createConsentStateChangedHandler({
  updateConsentBadge: async () => {
    const { updateConsentBadge } = await import('./consentBadge.js');
    await updateConsentBadge();
  },
});
// Sent by the popup after the consent dialog closes.
registry.register('CONSENT_STATE_CHANGED', handleConsentStateChanged, 'extension-only');

export const handleGenerateReviewSummary = createGenerateReviewSummaryHandler({
  generateWeeklySummary: async () => {
    const { generateWeeklySummary } = await import('./reviewSummaryGenerator.js');
    return generateWeeklySummary();
  },
  generateMonthlySummary: async () => {
    const { generateMonthlySummary } = await import('./reviewSummaryGenerator.js');
    return generateMonthlySummary();
  },
});
// Sent by the dashboard; triggers paid AI calls, so keep it off web pages.
registry.register('GENERATE_REVIEW_SUMMARY', handleGenerateReviewSummary, 'extension-only');

export const handleLogForward = createLogForwardHandler();
// Sent by the offscreen document (chrome-extension:// URL, no tab).
registry.register('LOG_FORWARD', handleLogForward, 'extension-only');

// The SqliteClient-backed half of these dependencies is shared with the tests
// via createSqliteClientDeps, so both go through one wiring. Only the four
// operations the Service Worker owns are supplied here.
const _dashboardSqliteHandler = createDashboardSqliteHandler(
  createSqliteClientDeps(sqliteClient, {
    runMigration: async () => {
      await chrome.storage.local.remove([
        'yasumaro_migration_status',
        'yasumaro_migration_progress',
      ]);
      const beforeCount = await sqliteClient.getCountResult();
      await migrationService.run();
      const afterCount = await sqliteClient.getCountResult();
      // Do not mask a count failure as 0 records — a failed read must not be
      // reported as a successful migration of nothing (PBI-02).
      if (!beforeCount.success || !afterCount.success) {
        return {
          success: false,
          error: 'Failed to read SQLite record count during migration',
          count: 0,
        };
      }
      return {
        success: true,
        count: afterCount.data,
        read: 0,
        inserted: Math.max(0, afterCount.data - beforeCount.data),
      };
    },
    getConfirmToken: () => ensureConfirmToken(),
    runBackfill: () => migrationService.backfillDiagnosticMetadata(),
    runCleanup: () => migrationService.cleanupLegacyStorage(),
  }),
);

// Sender authorization is enforced by the registry ('extension-only'), which
// rejects content scripts and external extensions before dispatch.
export const handleDashboardSqlite = ((message: Record<string, unknown>, _sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void): void => {
  void (async () => {
    try {
      const result = await _dashboardSqliteHandler(
        (message.payload || {}) as DashboardSqliteRequest & { confirmToken?: string },
      );
      sendResponse(result);
    } catch (error) {
      sendResponse(createErrorResponse(error));
    }
  })();
});
registry.register('DASHBOARD_SQLITE', handleDashboardSqlite, 'extension-only');

// ============================================================================
// Message Handler (wraps registry with validation)
// ============================================================================

/**
 * Validates that a message originates from a content script running on a
 * real http/https page. Content script messages always carry `sender.url`
 * set to the page URL; rejecting other schemes (e.g. chrome-extension://,
 * about:blank, devtools://) prevents non-web sources from triggering
 * recording or other privileged operations.
 */
function isValidContentScriptSender(sender: chrome.runtime.MessageSender): boolean {
    if (!sender.tab || !sender.tab.id || !sender.tab.url) return false;
    const senderUrl = sender.url;
    if (!senderUrl) return false;
    return senderUrl.startsWith('http://') || senderUrl.startsWith('https://');
}

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
            // Restore persisted SW state before handling the first message after
            // a Service Worker restart.
            await Promise.all([isCacheInitialized.restore(), autoSavedBadgeTabs.restore()]);

            try {
                if (!rawMessage || typeof rawMessage !== 'object') {
                    sendResponse(INVALID_MESSAGE_ERROR);
                    return;
                }
                const msg = rawMessage as Record<string, unknown>;
                if (typeof msg.type !== 'string' || !VALID_MESSAGE_TYPES.includes(msg.type as typeof VALID_MESSAGE_TYPES[number])) {
                    sendResponse(INVALID_MESSAGE_ERROR);
                    return;
                }
                if (!NO_PAYLOAD_TYPES.includes(msg.type as typeof NO_PAYLOAD_TYPES[number])) {
                    if (msg.payload === undefined || typeof msg.payload !== 'object') {
                        sendResponse(INVALID_MESSAGE_ERROR);
                        return;
                    }
                }

                if (msg.protocolVersion !== undefined && msg.protocolVersion !== CURRENT_PROTOCOL_VERSION) {
                    logWarn(
                        'Protocol version mismatch - message rejected',
                        { expected: CURRENT_PROTOCOL_VERSION, actual: msg.protocolVersion, type: msg.type },
                        ErrorCode.INTERNAL_ERROR,
                        'service-worker'
                    );
                    sendResponse({ success: false, error: 'Protocol version mismatch' } as never);
                    return;
                }

                const message = rawMessage as ExtensionMessage;

                if (CONTENT_SCRIPT_ONLY_TYPES.includes(message.type as typeof CONTENT_SCRIPT_ONLY_TYPES[number])) {
                    if (!isValidContentScriptSender(sender)) {
                        sendResponse(INVALID_SENDER_ERROR);
                        return;
                    }
                }

                if (message.type !== 'TEST_CONNECTIONS' && message.type !== 'TEST_OBSIDIAN' && message.type !== 'TEST_AI' && message.type !== 'CHECK_DOMAIN') {
                    await runDeferredStartupMigrations();
                    await tabCache.initialize();
                }

                if (message.type === 'CONTENT_CLEANSING_EXECUTED' && !sender.tab?.id) {
                    sendResponse(null);
                    return;
                }

                return registry.dispatch(msg.type as string, msg, sender, sendResponse);
            } catch (error) {
                logError(
                    'Service Worker Error',
                    { error: errorMessage(error) },
                    ErrorCode.INTERNAL_ERROR,
                    'service-worker'
                );
                sendResponse(createErrorResponse(error));
            }
        };

        process();
        return true;
    };
}

// ============================================================================
// Tab Event Handlers (delegated to handlers/tabEventHandlers.ts)
// ============================================================================

const _tabHandlers = createTabEventHandlers({ tabCache, autoSavedBadgeTabs });
export const handleTabRemoved = _tabHandlers.handleTabRemoved;
export const handleTabActivated = _tabHandlers.handleTabActivated;
export const handleTabUpdated = _tabHandlers.handleTabUpdated;

// ============================================================================
// Extension Lifecycle Handlers (delegated to handlers/lifecycleHandlers.ts)
// ============================================================================

const _lifecycleHandlers = createLifecycleHandlers({
    isCacheInitialized,
    rateLimiter,
    sqliteClient,
});
export const handleInstalled = _lifecycleHandlers.handleInstalled;
export const handleStartup = _lifecycleHandlers.handleStartup;

// ============================================================================
// Notification Handlers
// ============================================================================
export { isValidNotificationUrl } from './handlers/notificationHandlers.js';

const _notificationHandlers = createNotificationHandlers({
  record: (data) => recordingLogic.record(data),
});
export const handleNotificationButtonClicked = _notificationHandlers.onButtonClicked;
export const handleNotificationClicked = _notificationHandlers.onClicked;

// ============================================================================
// Context Menu (delegated to handlers/contextMenuHandlers.ts)
// ============================================================================

export const registerManualRecordContextMenu = _registerManualRecordContextMenu;
const _contextClickHandler = createContextClickHandler({
  // Reuse the already-wired handler rather than rebuilding the same
  // dependency set — previously the deps (rateLimiter, manualContentFetcher,
  // RecordingCache, obsidian, aiService, sqliteClient, getSettings,
  // setUrlContent) were reconstructed inline here, risking drift when a dep
  // changed in _manualRecordDeps.
  handleManualRecord,
});

// ============================================================================
// Module-level initialization - register all Chrome event listeners directly
// Guard allows this module to be imported in test environments where
// globalThis.chrome is undefined, without causing errors.
// ============================================================================

async function retryPendingChromeStorageWrite(write: PendingChromeStorageWrite): Promise<boolean> {
  if (write.key !== 'savedUrlsWithTimestamps') return false;
  try {
    const entry = write.value as SavedUrlEntry;
    await withOptimisticLock<SavedUrlEntry[]>('savedUrlsWithTimestamps', (current) => {
      const list = current || [];
      const idx = list.findIndex((e) => e.url === entry.url);
      if (idx >= 0) return list.map((e, i) => (i === idx ? { ...e, timestamp: entry.timestamp } : e));
      return [...list, entry];
    });
    return true;
  } catch {
    return false;
  }
}

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

    // Rehydrate the recording cache on every service-worker wake. Module
    // top-level code runs on each wake; chrome.runtime.onStartup only fires on
    // browser profile startup, so it alone would miss later wakes.
    if (chrome.storage?.session) {
      void restoreRecordingCacheOnWake();
    }

    // Context menu for manual recording
    chrome.runtime.onInstalled.addListener(_registerManualRecordContextMenu);

    chrome.contextMenus.onClicked.addListener(_contextClickHandler);

    // Notification listeners
    chrome.notifications.onButtonClicked.addListener(handleNotificationButtonClicked);
    chrome.notifications.onClicked.addListener(handleNotificationClicked);

    // Daily purge alarm
    //
    // Returns a Promise (not `void`) for the offline-network-retry branch so
    // Chrome keeps this Service Worker alive until the awaited work below
    // finishes. Previously each call there was detached with `void`, which
    // let the SW terminate mid-retry and lose in-flight retryCount progress
    // (PBI-2026-08-01-14). The other branches remain fire-and-forget as before.
    chrome.alarms.onAlarm.addListener(async (alarm) => {
          if (alarm.name === 'yasumaro-daily-purge') {
            handleDailyPurgeAlarm(
                (days, max) => sqliteClient.purgeOldRecordsResult(days, max),
                (days, max, starred) => sqliteClient.purgeContentResult(days, max, starred),
            );
          }
          if (alarm.name === 'yasumaro-local-md-flush') {
            void (async () => {
              const { flushBufferedExports } = await import('./localMarkdownExportCore.js');
              void flushBufferedExports();
            })();
          }
          if (alarm.name === 'yasumaro-local-md-daily-flush') {
            void (async () => {
              const { flushYesterdaysExport } = await import('./localMarkdownIdleFlusher.js');
              void flushYesterdaysExport();
            })();
          }
          if (alarm.name === 'yasumaro-local-md-immediate') {
            void (async () => {
              const { flushBufferedExports } = await import('./localMarkdownExportCore.js');
              void flushBufferedExports();
            })();
          }
          if (alarm.name === 'yasumaro-offline-network-retry') {
            // allSettled ensures one failing task doesn't block the others.
            await Promise.allSettled([
              processOfflineNetworkQueue(),
              flushPendingRecords(sqliteClient),
              flushPendingWrites(retryPendingChromeStorageWrite),
              // Piggyback a lightweight health check on this existing 5-minute
              // alarm to keep the offscreen document from being suspended for
              // long stretches on mobile Chrome (PBI-2026-07-26-20). Reduces
              // suspend frequency; does not guarantee it.
              sqliteClient.isSqliteHealthy(),
            ]);
          }
    });
}
