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
import { createAlarmRegistry } from './alarmRegistry.js';
import { createDeferredMigrationRunner } from './deferredMigrations.js';
import { hasPrivacyConsent } from '../popup/privacyConsent.js';
import { retryPendingChromeStorageWrite } from './retryPendingWrites.js';
export { retryPendingChromeStorageWrite } from './retryPendingWrites.js';
import { settingsRepository } from '../utils/storage/SettingsRepository.js';
import { syncOllamaOriginRule } from './net/ollamaOriginRule.js';
import { createOllamaSettingsObserver } from './net/ollamaSettingsObserver.js';

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

    // Unconditional alarms (daily purge + offline retry) are created from the
    // registry table; conditional ones stay in their own init functions.
    alarmRegistry.installStaticAlarms();

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
    messageRouter,
    autoSavedBadgeTabs,
} = services;
export const rateLimiterForTest = rateLimiter;

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

// Individual handlers are exposed via the router's observable accessor —
// no cast into private state. Used by tests and the context-menu path.
export const handleValidVisit = messageRouter.getHandler('VALID_VISIT');
export const handleFetchUrl = messageRouter.getHandler('FETCH_URL');
export const handleManualRecord = messageRouter.getHandler('MANUAL_RECORD');
export const handlePreviewRecord = messageRouter.getHandler('PREVIEW_RECORD');
export const handleSaveRecord = messageRouter.getHandler('SAVE_RECORD');
export const handleContentCleansingExecuted = messageRouter.getHandler('CONTENT_CLEANSING_EXECUTED');
export const handleCheckDomain = messageRouter.getHandler('CHECK_DOMAIN');
export const handleTestConnections = messageRouter.getHandler('TEST_CONNECTIONS');
export const handleTestObsidian = messageRouter.getHandler('TEST_OBSIDIAN');
export const handleTestAi = messageRouter.getHandler('TEST_AI');
export const handleGetPrivacyCache = messageRouter.getHandler('GET_PRIVACY_CACHE');
export const handleActivityUpdate = messageRouter.getHandler('ACTIVITY_UPDATE');
export const handleSessionLockRequest = messageRouter.getHandler('SESSION_LOCK_REQUEST');
export const handlePing = messageRouter.getHandler('PING');
export const handleRefreshLocalMarkdownScheduler = messageRouter.getHandler('REFRESH_LOCAL_MARKDOWN_SCHEDULER');
export const handleConsentStateChanged = messageRouter.getHandler('CONSENT_STATE_CHANGED');
export const handleGenerateReviewSummary = messageRouter.getHandler('GENERATE_REVIEW_SUMMARY');
export const handleLogForward = messageRouter.getHandler('LOG_FORWARD');
export const handleDashboardSqlite = messageRouter.getHandler('DASHBOARD_SQLITE');

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
  isRecordingAllowed: () => hasPrivacyConsent(),
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

// Alarm registry (routing table + static creation + uniform failure logging)
const alarmRegistry = createAlarmRegistry({
  sqliteClient,
  recordingPipeline,
  getOfflineNetworkQueue: () => import('./offlineNetworkQueue.js').then(m => m.sharedOfflineNetworkQueue),
  retryPendingChromeStorageWrite,
});
const handleAlarm = alarmRegistry.handleAlarm;

// Re-export createMessageHandler for backward compatibility with tests
// that call it without arguments.
export function createMessageHandler(): (
    rawMessage: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
) => boolean {
    return _createMessageHandler({
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

    settingsRepository.observe(createOllamaSettingsObserver(syncOllamaOriginRule));

    if (chrome.storage?.session) {
      void restoreRecordingCacheOnWake(services?.recordingCache);
    }

    chrome.runtime.onInstalled.addListener(_registerManualRecordContextMenu);
    chrome.contextMenus.onClicked.addListener(_contextClickHandler);

    chrome.notifications.onButtonClicked.addListener(handleNotificationButtonClicked);
    chrome.notifications.onClicked.addListener(handleNotificationClicked);

    chrome.alarms.onAlarm.addListener(handleAlarm);
}
