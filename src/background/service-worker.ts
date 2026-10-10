import { SessionStore } from './sessionStore.js';
import { createTabEventHandlers } from './handlers/tabEventHandlers.js';
import { createLifecycleHandlers, restoreRecordingCacheOnWake } from './handlers/lifecycleHandlers.js';
import { registerManualRecordContextMenu as _registerManualRecordContextMenu, createContextClickHandler } from './handlers/contextMenuHandlers.js';
import { ErrorCode } from '../utils/logger/types.js';
import { errorMessage } from '../utils/errorUtils.js';
import { logError } from '../utils/logger/api.js';
import { createNotificationHandlers } from './handlers/notificationHandlers.js';
import { createCacheInitializedFlag } from './swStatePersistence.js';
import { createBackgroundServices } from './createBackgroundServices.js';
import { createMessageHandler as _createMessageHandler } from './messageHandler.js';
import { hasPrivacyConsent } from '../utils/storage/privacyConsent.js';
export { retryPendingChromeStorageWrite } from './retryPendingWrites.js';
import { settingsRepository } from '../utils/storage/SettingsRepository.js';
import { syncOllamaOriginRule } from './net/ollamaOriginRule.js';
import { createOllamaSettingsObserver } from './net/ollamaSettingsObserver.js';
import { initAllowedUrlsSync } from './allowedUrlsSync.js';
import {
  onTabRemoved,
  registerNavTrailConsentWatcher,
} from './navTrail/navTrailTracker.js';

// ============================================================================
// Listener guard
// ============================================================================

/**
 * Fire-and-forget wrapper for Chrome event listeners.
 * Async listener rejections are otherwise silent in MV3 (the event handling
 * is lost with only an unhandled-rejection log). Existing try/catch inside
 * each handler stays untouched; this is the outer safety net.
 */
export function guard<Args extends unknown[]>(
  fn: (...args: Args) => unknown,
  tag: string,
): (...args: Args) => void {
  return (...args: Args) => {
    void Promise.resolve()
      .then(() => fn(...args))
      .catch((error: unknown) => {
        void logError(`Listener failed: ${tag}`, { error: errorMessage(error) }, ErrorCode.INTERNAL_ERROR, 'service-worker');
      });
  };
}

// ============================================================================
// Service Worker Initialization
// ============================================================================

/**
 * Initialize Service Worker with all Chrome event listeners.
 * Extracted for testability - call this function instead of relying on
 * module-level side effects.
 */
export function init(): void {
    // Seed + live-sync the persisted FETCH_URL/provider allowlist from
    // settings. Runs before any request can read the key, so existing users
    // are migrated ahead of the fail-closed reader.
    void initAllowedUrlsSync();

    // All timed jobs (daily purge, local-md, offline retry, review-summary,
    // session-timeout) are unified under the registry's installAll() — static
    // schedules + conditional install hooks + uniform failure policy live in
    // alarmRegistry.ts's table. The session-timeout alarm is armed here and
    // nowhere else; arming it in two places would clear+create it twice.
    void alarmRegistry.installAll();

    // PBI 2026-07-09-03 / 2026-07-10: schedule local Markdown export per LOCAL_MARKDOWN_EXPORT_TIMING
    (async () => {
      try {
        const { initExportScheduler } = await import('./localMarkdownIdleFlusher.js');
        await initExportScheduler();
      } catch (err) {
        logError('Failed to init export scheduler', { error: String(err) }, ErrorCode.INTERNAL_ERROR, 'service-worker');
      }
    })();

    // Firefox has no offscreen API: the background event page hosts the
    // storage engine itself and answers target:'offscreen' messages in-page.
    // Order matters — inject the event-page worker factory BEFORE importing
    // the offscreen host module (whose import registers the runtime listener
    // and keeps the engine resident). Build-time constant — dead on Chromium.
    if (import.meta.env.FIREFOX) {
      (async () => {
        try {
          const { setOpfsWorkerFactory } = await import('../offscreen/sqliteEngineContext/opfsWorkerProxy.js');
          setOpfsWorkerFactory(() => new Worker(chrome.runtime.getURL('opfs-worker.js'), { type: 'module' }));
          // The Firefox worker bundle inlines its wasm as data: (unusable
          // under the extension CSP) — point the engine at the stable public
          // asset instead. Propagates to the worker via the INIT payload.
          const { setSqliteWasmUrlOverride } = await import('../offscreen/sqliteBoot.js');
          setSqliteWasmUrlOverride(chrome.runtime.getURL('wasm/wa-sqlite-async.wasm'));
          await import('../offscreen/offscreen.js');
        } catch (err) {
          logError('Failed to start in-page offscreen host', { error: String(err) }, ErrorCode.INTERNAL_ERROR, 'service-worker');
        }
      })();
    }
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
    messageRouter,
    autoSavedBadgeTabs,
    alarmRegistry,
    deferredMigrationRunner,
} = services;
export const rateLimiterForTest = rateLimiter;

// Session store for cross-SW-restart persistence
SessionStore.registerSuspendHandler(sessionStore);

// Initialize clients
void headerDetector.initialize().catch((error: unknown) => {
  void logError('HeaderDetector initialization failed', { error: errorMessage(error) }, ErrorCode.UNKNOWN_ERROR, 'service-worker');
});
void rateLimiter.initialize().catch((error: unknown) => {
  void logError('RateLimiter initialization failed', { error: errorMessage(error) }, ErrorCode.UNKNOWN_ERROR, 'service-worker');
});
const isCacheInitialized = createCacheInitializedFlag();

export function resetManualRecordCache(): void {
    manualContentFetcher.clear();
}

// Extracted modules (PBI 2026-09-15-17: resolved via the manifest)
const runDeferredStartupMigrations = deferredMigrationRunner;

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

    chrome.tabs.onRemoved.addListener(guard(handleTabRemoved, 'handleTabRemoved'));
    chrome.tabs.onActivated.addListener(guard(handleTabActivated, 'handleTabActivated'));
    chrome.tabs.onUpdated.addListener(guard((tabId, changeInfo, tab) =>
      handleTabUpdated(tabId, changeInfo, tab.url !== undefined ? { url: tab.url } : {}),
    'handleTabUpdated'));
    // NN18: the nav trail map is no longer supplied from a changeInfo.url
    // listener — it was a structural no-op on normal sites (the manifest
    // declares no "tabs" permission and host permissions are minimized, so
    // Chrome never delivers the URL — ADR 2026-10-07-tab-url-permission-decision).
    // The map is now supplied from the VALID_VISIT handler, the only surface
    // that sees a URL; the consent gate and the reload/fragment judgment stay
    // inside navTrailTracker.
    chrome.tabs.onRemoved.addListener((tabId) => {
      void onTabRemoved(tabId).catch(async (error: unknown) => {
        await logError('Failed to clear nav trail for closed tab', {
          tabId,
          error: errorMessage(error),
        }, ErrorCode.STORAGE_WRITE_FAILURE, 'service-worker.ts');
      });
    });
    registerNavTrailConsentWatcher();

    chrome.runtime.onInstalled.addListener(guard(handleInstalled, 'handleInstalled'));
    chrome.runtime.onStartup.addListener(guard(handleStartup, 'handleStartup'));

    settingsRepository.observe(createOllamaSettingsObserver(syncOllamaOriginRule));

    if (chrome.storage?.session) {
      void restoreRecordingCacheOnWake(services?.recordingCache).catch((error: unknown) => {
        void logError('Recording cache restore on wake failed', { error: errorMessage(error) }, ErrorCode.STORAGE_READ_FAILURE, 'service-worker');
      });
    }

    chrome.runtime.onInstalled.addListener(guard(_registerManualRecordContextMenu, 'registerManualRecordContextMenu'));
    chrome.contextMenus.onClicked.addListener(guard(_contextClickHandler, 'contextClick'));

    chrome.notifications.onButtonClicked.addListener(guard(handleNotificationButtonClicked, 'notificationButtonClicked'));
    chrome.notifications.onClicked.addListener(guard(handleNotificationClicked, 'notificationClicked'));

    chrome.alarms.onAlarm.addListener(handleAlarm);
}
