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
 * (setPendingWriteQueue / setSqliteHealthCheck) is localized, instead of
 * being scattered through the composition function body.
 */

import { createAIService } from './ai/aiServiceFactory.js';
import { RemoteAIService } from './ai/RemoteAIService.js';
import type { AIService } from './ai/AIService.js';
import { ObsidianClient } from './obsidianClient.js';
import { getSharedSqliteClient } from './sqliteClient.js';
import type { SqliteClient } from './sqliteClient.js';
import { setSqliteHealthCheck } from '../utils/storage/storageMaintenance.js';
import { RecordingCacheInstance, SessionStoreRecordingCacheStore } from './recordingCache.js';
import { TabCache } from './tabCache.js';
import { RateLimiter } from './rateLimiter.js';
import { ManualContentFetcher } from './manualContentFetcher.js';
import { SessionStore } from './sessionStore.js';
import { HeaderDetector } from './headerDetector.js';
import { createPendingWriteQueue, setPendingWriteQueue } from './pendingChromeStorageQueue.js';
import { ChromeStorageAdapter } from './persistentRetryQueue.js';
import { createRecordingPipeline } from './pipeline/RecordingPipeline.js';
import { sharedOfflineNetworkQueue } from './offlineNetworkQueue.js';
import { createReviewSummaryGenerator } from './reviewSummaryGenerator.js';
import { createAutoSavedBadgeTabs } from './swStatePersistence.js';
import { createDashboardSqliteMessageHandler } from './dashboardSqliteWiring.js';
import { ensureConfirmToken, createConfirmToken, verifyConfirmToken } from './confirmTokenManager.js';
import { hasPrivacyConsent } from '../popup/privacyConsent.js';
import { lockSession } from '../utils/storage/encryptionSession.js';
import { buildAllowedUrls } from '../utils/storage/urlWhitelist.js';
import { getSavedUrlsWithTimestamps, saveSavedUrlEntryMetadata } from '../utils/storage/savedUrlRepository.js';
import { isDomainAllowed } from '../utils/domainUtils.js';
import { notifyAiTestProgress } from './aiTestProgressNotifier.js';
import { updateActivity } from './sessionAlarmsManager.js';
import { createMessageRouter, type MessageRouterDeps } from './handlers/MessageRouter.js';
import type { MessageHandler } from './handlers/MessageRouter.js';
import type { ManualRecordHandlerDeps, SaveRecordHandlerDeps } from './handlers/recordingHandlers.js';
import type { ReviewSummaryGenerator } from './reviewSummaryGenerator.js';
import type { AutoSavedBadgeTabs } from './swStatePersistence.js';
import { SettingsRepository, ChromeStorageAdapter as SettingsChromeStorageAdapter, settingsRepository } from '../utils/storage/SettingsRepository.js';
import { PerUrlMutexMap } from './pipeline/perUrlMutex.js';
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
  {
    key: 'sqliteClient',
    singleton: true,
    factory: () => getSharedSqliteClient(),
    // utils→background boundary wiring: storageMaintenance's legacy-cleanup
    // needs a SQLite health probe. Declared here so the cross-layer call is
    // next to the registration, not scattered through the composition body.
    onReady: (c) => {
      const sqliteClient = c.resolve<SqliteClient>('sqliteClient');
      setSqliteHealthCheck(async () => {
        const r = await sqliteClient.maintain({ type: 'healthCheck' });
        return r.success ? Boolean(r.data) : false;
      });
    },
  },
  { key: 'tabCache', singleton: true, factory: (c) => new TabCache(c.resolve<SessionStore>('sessionStore')) },
  { key: 'rateLimiter', singleton: true, factory: (c) => new RateLimiter(c.resolve<SessionStore>('sessionStore')) },
  { key: 'manualContentFetcher', singleton: true, factory: () => new ManualContentFetcher() },
  { key: 'remoteAiService', singleton: true, factory: () => new RemoteAIService() },
  { key: 'aiService', singleton: true, factory: (c) => createAIService({ remoteAiService: c.resolve<RemoteAIService>('remoteAiService') }) },
  { key: 'settingsRepository', singleton: true, factory: () => new SettingsRepository(new SettingsChromeStorageAdapter()) },
  { key: 'perUrlMutexMap', singleton: true, factory: () => new PerUrlMutexMap() },
  {
    key: 'pendingWriteQueue',
    singleton: true,
    factory: () => createPendingWriteQueue(new ChromeStorageAdapter()),
    onReady: (c) => setPendingWriteQueue(c.resolve<ReturnType<typeof createPendingWriteQueue>>('pendingWriteQueue')),
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
      return createRecordingPipeline({
        getPrivacyInfoWithCache: (url: string) => rc.getPrivacyInfoWithCache(url),
        getSettingsWithCache: () => rc.getSettingsWithCache(),
        obsidian: c.resolve<ObsidianClient>('obsidian'),
        aiService: c.resolve<AIService>('aiService'),
        sqliteClient: c.resolve<SqliteClient>('sqliteClient'),
        urlStore: { getSavedUrlsWithTimestamps },
        offlineNetworkQueue: sharedOfflineNetworkQueue,
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
      ensureConfirmToken,
      createConfirmToken,
      verifyConfirmToken,
    }),
  },
  { key: 'autoSavedBadgeTabs', singleton: true, factory: () => createAutoSavedBadgeTabs() },
  {
    key: 'manualRecordDeps',
    singleton: true,
    factory: (c) => ({
      isRecordingAllowed: () => hasPrivacyConsent(),
      checkRateLimit: (sender, settings) => c.resolve<RateLimiter>('rateLimiter').check(sender as never, settings as never),
      fetchContent: (url: string) => c.resolve<ManualContentFetcher>('manualContentFetcher').fetchContent(url),
      recordingPipeline: c.resolve('recordingPipeline'),
      getSettings: () => settingsRepository.getAll(),
      setUrlContent,
    } as ManualRecordHandlerDeps),
  },
  {
    key: 'saveRecordDeps',
    singleton: true,
    factory: (c) => ({
      isRecordingAllowed: () => hasPrivacyConsent(),
      recordingPipeline: c.resolve('recordingPipeline'),
      getSettings: () => settingsRepository.getAll(),
      setUrlContent,
    } as SaveRecordHandlerDeps),
  },
  {
    key: 'messageRouter',
    singleton: true,
    factory: (c) => {
      const recordingPipeline = c.resolve<import('./pipeline/RecordingPipeline.js').RecordingPipeline>('recordingPipeline');
      const tabCache = c.resolve<TabCache>('tabCache');
      const recordingCache = c.resolve<RecordingCacheInstance>('recordingCache');
      const reviewSummaryGenerator = c.resolve<ReviewSummaryGenerator>('reviewSummaryGenerator');
      const messageRouterDeps: MessageRouterDeps = {
        recordingPipeline: { record: (data) => recordingPipeline.record(data) },
        tabCache: { add: (tab) => tabCache.add(tab), update: (tabId, data) => tabCache.update(tabId, data) },
        obsidian: c.resolve<ObsidianClient>('obsidian'),
        aiService: c.resolve<AIService>('aiService'),
        manualRecordDeps: c.resolve<ManualRecordHandlerDeps>('manualRecordDeps'),
        saveRecordDeps: c.resolve<SaveRecordHandlerDeps>('saveRecordDeps'),
        hasPrivacyConsent: () => hasPrivacyConsent(),
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
