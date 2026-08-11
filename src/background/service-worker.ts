import { notifyAiTestProgress } from './aiTestProgressNotifier.js';
import { RecordingCache } from './recordingCache.js';
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
import { withOptimisticLock } from '../utils/optimisticLock.js';
import type { SavedUrlEntry } from '../utils/urlEntry.js';
import { MigrationService } from './migrationService.js';
import { createErrorResponse } from '../utils/errorMessages.js';
import { errorMessage } from '../utils/errorUtils.js';
import { NotificationHelper } from './notificationHelper.js';
import { logInfo, logDebug, logWarn, logError, ErrorCode } from '../utils/logger.js';

import { updateActivity, initialize as initializeSessionAlarms } from './sessionAlarmsManager.js';
import { handleDailyPurgeAlarm } from './dailyPurgeHandler.js';
import { hasPrivacyConsent } from '../popup/privacyConsent.js';
import { formatEntriesToMarkdown } from '../dashboard/obsidianFormatter.js';
import {
    VALID_MESSAGE_TYPES,
    CONTENT_SCRIPT_ONLY_TYPES,
    NO_PAYLOAD_TYPES,
    CURRENT_PROTOCOL_VERSION,
} from './messageTypes.js';
import type { ExtensionMessage } from './messageTypes.js';
import { MessageHandlerRegistry } from './handlers/MessageHandlerRegistry.js';
import { createDashboardSqliteHandler, createSqliteClientDeps } from './handlers/dashboardSqliteHandlers.js';
import { createNotificationHandlers } from './handlers/notificationHandlers.js';
import { sharedOfflineNetworkQueue } from './offlineNetworkQueue.js';
import { createOfflineQueueProcessor } from './offlineQueueProcessor.js';
import { createCacheInitializedFlag, createAutoSavedBadgeTabs } from './swStatePersistence.js';
import type { DashboardSqliteRequest } from './handlers/dashboardSqliteProtocol.js';
import { createBackgroundServices } from './createBackgroundServices.js';
import { createMessageHandlerRegistry } from './handlers/createMessageHandlerRegistry.js';

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

// ============================================================================
// Production composition root
//
// All long-lived collaborators are constructed once by createBackgroundServices
// (shared SqliteClient via getSharedSqliteClient, one shared RecordingPipeline,
// and the manual/save handler deps). The Service Worker keeps its startup side
// effects here: suspend-handler registration, HeaderDetector, rate-limiter
// rehydration, alarms, and deferred migrations.
// ============================================================================
const services = createBackgroundServices();
const {
    obsidian,
    aiService,
    sqliteClient,
    recordingLogic,
    tabCache,
    rateLimiter,
    manualContentFetcher,
    sessionStore,
} = services;
const { manualRecordDeps, saveRecordDeps } = services;

// Session store for cross-SW-restart persistence
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
const migrationService = new MigrationService(sqliteClient);

const processOfflineNetworkQueue = createOfflineQueueProcessor({
    offlineNetworkQueue: sharedOfflineNetworkQueue,
    recordingLogic,
});

// 自動保存成功バッジを表示中のタブIDセット（SW再起動をまたいで永続化）
const autoSavedBadgeTabs = createAutoSavedBadgeTabs();

// Initialize HeaderDetector (must be initialized on Service Worker startup)
HeaderDetector.initialize();

const INVALID_SENDER_ERROR = { success: false, error: 'Invalid sender' };
const INVALID_MESSAGE_ERROR = { success: false, error: 'Invalid message' };

// Rate limiter for skipAi operations
rateLimiter.initialize();

// Track whether cache has been initialized (for startup rehydration; persisted
// across Service Worker restarts via chrome.storage.session)
const isCacheInitialized = createCacheInitializedFlag();

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
const dashboardSqliteMessageHandler = ((message: Record<string, unknown>, _sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void): void => {
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

const messageRegistryComposition = createMessageHandlerRegistry({
  recordingLogic,
  tabCache,
  obsidian,
  aiService,
  manualRecordDeps,
  saveRecordDeps,
  hasPrivacyConsent: () => hasPrivacyConsent(),
  buildAllowedUrls: (settings) => buildAllowedUrls(settings),
  getSettings: () => getSettings(),
  isDomainAllowed: (url) => isDomainAllowed(url),
  clearSettingsCache: () => clearSettingsCache(),
  notifyAiTestProgress,
  getPrivacyCache: () => RecordingCache.getPrivacyCache(),
  updateActivity: () => updateActivity(),
  lockSession: () => lockSession(),
  autoSavedBadgeTabs,
  initExportScheduler: async () => {
    const { initExportScheduler } = await import('./localMarkdownIdleFlusher.js');
    await initExportScheduler();
  },
  updateConsentBadge: async () => {
    const { updateConsentBadge } = await import('./consentBadge.js');
    await updateConsentBadge();
  },
  generateWeeklySummary: async () => {
    const { generateWeeklySummary } = await import('./reviewSummaryGenerator.js');
    return generateWeeklySummary();
  },
  generateMonthlySummary: async () => {
    const { generateMonthlySummary } = await import('./reviewSummaryGenerator.js');
    return generateMonthlySummary();
  },
  dashboardSqliteHandler: dashboardSqliteMessageHandler,
});

const { registry } = messageRegistryComposition;
export const {
  VALID_VISIT: handleValidVisit,
  FETCH_URL: handleFetchUrl,
  MANUAL_RECORD: handleManualRecord,
  PREVIEW_RECORD: handlePreviewRecord,
  SAVE_RECORD: handleSaveRecord,
  CONTENT_CLEANSING_EXECUTED: handleContentCleansingExecuted,
  CHECK_DOMAIN: handleCheckDomain,
  TEST_CONNECTIONS: handleTestConnections,
  TEST_OBSIDIAN: handleTestObsidian,
  TEST_AI: handleTestAi,
  GET_PRIVACY_CACHE: handleGetPrivacyCache,
  ACTIVITY_UPDATE: handleActivityUpdate,
  SESSION_LOCK_REQUEST: handleSessionLockRequest,
  PING: handlePing,
  REFRESH_LOCAL_MARKDOWN_SCHEDULER: handleRefreshLocalMarkdownScheduler,
  CONSENT_STATE_CHANGED: handleConsentStateChanged,
  GENERATE_REVIEW_SUMMARY: handleGenerateReviewSummary,
  LOG_FORWARD: handleLogForward,
  DASHBOARD_SQLITE: handleDashboardSqlite,
} = messageRegistryComposition.handlers;

const handleManualRecordForContextMenu = async (
  message: Parameters<typeof handleManualRecord>[0],
  sender: Parameters<typeof handleManualRecord>[1],
  sendResponse: Parameters<typeof handleManualRecord>[2],
): Promise<void> => {
  await handleManualRecord(message, sender, sendResponse);
};

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
  handleManualRecord: handleManualRecordForContextMenu,
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
