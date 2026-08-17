import { HeaderDetector } from './headerDetector.js';
import { SessionStore } from './sessionStore.js';
import { createTabEventHandlers } from './handlers/tabEventHandlers.js';
import { createLifecycleHandlers, restoreRecordingCacheOnWake } from './handlers/lifecycleHandlers.js';
import { registerManualRecordContextMenu as _registerManualRecordContextMenu, createContextClickHandler } from './handlers/contextMenuHandlers.js';
import { logWarn, logError, ErrorCode } from '../utils/logger.js';
import { initialize as initializeSessionAlarms } from './sessionAlarmsManager.js';
import {
    VALID_MESSAGE_TYPES,
    CONTENT_SCRIPT_ONLY_TYPES,
    NO_PAYLOAD_TYPES,
    CURRENT_PROTOCOL_VERSION,
} from './messageTypes.js';
import type { ExtensionMessage } from './messageTypes.js';
import { MessageHandlerRegistry } from './handlers/MessageHandlerRegistry.js';
import { createNotificationHandlers } from './handlers/notificationHandlers.js';
import { createCacheInitializedFlag, createAutoSavedBadgeTabs } from './swStatePersistence.js';
import { createBackgroundServices } from './createBackgroundServices.js';
import { createMessageRegistryComposition } from './createMessageRegistryComposition.js';
import { createMessageHandler as _createMessageHandler, type MessageHandlerDeps } from './messageHandler.js';
import { ensureConfirmToken } from './confirmTokenManager.js';
import { createAlarmHandler } from './alarmHandler.js';
import { createDeferredMigrationRunner } from './deferredMigrations.js';
import { createDashboardSqliteMessageHandler } from './dashboardSqliteWiring.js';
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
    aiService,
    sqliteClient,
    recordingLogic,
    tabCache,
    rateLimiter,
    manualContentFetcher,
    sessionStore,
    reviewSummaryGenerator,
} = services;
const { manualRecordDeps, saveRecordDeps } = services;

// Session store for cross-SW-restart persistence
SessionStore.registerSuspendHandler(sessionStore);

// Initialize clients
const autoSavedBadgeTabs = createAutoSavedBadgeTabs();
HeaderDetector.initialize();
rateLimiter.initialize();
const isCacheInitialized = createCacheInitializedFlag();

export function resetManualRecordCache(): void {
    manualContentFetcher.clear();
}

// Extracted modules
const runDeferredStartupMigrations = createDeferredMigrationRunner(sqliteClient);
const dashboardSqliteHandler = createDashboardSqliteMessageHandler({ sqliteClient, ensureConfirmToken });

const messageRegistryComposition = createMessageRegistryComposition({
  services,
  dashboardSqliteHandler,
  autoSavedBadgeTabs,
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
// Tab Event Handlers
// ============================================================================
const _tabHandlers = createTabEventHandlers({ tabCache, autoSavedBadgeTabs });
export const handleTabRemoved = _tabHandlers.handleTabRemoved;
export const handleTabActivated = _tabHandlers.handleTabActivated;
export const handleTabUpdated = _tabHandlers.handleTabUpdated;

// ============================================================================
// Lifecycle Handlers
// ============================================================================
const _lifecycleHandlers = createLifecycleHandlers({ isCacheInitialized, rateLimiter, sqliteClient });
export const handleInstalled = _lifecycleHandlers.handleInstalled;
export const handleStartup = _lifecycleHandlers.handleStartup;

// ============================================================================
// Notification Handlers
// ============================================================================
export { isValidNotificationUrl } from './handlers/notificationHandlers.js';
const _notificationHandlers = createNotificationHandlers({ record: (data) => recordingLogic.record(data) });
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
  recordingLogic,
  getOfflineNetworkQueue: () => import('./offlineNetworkQueue.js').then(m => m.sharedOfflineNetworkQueue),
  retryPendingChromeStorageWrite,
});

// Re-export createMessageHandler for backward compatibility with tests
// that call it without arguments.
export function createMessageHandler(): (
    rawMessage: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
) => boolean {
    return _createMessageHandler({
      registry,
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
    chrome.tabs.onUpdated.addListener(handleTabUpdated);

    chrome.runtime.onInstalled.addListener(handleInstalled);
    chrome.runtime.onStartup.addListener(handleStartup);

    if (chrome.storage?.session) {
      void restoreRecordingCacheOnWake();
    }

    chrome.runtime.onInstalled.addListener(_registerManualRecordContextMenu);
    chrome.contextMenus.onClicked.addListener(_contextClickHandler);

    chrome.notifications.onButtonClicked.addListener(handleNotificationButtonClicked);
    chrome.notifications.onClicked.addListener(handleNotificationClicked);

    chrome.alarms.onAlarm.addListener(handleAlarm);
}
