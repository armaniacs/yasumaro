/**
 * compositionManifest.ts
 * Declarative registration list for the Service Worker composition root.
 *
 * Each entry is one line: `{ key, factory, singleton?, onReady? }`.
 * `createBackgroundServices` loops this list and calls `container.register`
 * for every key not already present (so tests can `override()` first).
 *
 * Adding a background dependency is one entry here — no touching a manual
 * `register()` block, a keys union, or a subset-check type.
 *
 * `onReady` runs once after every service is resolved: it is where
 * side-effect wiring that crosses the utils↔background layer boundary
 * (sqliteClient health probe) is localized, instead of
 * being scattered through the composition function body.
 */

import { createAIService } from './ai/aiServiceFactory.js';
import { RemoteAIService } from './ai/RemoteAIService.js';
import type { AIService } from './ai/AIService.js';
import { ProviderBreaker } from './ai/providerBreaker.js';
import { ObsidianClient } from './obsidianClient.js';
import { getSharedSqliteClient } from './sqlite/offscreenGateway.js';
import type { SqliteClient } from './sqlite/offscreenGateway.js';
import { RecordingCacheInstance, SessionStoreRecordingCacheStore } from './recordingCache.js';
import { TabCache } from './tabCache.js';
import { RateLimiter } from './rateLimiter.js';
import { ManualContentFetcher } from './manualContentFetcher.js';
import { SessionStore, type SessionStorePort } from './sessionStore.js';
import { HeaderDetector } from './headerDetector.js';
import { createPendingWriteQueue, setPendingWriteQueue } from './pendingChromeStorageQueue.js';
import { ChromeStorageAdapter } from './persistentRetryQueue.js';
import { createRecordingOrchestrator, type RecordingOrchestrator } from './pipeline/RecordingOrchestrator.js';
import { createOfflineNetworkQueue, setOfflineNetworkQueue, sharedOfflineNetworkQueue, type OfflineNetworkQueue } from './offlineNetworkQueue.js';
import { createPendingSqliteQueue, setPendingSqliteQueue } from './pendingSqliteQueue.js';
import { setObsidianClient } from './handlers/dashboardSqlite/deps.js';
import { createReviewSummaryGenerator } from './reviewSummaryGenerator.js';
import { createAutoSavedBadgeTabs } from './swStatePersistence.js';
import { createDashboardSqliteMessageHandler } from './dashboardSqliteWiring.js';
import { createConfirmToken, verifyConfirmToken } from './confirmTokenManager.js';
import { hasPrivacyConsent } from '../utils/storage/privacyConsent.js';
import { lockSession } from '../utils/storage/encryptionSession.js';
import { buildAllowedUrls } from '../utils/storage/urlWhitelist.js';
import { getSavedUrlsWithTimestamps, saveSavedUrlEntryMetadata } from '../utils/storage/savedUrlRepository.js';
import { isDomainAllowed } from '../utils/domainUtils.js';
import { notifyAiTestProgress } from './aiTestProgressNotifier.js';
import { updateActivity } from './sessionAlarmsManager.js';
import { createMessageRouter, type MessageRouterDeps } from './handlers/MessageRouter.js';
import type { MessageHandler } from './handlers/MessageRouter.js';
import { RecordingAdmission } from './recordingAdmission.js';
import { RegenerateContentFetcher } from './regenerateContentFetcher.js';
import type { ReviewSummaryGenerator } from './reviewSummaryGenerator.js';
import type { AutoSavedBadgeTabs } from './swStatePersistence.js';
import { retryPendingChromeStorageWrite } from './retryPendingWrites.js';
import { settingsRepository, type SettingsRepository } from '../utils/storage/SettingsRepository.js';
import { PerUrlMutexMap } from './pipeline/perUrlMutex.js';
import { SessionAlarmService } from './SessionAlarmService.js';
import { createDeferredMigrationRunner } from './deferredMigrations.js';
import { createAlarmRegistry } from './alarmRegistry.js';
import type { ServiceContainer } from './serviceContainer.js';

export interface CompositionEntry {
  key: string;
  factory: (c: ServiceContainer) => unknown;
  singleton: boolean;
  /** Side-effect wiring run once after all services are resolved. */
  onReady?: (c: ServiceContainer) => void;
}

// Content backfill must not reorder LRU, so the timestamp is left alone. One
// closure is shared by both recording handlers instead of being rebuilt per
// handler.
const setUrlContent = async (url: string, content: string): Promise<void> => {
  await saveSavedUrlEntryMetadata(url, { content }, { refreshTimestamp: false, createIfMissing: false });
};

export const compositionManifest: readonly CompositionEntry[] = [
  { key: 'sessionStore', singleton: true, factory: () => new SessionStore() },
  {
    key: 'recordingCache',
    singleton: true,
    factory: (c) => {
      const rc = new RecordingCacheInstance(new SessionStoreRecordingCacheStore(c.resolve<SessionStore>('sessionStore')));
      rc.ensureStorageListener?.();
      return rc;
    },
  },
  { key: 'headerDetector', singleton: true, factory: (c) => new HeaderDetector(c.resolve<RecordingCacheInstance>('recordingCache')) },
  { key: 'obsidian', singleton: true, factory: () => new ObsidianClient() },
  { key: 'sqliteClient', singleton: true, factory: () => getSharedSqliteClient() },
  { key: 'tabCache', singleton: true, factory: (c) => new TabCache(c.resolve<SessionStorePort>('sessionStore')) },
  { key: 'rateLimiter', singleton: true, factory: (c) => new RateLimiter(c.resolve<SessionStorePort>('sessionStore')) },
  { key: 'manualContentFetcher', singleton: true, factory: () => new ManualContentFetcher() },
  {
    key: 'regenerateContentFetcher',
    singleton: true,
    factory: () =>
      new RegenerateContentFetcher({
        createTab: (props) => chrome.tabs.create(props),
        removeTab: (tabId) => chrome.tabs.remove(tabId),
        sendMessage: (tabId, message) => chrome.tabs.sendMessage(tabId, message),
        getTab: (tabId) => chrome.tabs.get(tabId),
        onUpdated: {
          addListener: (cb) => chrome.tabs.onUpdated.addListener(cb),
          removeListener: (cb) => chrome.tabs.onUpdated.removeListener(cb),
        },
      }),
  },
  { key: 'remoteAiService', singleton: true, factory: (c) => new RemoteAIService({ breaker: c.resolve<ProviderBreaker>('aiProviderBreaker') }) },
  // PBI 27-03: AI provider circuit breaker (policy SSOT in providerBreaker.ts).
  // Resolved here so the wiring test — not just a direct import — proves it.
  { key: 'aiProviderBreaker', singleton: true, factory: (c) => new ProviderBreaker(c.resolve<SessionStorePort>('sessionStore')) },
  { key: 'aiService', singleton: true, factory: (c) => createAIService({ remoteAiService: c.resolve<RemoteAIService>('remoteAiService') }) },
  { key: 'settingsRepository', singleton: true, factory: () => settingsRepository },
  { key: 'perUrlMutexMap', singleton: true, factory: () => new PerUrlMutexMap() },
  {
    key: 'pendingWriteQueue',
    singleton: true,
    factory: () => createPendingWriteQueue(new ChromeStorageAdapter()),
    // The facade in pendingChromeStorageQueue.ts serves callers that bypass
    // DI; without this wiring the facade would lazily build a SECOND queue
    // over the same storage key with its own lock chain (lost-update shape).
    onReady: (c) => setPendingWriteQueue(c.resolve<ReturnType<typeof createPendingWriteQueue>>('pendingWriteQueue')),
  },
  {
    key: 'pendingSqliteQueue',
    singleton: true,
    factory: () => createPendingSqliteQueue(new ChromeStorageAdapter()),
    // Same facade seam as pendingWriteQueue: layer-crossing callers use the
    // module facade, and this wiring makes it the container instance.
    onReady: (c) => setPendingSqliteQueue(c.resolve<ReturnType<typeof createPendingSqliteQueue>>('pendingSqliteQueue')),
  },
  {
    key: 'offlineNetworkQueue',
    singleton: true,
    factory: () => createOfflineNetworkQueue(new ChromeStorageAdapter()),
    // Same facade seam: the shared instance becomes the container instance.
    onReady: (c) => setOfflineNetworkQueue(c.resolve<OfflineNetworkQueue>('offlineNetworkQueue')),
  },
  {
    key: 'reviewSummaryGenerator',
    singleton: true,
    factory: (c) => createReviewSummaryGenerator({
      aiService: c.resolve<AIService>('aiService'),
      sqliteClient: c.resolve<SqliteClient>('sqliteClient'),
    }),
  },
  {
    key: 'recordingPipeline',
    singleton: true,
    factory: (c) => {
      const rc = c.resolve<RecordingCacheInstance>('recordingCache');
      return createRecordingOrchestrator({
        getPrivacyInfoWithCache: (url: string) => rc.getPrivacyInfoWithCache(url),
        getSettingsWithCache: () => rc.getSettingsWithCache(),
        obsidian: c.resolve<ObsidianClient>('obsidian'),
        aiService: c.resolve<AIService>('aiService'),
        sqliteClient: c.resolve<SqliteClient>('sqliteClient'),
        urlStore: { getSavedUrlsWithTimestamps },
        offlineNetworkQueue: c.resolve<OfflineNetworkQueue>('offlineNetworkQueue'),
        // Shared per-URL mutex map: all recordings serialize on the same URL
        // regardless of how many orchestrator instances exist. Without this the
        // orchestrator falls back to a private map and cross-instance
        // serialization is lost (duplicate-entry race).
        perUrlMutexMap: c.resolve<PerUrlMutexMap>('perUrlMutexMap'),
      });
    },
  },
  {
    key: 'dashboardSqliteHandler',
    singleton: true,
    factory: (c) => createDashboardSqliteMessageHandler({
      sqliteClient: c.resolve<SqliteClient>('sqliteClient'),
      createConfirmToken,
      verifyConfirmToken,
    }),
    // The append path uses the manifest's obsidian singleton (no per-call new).
    onReady: (c) => setObsidianClient(c.resolve<ObsidianClient>('obsidian')),
  },
  {
    key: 'autoSavedBadgeTabs',
    singleton: true,
    // PBI 2026-09-12-24: prune stale tab IDs on restore — tab IDs closed
    // while the SW was down must not survive as "recorded" markers.
    factory: () =>
      createAutoSavedBadgeTabs({
        exists: async (tabId) => {
          try {
            const tab = await chrome.tabs.get(tabId);
            return tab?.id !== undefined;
          } catch {
            return false;
          }
        },
      }),
  },
  {
    key: 'sessionAlarmService',
    singleton: true,
    // The alarm itself is created here, but creation and dispatch are owned by
    // the registry: this service only computes whether the session timed out.
    factory: () => new SessionAlarmService(),
  },
  {
    key: 'deferredMigrationRunner',
    singleton: true,
    factory: (c) => createDeferredMigrationRunner(c.resolve<SqliteClient>('sqliteClient')),
  },
  {
    key: 'alarmRegistry',
    singleton: true,
    // The unified alarm seam — install hooks + handleAlarm cover daily purge,
    // local-md, offline retry, review-summary, and session-timeout. Every dep
    // resolves from this container so the alarm path observes the same shared
    // instances as the message paths.
    factory: (c) => {
      return createAlarmRegistry({
        sqliteClient: c.resolve<SqliteClient>('sqliteClient'),
        recordingPipeline: c.resolve<RecordingOrchestrator>('recordingPipeline'),
        getOfflineNetworkQueue: () => sharedOfflineNetworkQueue,
        retryPendingChromeStorageWrite,
        settingsReader: c.resolve<SettingsRepository>('settingsRepository'),
        reviewSummaryGenerator: c.resolve<ReviewSummaryGenerator>('reviewSummaryGenerator'),
        sessionAlarmService: c.resolve<SessionAlarmService>('sessionAlarmService'),
      });
    },
  },
  {
    key: 'recordingAdmission',
    singleton: true,
    // PBI 03: the recording pre-stage (consent → settings → sender narrow →
    // rate) is one shared module. The RateLimiter counter is its internal
    // adapter; the three handler dep objects collapsed into this single entry.
    factory: (c) => new RecordingAdmission({
      isRecordingAllowed: () => hasPrivacyConsent(),
      getSettings: () => settingsRepository.getAll(),
      rateLimiter: c.resolve<RateLimiter>('rateLimiter'),
    }),
  },
  {
    key: 'messageRouter',
    singleton: true,
    factory: (c) => {
      const recordingPipeline = c.resolve<RecordingOrchestrator>('recordingPipeline');
      const tabCache = c.resolve<TabCache>('tabCache');
      const recordingCache = c.resolve<RecordingCacheInstance>('recordingCache');
      const reviewSummaryGenerator = c.resolve<ReviewSummaryGenerator>('reviewSummaryGenerator');
      const messageRouterDeps: MessageRouterDeps = {
        // Forward opts too: manual/save/regenerate pass { settings } through
        // the same seam (VALID_VISIT passes none).
        recordingPipeline: { record: (data, opts) => recordingPipeline.record(data, opts) },
        tabCache: { add: (tab) => tabCache.add(tab), update: (tabId, data) => tabCache.update(tabId, data) },
        obsidian: c.resolve<ObsidianClient>('obsidian'),
        aiService: c.resolve<AIService>('aiService'),
        recordingAdmission: c.resolve<RecordingAdmission>('recordingAdmission'),
        fetchManualContent: (url: string) => c.resolve<ManualContentFetcher>('manualContentFetcher').fetchContent(url),
        fetchRegenerated: (url, cleanseMode) =>
          c.resolve<RegenerateContentFetcher>('regenerateContentFetcher').fetchExtracted(url, cleanseMode),
        setUrlContent,
        buildAllowedUrls: (settings) => buildAllowedUrls(settings),
        getSettings: () => settingsRepository.getAll(),
        isDomainAllowed: (url) => isDomainAllowed(url),
        clearSettingsCache: () => settingsRepository.clearCache(),
        notifyAiTestProgress,
        getPrivacyCache: () => recordingCache.getPrivacyCache(),
        updateActivity: () => updateActivity(),
        lockSession: () => lockSession(),
        autoSavedBadgeTabs: c.resolve<AutoSavedBadgeTabs>('autoSavedBadgeTabs'),
        initExportScheduler: async () => {
          const { initExportScheduler } = await import('./localMarkdownIdleFlusher.js');
          await initExportScheduler();
        },
        updateConsentBadge: async () => {
          const { updateConsentBadge } = await import('./consentBadge.js');
          await updateConsentBadge();
        },
        generateWeeklySummary: () => reviewSummaryGenerator.generateWeeklySummary(),
        generateMonthlySummary: () => reviewSummaryGenerator.generateMonthlySummary(),
        dashboardSqliteHandler: c.resolve<MessageHandler>('dashboardSqliteHandler'),
      };
      return createMessageRouter(messageRouterDeps);
    },
  },
];
