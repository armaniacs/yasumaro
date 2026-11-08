import { SessionStore } from './sessionStore.js';
import { createTabEventHandlers } from './handlers/tabEventHandlers.js';
import { createLifecycleHandlers, restoreRecordingCacheOnWake } from './handlers/lifecycleHandlers.js';
import { registerManualRecordContextMenu as _registerManualRecordContextMenu, createContextClickHandler } from './handlers/contextMenuHandlers.js';
import { createKeyboardCommandHandler, createOmniboxInputHandler } from './handlers/entryFrictionHandlers.js';
import { ErrorCode } from '../utils/logger/types.js';
import { errorMessage } from '../utils/errorUtils.js';
import { logError, logWarn } from '../utils/logger/api.js';
import { createNotificationHandlers } from './handlers/notificationHandlers.js';
import { createSessionReminderClickHandlers } from './sessionReminderClick.js';
import { createCacheInitializedFlag } from './swStatePersistence.js';
import {
  createBackgroundServices,
  toDegradedServices,
  ServiceInitError,
  type BackgroundServicesComposition,
  type DegradedBackgroundServices,
  type ServiceInitFailure,
} from './createBackgroundServices.js';
import { ServiceContainer } from './serviceContainer.js';
import { BADGE_COLORS } from '../constants/appConstants.js';
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
 *
 * Observable startup (PBI 2026-11-08-13): every phase fires exactly as
 * before (same calls, same initiation order, same per-phase error handling),
 * but each phase's completion is tracked and the returned promise resolves
 * with the per-phase results in startup-sequence order. A phase failure is
 * recorded as `{ ok: false }` instead of an unhandled rejection, so callers
 * (and tests) can observe completion and order without changing behavior.
 *
 * Phase-name lookup: each StartupPhase string is unique to one wiring site
 * in this file — search for the phase name (e.g. 'alarm-registry') to jump
 * from the phase list in init() below straight to the code that implements
 * it, and keep the name stable when renaming the underlying wiring.
 */
export type StartupPhase = 'allowed-urls-sync' | 'alarm-registry' | 'export-scheduler' | 'offscreen-host';

export type StartupPhaseResult =
  | { readonly phase: StartupPhase; readonly ok: true }
  | { readonly phase: StartupPhase; readonly ok: false; readonly message: string };

function trackStartupPhase(phase: StartupPhase, task: Promise<void>): Promise<StartupPhaseResult> {
  return task.then(
    () => ({ phase, ok: true as const }),
    (error) => ({ phase, ok: false as const, message: errorMessage(error) }),
  );
}

export function init(): Promise<readonly StartupPhaseResult[]> {
    const pending: Array<Promise<StartupPhaseResult>> = [];
    // Seed + live-sync the persisted FETCH_URL/provider allowlist from
    // settings. Runs before any request can read the key, so existing users
    // are migrated ahead of the fail-closed reader.
    pending.push(trackStartupPhase('allowed-urls-sync', initAllowedUrlsSync()));

    // All timed jobs (daily purge, local-md, offline retry, review-summary,
    // session-timeout) are unified under the registry's installAll() — static
    // schedules + conditional install hooks + uniform failure policy live in
    // alarmRegistry.ts's table. The session-timeout alarm is armed here and
    // nowhere else; arming it in two places would clear+create it twice.
    // Degraded: without the registry the phase is recorded as failed instead
    // of throwing — init() stays observable and the worker keeps running.
    pending.push(trackStartupPhase('alarm-registry', alarmRegistry !== undefined
      ? alarmRegistry.installAll()
      : Promise.reject(new Error('alarmRegistry unavailable (degraded startup; see startupFailures)'))));

    // PBI 2026-07-09-03 / 2026-07-10: schedule local Markdown export per LOCAL_MARKDOWN_EXPORT_TIMING
    pending.push(trackStartupPhase('export-scheduler', (async () => {
      try {
        const { initExportScheduler } = await import('./localMarkdownIdleFlusher.js');
        await initExportScheduler();
      } catch (err) {
        logError('Failed to init export scheduler', { error: errorMessage(err) }, ErrorCode.INTERNAL_ERROR, 'service-worker');
      }
    })()));

    // Firefox has no offscreen API: the background event page hosts the
    // storage engine itself and answers target:'offscreen' messages in-page.
    // Order matters — inject the event-page worker factory BEFORE importing
    // the offscreen host module (whose import registers the runtime listener
    // and keeps the engine resident). Build-time constant — dead on Chromium.
    if (import.meta.env.FIREFOX) {
      pending.push(trackStartupPhase('offscreen-host', (async () => {
        try {
          const { setOpfsWorkerFactory } = await import('../offscreen/sqliteEngineContext/opfsWorkerProxy.js');
          setOpfsWorkerFactory(() => new Worker(chrome.runtime.getURL('opfs-worker.js'), { type: 'module' }));
          // The Firefox worker bundle inlines its wasm as data: (unusable
          // under the extension CSP) — point the engine at the stable public
          // asset instead. Propagates to the worker via the INIT payload.
          // Dynamic import keeps the asset refs out of the Chromium
          // background graph (this branch is dead-code eliminated there).
          const { setSqliteWasmUrlOverride } = await import('../offscreen/sqliteBoot.js');
          const { WASM_ASSET_URLS } = await import('../offscreen/wasmAssets.js');
          setSqliteWasmUrlOverride(chrome.runtime.getURL(WASM_ASSET_URLS.idbEngineWasmPublicPath));
          await import('../offscreen/offscreen.js');
        } catch (err) {
          logError('Failed to start in-page offscreen host', { error: errorMessage(err) }, ErrorCode.INTERNAL_ERROR, 'service-worker');
        }
      })()));
    }
    return Promise.all(pending);
}

// ============================================================================
// Production composition root (degraded startup)
// ============================================================================
// A single throwing factory used to reject the whole composition here, failing
// the module load and crash-looping the Service Worker (Chrome re-runs the
// same deterministic factories on every restart). Startup is now degraded:
// this caller try/catches the aggregate throw, keeps the healthy services,
// and continues with an honestly-typed partial composition — every failed
// slot is `T | undefined` and each consumer below existence-checks it, so a
// missing service degrades its own path instead of crashing the worker (a
// silent undefined flow into an assuming consumer stays prohibited). Failures
// stay visible through one aggregate ERROR log plus a best-effort global
// badge (flagDegradedStartup).
export interface BackgroundStartup {
  readonly services: BackgroundServicesComposition | DegradedBackgroundServices;
  readonly failures: readonly ServiceInitFailure[];
  readonly unexpectedError: Error | undefined;
}

export function startBackgroundServices(container = new ServiceContainer()): BackgroundStartup {
  try {
    return { services: createBackgroundServices(container), failures: [], unexpectedError: undefined };
  } catch (error) {
    if (error instanceof ServiceInitError) {
      return { services: toDegradedServices(container), failures: error.failures, unexpectedError: undefined };
    }
    return {
      services: toDegradedServices(container),
      failures: [],
      unexpectedError: error instanceof Error ? error : new Error(errorMessage(error)),
    };
  }
}

const startup = startBackgroundServices();
const services = startup.services;
/** Aggregate factory failures of this startup (empty when healthy). */
export const startupFailures: readonly ServiceInitFailure[] = startup.failures;
/** Non-factory composition error, when the aggregate throw was not a ServiceInitError. */
export const startupUnexpectedError: Error | undefined = startup.unexpectedError;
export function isStartupDegraded(): boolean {
  return startupFailures.length > 0 || startupUnexpectedError !== undefined;
}

if (isStartupDegraded()) {
  void logError('Service worker starting in degraded mode: some background services failed to initialize', {
    failures: startupFailures.map((failure) => `${failure.key}: ${failure.message}`),
    ...(startupUnexpectedError !== undefined ? { unexpected: errorMessage(startupUnexpectedError) } : {}),
  }, ErrorCode.INTERNAL_ERROR, 'service-worker');
  void flagDegradedStartup();
}

/**
 * Best-effort degraded-mode badge: a global '!' marks the toolbar while any
 * service is missing. Diagnostic only — the failures are already in the
 * aggregate log above, so a badge write that itself fails (or an action API
 * without a badge surface, as in tests) is swallowed and startup continues.
 */
async function flagDegradedStartup(): Promise<void> {
  try {
    if (typeof globalThis.chrome === 'undefined' || chrome.action?.setBadgeText === undefined) return;
    await chrome.action.setBadgeText({ text: '!' });
    await chrome.action.setBadgeBackgroundColor?.({ color: BADGE_COLORS.ORANGE as string });
  } catch {
    // Diagnostic-only: ignore badge failures in degraded mode.
  }
}

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
const recordingAdmission = services.recordingAdmission;
export const rateLimiterForTest = rateLimiter;

// Session store for cross-SW-restart persistence
// Idempotent per store (the constructor already registers); skipped when the
// session store itself is the failed slot.
if (sessionStore !== undefined) {
  SessionStore.registerSuspendHandler(sessionStore);
}

// Initialize clients
if (headerDetector !== undefined) {
  void headerDetector.initialize().catch((error: unknown) => {
    void logError('HeaderDetector initialization failed', { error: errorMessage(error) }, ErrorCode.UNKNOWN_ERROR, 'service-worker');
  });
} else {
  void logWarn('HeaderDetector initialization skipped: service unavailable (degraded startup)', {}, ErrorCode.UNKNOWN_ERROR, 'service-worker');
}
if (rateLimiter !== undefined) {
  void rateLimiter.initialize().catch((error: unknown) => {
    void logError('RateLimiter initialization failed', { error: errorMessage(error) }, ErrorCode.UNKNOWN_ERROR, 'service-worker');
  });
} else {
  void logWarn('RateLimiter initialization skipped: service unavailable (degraded startup)', {}, ErrorCode.UNKNOWN_ERROR, 'service-worker');
}
const isCacheInitialized = createCacheInitializedFlag();

export function resetManualRecordCache(): void {
    // No cache exists when the fetcher slot failed; the degraded startup log
    // already names it, so there is nothing to clear here.
    if (manualContentFetcher !== undefined) {
      manualContentFetcher.clear();
    }
}

// Extracted modules (PBI 2026-09-15-17: resolved via the manifest)
// Degraded: without the runner there is no deferred migration to run —
// checkEnvelope tolerates a no-op runner, so message flow keeps working.
const runDeferredStartupMigrations: () => Promise<void> = deferredMigrationRunner ?? (async (): Promise<void> => {
  await logWarn('Deferred startup migrations skipped: service unavailable (degraded startup)', {}, ErrorCode.UNKNOWN_ERROR, 'service-worker');
});

// Individual handlers are exposed via the router's observable accessor —
// no cast into private state. Used by tests and the context-menu path.
// Degraded: without the router every handler is undefined and its callers
// existence-check it (the context-menu wrapper returns early; the message
// handler answers with an explicit degraded error below).
export const handleValidVisit = messageRouter?.getHandler('VALID_VISIT');
export const handleFetchUrl = messageRouter?.getHandler('FETCH_URL');
export const handleManualRecord = messageRouter?.getHandler('MANUAL_RECORD');
export const handlePreviewRecord = messageRouter?.getHandler('PREVIEW_RECORD');
export const handleSaveRecord = messageRouter?.getHandler('SAVE_RECORD');
export const handleContentCleansingExecuted = messageRouter?.getHandler('CONTENT_CLEANSING_EXECUTED');
export const handleCheckDomain = messageRouter?.getHandler('CHECK_DOMAIN');
export const handleTestConnections = messageRouter?.getHandler('TEST_CONNECTIONS');
export const handleTestObsidian = messageRouter?.getHandler('TEST_OBSIDIAN');
export const handleTestAi = messageRouter?.getHandler('TEST_AI');
export const handleGetPrivacyCache = messageRouter?.getHandler('GET_PRIVACY_CACHE');
export const handleActivityUpdate = messageRouter?.getHandler('ACTIVITY_UPDATE');
export const handleSessionLockRequest = messageRouter?.getHandler('SESSION_LOCK_REQUEST');
export const handlePing = messageRouter?.getHandler('PING');
export const handleRefreshLocalMarkdownScheduler = messageRouter?.getHandler('REFRESH_LOCAL_MARKDOWN_SCHEDULER');
export const handleConsentStateChanged = messageRouter?.getHandler('CONSENT_STATE_CHANGED');
export const handleGenerateReviewSummary = messageRouter?.getHandler('GENERATE_REVIEW_SUMMARY');
export const handleLogForward = messageRouter?.getHandler('LOG_FORWARD');
export const handleDashboardSqlite = messageRouter?.getHandler('DASHBOARD_SQLITE');

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
// Degraded: without the tab cache (or its badge-tab restore collaborator) no
// tab wiring can run — the exports fall back to no-ops so listener
// registration below never receives undefined, and tab events are dropped
// silently (the degraded startup log already names the missing service).
const _tabHandlers = tabCache !== undefined && autoSavedBadgeTabs !== undefined
  ? createTabEventHandlers({
    tabCache,
    autoSavedBadgeTabs,
    getPrivacyCache: () => services.recordingCache?.getPrivacyCache() ?? null,
    isRecordingAllowed: () => hasPrivacyConsent(),
  })
  : undefined;
export const handleTabRemoved: (tabId: number) => Promise<void> = _tabHandlers?.handleTabRemoved ?? (async (): Promise<void> => {});
export const handleTabActivated: (activeInfo: { tabId: number }) => Promise<void> = _tabHandlers?.handleTabActivated ?? (async (): Promise<void> => {});
export const handleTabUpdated: (tabId: number, changeInfo: { status?: string }, tab: { url?: string }) => Promise<void> = _tabHandlers?.handleTabUpdated ?? (async (): Promise<void> => {});

// ============================================================================
// Lifecycle Handlers
// ============================================================================
// Degraded: without the rate limiter or the sqlite client no lifecycle wiring
// can run — same no-op fallback discipline as the tab handlers above.
const _lifecycleHandlers = rateLimiter !== undefined && sqliteClient !== undefined
  ? createLifecycleHandlers({ isCacheInitialized, rateLimiter, sqliteClient, recordingCache: services.recordingCache ?? null })
  : undefined;
export const handleInstalled: (details: chrome.runtime.InstalledDetails) => Promise<void> = _lifecycleHandlers?.handleInstalled ?? (async (): Promise<void> => {});
export const handleStartup: () => Promise<void> = _lifecycleHandlers?.handleStartup ?? (async (): Promise<void> => {});

// ============================================================================
// Notification Handlers
// ============================================================================
export { isValidNotificationUrl } from './handlers/notificationHandlers.js';
// Notifications carry no MessageSender; the admission pre-stage only narrows
// the sender inside its rate branch, and kind 'save' is not counter-limited
// (KIND_RATE_BUCKET.save === null), so the empty sender is never read.
const NOTIFICATION_SENDER: chrome.runtime.MessageSender = {};
const _notificationHandlers = recordingPipeline !== undefined && recordingAdmission !== undefined
  ? createNotificationHandlers({
    record: (data) => recordingPipeline.record(data),
    // PBI 2026-10-18-04: the notification Save path runs the same
    // RecordingAdmission singleton as the registry routes (messageRouter
    // resolves the same manifest entry). A withdrawn consent is refused with
    // privacy_consent_required before any record, like every other path.
    admit: (kind) => recordingAdmission.admit(kind, NOTIFICATION_SENDER),
  })
  : undefined;
export const handleNotificationButtonClicked: (notificationId: string, buttonIndex: number) => Promise<void> = _notificationHandlers?.onButtonClicked ?? (async (): Promise<void> => {});
export const handleNotificationClicked: (notificationId: string) => void = _notificationHandlers?.onClicked ?? ((): void => {});

// ============================================================================
// Session Reminder Notification Handlers (PBI 2026-10-22-04 O2/O4)
// ============================================================================
// The reminder notifications carry their own prefix (session-reminder-), so a
// second handler set routes the click (open record + Daily Note TODO) and the
// dismiss/discard buttons. The privacy-confirm handler above keeps its own
// prefix; a chrome.notifications event reaches both listeners and each one
// guards its own prefix.
const _sessionReminderClickHandlers = createSessionReminderClickHandlers({
  queryRecordById: async (recordId) => {
    // Degraded: without sqlite there is no record to open; the click handler
    // already tolerates null (nothing visible happens).
    if (sqliteClient === undefined) return null;
    const result = await sqliteClient.query({ ids: [recordId], limit: 1 });
    if (!result.success) return null;
    const row = result.data.rows[0];
    // Fail-closed: a row without a numeric id is not a real DB row.
    if (row === undefined || typeof row.id !== 'number') return null;
    return { id: row.id, url: row.url, title: row.title ?? null, masked_count: row.masked_count ?? null };
  },
  openTab: (url) => {
    void chrome.tabs.create({ url }).catch((error: unknown) => {
      void logError('Failed to open the reminder record tab', { error: errorMessage(error) }, ErrorCode.INTERNAL_ERROR, 'service-worker');
    });
  },
  dismissNotification: (notificationId) => {
    void chrome.notifications.clear(notificationId).catch((error: unknown) => {
      void logWarn('Failed to clear the reminder notification', { notificationId, error: errorMessage(error) }, ErrorCode.UNKNOWN_ERROR, 'service-worker');
    });
  },
  // The noteSectionEditor seam: appendToDailyNote runs
  // NoteSectionEditor.insertIntoSection under the shared write mutex, so the
  // TODO line joins the existing section instead of stacking a copy.
  // Degraded: without obsidian the TODO has nowhere to go — log and skip
  // (the degraded startup log already names the missing service).
  appendTodoToDailyNote: (todoLine) => {
    if (services.obsidian === undefined) {
      return (async (): Promise<void> => {
        await logWarn('Skipping reminder TODO append: obsidian service unavailable (degraded startup)', {}, ErrorCode.UNKNOWN_ERROR, 'service-worker');
      })();
    }
    return services.obsidian.appendToDailyNote(todoLine, 'session-reminder-todo');
  },
});
export const handleReminderNotificationClicked = _sessionReminderClickHandlers.onClicked;
export const handleReminderNotificationButtonClicked = _sessionReminderClickHandlers.onButtonClicked;

// ============================================================================
// Context Menu
// ============================================================================
export const registerManualRecordContextMenu = _registerManualRecordContextMenu;
const _contextClickHandler = createContextClickHandler({ handleManualRecord: handleManualRecordForContextMenu });

// ============================================================================
// Omnibox + Keyboard Command (PBI 2026-10-23-07)
// ============================================================================
// The omnibox and the keyboard command ride the same recordTabContent core
// as the context menu; the confirmation notification carries the page title.
const _entryFrictionDeps = {
  recordTabContent: { handleManualRecord: handleManualRecordForContextMenu },
};
const _keyboardCommandHandler = createKeyboardCommandHandler(_entryFrictionDeps);
const _omniboxInputHandler = createOmniboxInputHandler(_entryFrictionDeps);
export { _keyboardCommandHandler, _omniboxInputHandler };

const handleAlarm = alarmRegistry?.handleAlarm;

// Re-export createMessageHandler for backward compatibility with tests
// that call it without arguments.
export function createMessageHandler(): (
    rawMessage: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
) => boolean {
    // Degraded: without the router (or its cache/restore collaborators) no
    // message can be dispatched — answer with an explicit error instead of
    // crashing the listener, so senders observe the outage.
    if (messageRouter === undefined || tabCache === undefined || autoSavedBadgeTabs === undefined) {
      return (_rawMessage: unknown, _sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void): boolean => {
        sendResponse({ success: false, error: 'Service worker is running in degraded mode: message router unavailable' });
        return false;
      };
    }
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

    // PBI 2026-10-23-07: omnibox + keyboard command record the active tab
    // without opening the dashboard (permission-free manifest keys).
    if (chrome.commands?.onCommand) {
      chrome.commands.onCommand.addListener(guard(_keyboardCommandHandler, 'keyboardCommand'));
    }
    if (chrome.omnibox?.onInputEntered) {
      chrome.omnibox.onInputEntered.addListener(guard((text: string) => _omniboxInputHandler(text), 'omniboxInput'));
    }

    chrome.notifications.onButtonClicked.addListener(guard((notificationId: string, buttonIndex: number) => {
      // Two listeners share the event; each guards its own prefix. The
      // privacy-confirm handler ignores the reminder prefix and vice versa.
      handleNotificationButtonClicked(notificationId, buttonIndex);
      void handleReminderNotificationButtonClicked(notificationId, buttonIndex);
    }, 'notificationButtonClicked'));
    chrome.notifications.onClicked.addListener(guard((notificationId: string) => {
      handleNotificationClicked(notificationId);
      void handleReminderNotificationClicked(notificationId);
    }, 'notificationClicked'));

    // Degraded: without the registry there is no alarm dispatch to wire.
    if (handleAlarm !== undefined) {
      chrome.alarms.onAlarm.addListener(guard(handleAlarm, 'handleAlarm'));
    }
}
