import { ObsidianClient } from './obsidianClient.js';
import { AIClient } from './aiClient.js';
import { FallbackAIService } from './ai/FallbackAIService.js';
import { RemoteAIService } from './ai/RemoteAIService.js';
import { LocalAIService } from './ai/LocalAIService.js';
import { LocalAIClient } from './localAiClient.js';
import { RecordingLogic } from './recordingLogic.js';
import { TabCache } from './tabCache.js';
import { HeaderDetector } from './headerDetector.js';
import { SessionStore } from './sessionStore.js';
import { BADGE_COLORS } from '../constants/appConstants.js';
import { createTabEventHandlers } from './handlers/tabEventHandlers.js';
import { createLifecycleHandlers } from './handlers/lifecycleHandlers.js';
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
import { getSharedSqliteClient } from './sqliteClient.js';
import { MigrationService } from './migrationService.js';
import { createErrorResponse } from '../utils/errorMessages.js';
import { errorMessage } from '../utils/errorUtils.js';
import { NotificationHelper } from './notificationHelper.js';
import { logInfo, logDebug, logWarn, logError, ErrorCode } from '../utils/logger.js';

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
} from './handlers/messageHandlers.js';
import type {
    ManualRecordHandlerDeps,
    SaveRecordHandlerDeps,
} from './handlers/messageHandlers.js';
import { createDashboardSqliteHandler } from './handlers/dashboardSqliteHandlers.js';
import { createNotificationHandlers } from './handlers/notificationHandlers.js';
import { sharedOfflineNetworkQueue, type OfflineJob } from './offlineNetworkQueue.js';
import type { RecordingData } from '../messaging/types.js';
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
    // Migration (already async, run at startup)
    runMigration();
    // SessionStore backend migration: sw: keys from chrome.storage.local -> chrome.storage.session
    SessionStore.migrateFromLocalStorage().catch((err) => {
        logError('SessionStore migration failed', { error: String(err) }, ErrorCode.STORAGE_MIGRATION_FAILURE, 'service-worker');
    });
    // SQLite data migration from chrome.storage.local
    migrationService.run().catch((err) => {
        logError('Yasumaro migration failed', { error: String(err) }, ErrorCode.STORAGE_MIGRATION_FAILURE, 'service-worker');
    });

    // OPFS recovery migration — runs after standard migration (async fire-and-forget)
    (async () => {
        try {
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
            logError('OPFS recovery check failed', { error: String(err) }, ErrorCode.STORAGE_MIGRATION_FAILURE, 'service-worker');
        }
    })();

    // Session alarm initialization for master password timeout
    initializeSessionAlarms();

    chrome.alarms.create('yasumaro-daily-purge', { periodInMinutes: 1440 });
    chrome.alarms.create('yasumaro-offline-network-retry', { periodInMinutes: 5 });

    // PBI 2026-07-09-03 / 2026-07-10: schedule local Markdown export per LOCAL_MARKDOWN_EXPORT_TIMING
    (async () => {
      const { initExportScheduler } = await import('./localMarkdownIdleFlusher.js');
      await initExportScheduler();
    })();

    // Initialize weekly/monthly review summary alarms
    (async () => {
      const { initializeReviewSummaryAlarms, setupReviewSummaryAlarmListener } = await import('./reviewSummaryAlarm.js');
      await initializeReviewSummaryAlarms();
      setupReviewSummaryAlarmListener();
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
const localClient = new LocalAIClient();
const aiService = new FallbackAIService({
  local: new LocalAIService({
    localAiClient: localClient,
    ensureOffscreenDocument: localClient.ensureOffscreenDocument.bind(localClient),
  }),
  remote: new RemoteAIService({ aiClient }),
});
const sqliteClient = getSharedSqliteClient();
const recordingLogic = new RecordingLogic(obsidian, aiService, undefined, sqliteClient);
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

const manualContentFetcher = new ManualContentFetcher();

export function resetManualRecordCache(): void {
    manualContentFetcher.clear();
}

// ============================================================================
// Message Handler Registry
// ============================================================================

const registry = new MessageHandlerRegistry();

const _manualRecordDeps: ManualRecordHandlerDeps = {
  isRecordingAllowed: () => hasPrivacyConsent(),
  checkRateLimit: (sender: import('./rateLimiter.js').MessageSenderLike | undefined, settings: Record<string, unknown>) => rateLimiter.check(sender, settings),
  fetchContent: (url: string) => manualContentFetcher.fetchContent(url),
  getPrivacyInfoWithCache: (url: string) => recordingLogic.getPrivacyInfoWithCache(url),
  obsidian,
  aiService,
  sqliteClient,
  getSettings: () => getSettings(),
  setUrlContent: async (url: string, content: string) => {
    const { setUrlContent: setUrl } = await import('../utils/storageUrls.js');
    await setUrl(url, content);
  },
};

const _saveRecordDeps: SaveRecordHandlerDeps = {
  isRecordingAllowed: () => hasPrivacyConsent(),
  getPrivacyInfoWithCache: (url: string) => recordingLogic.getPrivacyInfoWithCache(url),
  obsidian,
  aiService,
  sqliteClient,
  getSettings: () => getSettings(),
  setUrlContent: async (url: string, content: string) => {
    const { setUrlContent: setUrl } = await import('../utils/storageUrls.js');
    await setUrl(url, content);
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
registry.register('VALID_VISIT', handleValidVisit);

export const handleFetchUrl = createFetchUrlHandler({
  getSettings: () => getSettings(),
  buildAllowedUrls: (settings) => buildAllowedUrls(settings),
});
registry.register('FETCH_URL', handleFetchUrl);

export const handleManualRecord = createManualRecordHandler(_manualRecordDeps);
registry.register('MANUAL_RECORD', handleManualRecord);

export const handlePreviewRecord = createManualRecordHandler(_manualRecordDeps);
registry.register('PREVIEW_RECORD', handlePreviewRecord);

export const handleSaveRecord = createSaveRecordHandler(_saveRecordDeps);
registry.register('SAVE_RECORD', handleSaveRecord);

export const handleContentCleansingExecuted = createContentCleansingExecutedHandler({
  hasBadgeTab: (tabId) => autoSavedBadgeTabs.has(tabId),
});
registry.register('CONTENT_CLEANSING_EXECUTED', handleContentCleansingExecuted);

export const handleCheckDomain = createCheckDomainHandler({
  isDomainAllowed: (url) => isDomainAllowed(url),
});
registry.register('CHECK_DOMAIN', handleCheckDomain);

export const handleTestConnections = createTestConnectionsHandler({
  testObsidian: () => obsidian.testConnection(),
  testAi: () => aiClient.testConnection(),
});
registry.register('TEST_CONNECTIONS', handleTestConnections);

export const handleTestObsidian = createTestObsidianHandler({
  testConnection: (override?: { apiKey?: string }) => obsidian.testConnection(override),
});
registry.register('TEST_OBSIDIAN', handleTestObsidian);

export const handleTestAi = createTestAiHandler({
  clearSettingsCache: () => clearSettingsCache(),
  testConnection: () => aiClient.testConnection(),
});
registry.register('TEST_AI', handleTestAi);

export const handleGetPrivacyCache = createGetPrivacyCacheHandler({
  getPrivacyCache: () => RecordingLogic.cacheState.privacyCache,
});
registry.register('GET_PRIVACY_CACHE', handleGetPrivacyCache);

export const handleActivityUpdate = createActivityUpdateHandler({
  updateActivity: () => updateActivity(),
});
registry.register('ACTIVITY_UPDATE', handleActivityUpdate);

export const handleSessionLockRequest = createSessionLockRequestHandler({
  lockSession: () => lockSession(),
});
registry.register('SESSION_LOCK_REQUEST', handleSessionLockRequest);

export const handlePing = createPingHandler({});
registry.register('PING', handlePing);

export const handleRefreshLocalMarkdownScheduler = createRefreshLocalMarkdownSchedulerHandler({
  initExportScheduler: async () => {
    const { initExportScheduler } = await import('./localMarkdownIdleFlusher.js');
    await initExportScheduler();
  },
});
registry.register('REFRESH_LOCAL_MARKDOWN_SCHEDULER', handleRefreshLocalMarkdownScheduler);

export const handleConsentStateChanged = createConsentStateChangedHandler({
  updateConsentBadge: async () => {
    const { updateConsentBadge } = await import('./consentBadge.js');
    await updateConsentBadge();
  },
});
registry.register('CONSENT_STATE_CHANGED', handleConsentStateChanged);

const _dashboardSqliteHandler = createDashboardSqliteHandler({
  query: (params) => sqliteClient.query(params as any),
  search: (query, limit, offset) => sqliteClient.search(query, limit, offset),
  toggleStar: (id) => sqliteClient.toggleStar(id),
  delete: (id) => sqliteClient.delete(id),
  update: (id, changes) => sqliteClient.update(id, changes),
  getCount: () => sqliteClient.getCount(),
  clearAll: () => sqliteClient.clearAll(),
  insert: (record) => sqliteClient.insert(record as any),
  restoreDb: (data) => sqliteClient.restoreDb(data),
  getStatus: () => sqliteClient.getStatus(),
  runOpfsSpike: () => sqliteClient.runOpfsSpike() as Promise<Record<string, unknown> | null>,
  purgeOldRecords: (days, max) => sqliteClient.purgeOldRecords(days, max),
  purgeContent: (days, max, includeStarred) => sqliteClient.purgeContent(days, max, includeStarred),
  backupDb: () => sqliteClient.backupDb(),
  lastError: sqliteClient.lastError,
  runMigration: async () => {
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
  getConfirmToken: () => ensureConfirmToken(),
  runBackfill: () => migrationService.backfillDiagnosticMetadata(),
  runCleanup: () => migrationService.cleanupLegacyStorage(),
  getSettings: () => getSettings(),
  formatEntriesToMarkdown: (entries) => formatEntriesToMarkdown(entries),
  queryAuditLog: (options) => sqliteClient.queryAuditLog(options),
  appendToDailyNote: async (markdown) => {
    const obsidianClient = new ObsidianClient();
    await obsidianClient.appendToDailyNote(markdown);
  },
});

export const handleDashboardSqlite = ((message: Record<string, unknown>, sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void): void => {
  if (sender.tab && (!sender.url || !sender.url.startsWith('chrome-extension://'))) {
    sendResponse({ success: false, error: 'DASHBOARD_SQLITE is not allowed from content scripts' });
    return;
  }
  if (sender.id !== chrome.runtime.id) {
    sendResponse({ success: false, error: 'DASHBOARD_SQLITE is not allowed from external extensions' });
    return;
  }
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
registry.register('DASHBOARD_SQLITE', handleDashboardSqlite);

// ============================================================================
// Offline Network Queue Retry
// ============================================================================

async function processOfflineNetworkQueue(): Promise<void> {
  await sharedOfflineNetworkQueue.retryAll(async (job: OfflineJob) => {
    const payload = job.payload as {
      title: string;
      url: string;
      content: string;
      summary?: string;
      maskedCount?: number;
      tags?: string[];
    };
    try {
      const result = await recordingLogic.record({
        title: payload.title,
        url: payload.url,
        content: payload.content,
        force: true,
        skipDuplicateCheck: true,
        recordType: 'manual',
      } as RecordingData);
      return result.success && !result.skipped;
    } catch {
      return false;
    }
  });
}

// ============================================================================
// Message Handler (wraps registry with validation)
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
                    if (!sender.tab || !sender.tab.id || !sender.tab.url) {
                        sendResponse(INVALID_SENDER_ERROR);
                        return;
                    }
                }

                if (message.type !== 'TEST_CONNECTIONS' && message.type !== 'TEST_OBSIDIAN' && message.type !== 'TEST_AI' && message.type !== 'CHECK_DOMAIN') {
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
    isCacheInitialized: { get value() { return isCacheInitialized; }, set value(v: boolean) { isCacheInitialized = v; } },
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
  handleManualRecord: async (message, sender, sendResponse) => {
    const handler = createManualRecordHandler({
      isRecordingAllowed: () => hasPrivacyConsent(),
      checkRateLimit: (sender, settings) => rateLimiter.check(sender, settings),
      fetchContent: (url) => manualContentFetcher.fetchContent(url),
      getPrivacyInfoWithCache: (url) => recordingLogic.getPrivacyInfoWithCache(url),
      obsidian,
      aiService,
      sqliteClient,
      getSettings: () => getSettings(),
      setUrlContent: async (url, content) => {
        const { setUrlContent: setUrl } = await import('../utils/storageUrls.js');
        await setUrl(url, content);
      },
    });
    await handler(message, sender, sendResponse);
  },
});

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

    // Context menu for manual recording
    chrome.runtime.onInstalled.addListener(_registerManualRecordContextMenu);

    chrome.contextMenus.onClicked.addListener(_contextClickHandler);

    // Notification listeners
    chrome.notifications.onButtonClicked.addListener(handleNotificationButtonClicked);
    chrome.notifications.onClicked.addListener(handleNotificationClicked);

    // Daily purge alarm
    chrome.alarms.onAlarm.addListener((alarm) => {
          if (alarm.name === 'yasumaro-daily-purge') {
            handleDailyPurgeAlarm(
                (days, max) => sqliteClient.purgeOldRecords(days, max),
                (days, max, starred) => sqliteClient.purgeContent(days, max, starred),
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
            void processOfflineNetworkQueue();
          }
    });
}
