import { SessionStore } from './sessionStore.js';
import { createTabEventHandlers } from './handlers/tabEventHandlers.js';
import { createLifecycleHandlers, restoreRecordingCacheOnWake } from './handlers/lifecycleHandlers.js';
import { registerManualRecordContextMenu as _registerManualRecordContextMenu, createContextClickHandler } from './handlers/contextMenuHandlers.js';
import { logError, ErrorCode } from '../utils/logger.js';
import { initialize as initializeSessionAlarms } from './sessionAlarmsManager.js';
import { createNotificationHandlers } from './handlers/notificationHandlers.js';
import { createCacheInitializedFlag } from './swStatePersistence.js';
import { createBackgroundServices } from './createBackgroundServices.js';
import { createMessageHandler as _createMessageHandler } from './messageHandler.js';
import { createAlarmHandler } from './alarmHandler.js';
import { createDeferredMigrationRunner } from './deferredMigrations.js';
import { retryPendingChromeStorageWrite } from './retryPendingWrites.js';
export { retryPendingChromeStorageWrite } from './retryPendingWrites.js';

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
        await initializeReviewSummaryAlarms(reviewSummaryGenerator);
        setupReviewSummaryAlarmListener(reviewSummaryGenerator);
      } catch (err) {
        logError('Failed to init review summary alarms', { error: String(err) }, ErrorCode.INTERNAL_ERROR, 'service-worker');
      }
    })();
}

// ============================================================================
// Production composition root
// ============================================================================
const services = createBackgroundServices();
const {
    sqliteClient,
    recordingPipeline,
    tabCache,
    rateLimiter,
    manualContentFetcher,
    sessionStore,
    headerDetector,
    reviewSummaryGenerator,
    messageHandlerRegistry,
    messageRouter,
    autoSavedBadgeTabs,
} = services;

// Session store for cross-SW-restart persistence
SessionStore.registerSuspendHandler(sessionStore);

// Initialize clients
void headerDetector.initialize();
rateLimiter.initialize();
const isCacheInitialized = createCacheInitializedFlag();

export function resetManualRecordCache(): void {
    manualContentFetcher.clear();
}

// Extracted modules
const runDeferredStartupMigrations = createDeferredMigrationRunner(sqliteClient);

const { registry, handlers: registryHandlers } = messageHandlerRegistry;

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
} = registryHandlers;

const handleManualRecordForContextMenu = async (
  message: Parameters<NonNullable<typeof handleManualRecord>>[0],
  sender: Parameters<NonNullable<typeof handleManualRecord>>[1],
  sendResponse: Parameters<NonNullable<typeof handleManualRecord>>[2],
): Promise<void> => {
  if (!handleManualRecord) return;
  await handleManualRecord(message, sender, sendResponse);
};

// ============================================================================
// Tab Event Handlers
// ============================================================================
const _tabHandlers = createTabEventHandlers({
  tabCache,
  autoSavedBadgeTabs,
  getPrivacyCache: () => services.recordingCache.getPrivacyCache(),
});
export const handleTabRemoved = _tabHandlers.handleTabRemoved;
export const handleTabActivated = _tabHandlers.handleTabActivated;
export const handleTabUpdated = _tabHandlers.handleTabUpdated;

// ============================================================================
// Lifecycle Handlers
// ============================================================================
const _lifecycleHandlers = createLifecycleHandlers({ isCacheInitialized, rateLimiter, sqliteClient, recordingCache: services.recordingCache });
export const handleInstalled = _lifecycleHandlers.handleInstalled;
export const handleStartup = _lifecycleHandlers.handleStartup;

// ============================================================================
// Notification Handlers
// ============================================================================
export { isValidNotificationUrl } from './handlers/notificationHandlers.js';
const _notificationHandlers = createNotificationHandlers({ record: (data) => recordingPipeline.record(data) });
export const handleNotificationButtonClicked = _notificationHandlers.onButtonClicked;
export const handleNotificationClicked = _notificationHandlers.onClicked;

// ============================================================================
// Context Menu
// ============================================================================
export const registerManualRecordContextMenu = _registerManualRecordContextMenu;
const _contextClickHandler = createContextClickHandler({ handleManualRecord: handleManualRecordForContextMenu });

// Alarm handler
const handleAlarm = createAlarmHandler({
  sqliteClient,
  recordingPipeline,
  getOfflineNetworkQueue: () => import('./offlineNetworkQueue.js').then(m => m.sharedOfflineNetworkQueue),
  retryPendingChromeStorageWrite,
});

// Re-export createMessageHandler for backward compatibility with tests
// that call it without arguments.
// Deep module: prefer MessageRouter's single dispatch seam when available
export function createMessageHandler(): (
    rawMessage: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
) => boolean {
    return _createMessageHandler({
      registry,
      router: messageRouter,
      tabCache,
      isCacheInitialized,
      autoSavedBadgeTabs,
      runDeferredStartupMigrations,
    });
}

// ============================================================================
// Chrome Event Listeners
// ============================================================================
if (typeof globalThis.chrome !== 'undefined' && chrome.tabs?.onRemoved) {
    chrome.runtime.onMessage.addListener(createMessageHandler());

    chrome.tabs.onRemoved.addListener(handleTabRemoved);
    chrome.tabs.onActivated.addListener(handleTabActivated);
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) =>
      handleTabUpdated(tabId, changeInfo, tab.url !== undefined ? { url: tab.url } : {}),
    );

    chrome.runtime.onInstalled.addListener(handleInstalled);
    chrome.runtime.onStartup.addListener(handleStartup);

    if (chrome.storage?.session) {
      void restoreRecordingCacheOnWake(services?.recordingCache);
    }

    chrome.runtime.onInstalled.addListener(_registerManualRecordContextMenu);
    chrome.contextMenus.onClicked.addListener(_contextClickHandler);

    chrome.notifications.onButtonClicked.addListener(handleNotificationButtonClicked);
    chrome.notifications.onClicked.addListener(handleNotificationClicked);

    chrome.alarms.onAlarm.addListener(handleAlarm);
}
