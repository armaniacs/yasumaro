/**
 * createBackgroundServices
 * Production composition root for the Service Worker's long-lived collaborators.
 *
 * service-worker.ts constructs every singleton through this module (shared
 * SqliteClient via getSharedSqliteClient, one shared RecordingPipeline, and the
 * manual/save handler dependency objects), so manual record, context menu, and
 * message paths observe the same references instead of rebuilding per message.
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
import { createRecordingPipeline, buildRecordingPipelineDeps } from './pipeline/RecordingPipeline.js';
import type { RecordingPipeline } from './pipeline/RecordingPipeline.js';
import { sharedOfflineNetworkQueue } from './offlineNetworkQueue.js';
import { createReviewSummaryGenerator } from './reviewSummaryGenerator.js';
import type { ReviewSummaryGenerator } from './reviewSummaryGenerator.js';
import { createAutoSavedBadgeTabs, type AutoSavedBadgeTabs } from './swStatePersistence.js';
import { createDashboardSqliteMessageHandler } from './dashboardSqliteWiring.js';
import { ensureConfirmToken } from './confirmTokenManager.js';
import { hasPrivacyConsent } from '../popup/privacyConsent.js';
import { lockSession } from '../utils/storage/encryptionSession.js';
import { getSettings, buildAllowedUrls, clearSettingsCache } from '../utils/storage/settingsStore.js';
import { getSavedUrlsWithTimestamps, saveSavedUrlEntryMetadata } from '../utils/storage/savedUrlRepository.js';
import { isDomainAllowed } from '../utils/domainUtils.js';
import { notifyAiTestProgress } from './aiTestProgressNotifier.js';
import { updateActivity } from './sessionAlarmsManager.js';
import { createMessageRouter, type MessageRouter, type MessageRouterDeps } from './handlers/MessageRouter.js';
import type { MessageHandler } from './handlers/MessageRouter.js';
import type { ManualRecordHandlerDeps, SaveRecordHandlerDeps } from './handlers/recordingHandlers.js';
import { ServiceContainer } from './serviceContainer.js';

export interface BackgroundServices {
  obsidian: ObsidianClient;
  sqliteClient: SqliteClient;
  /** Shared RecordingPipeline; owns per-URL mutex, settings fetch, and step execution. */
  recordingPipeline: RecordingPipeline;
  tabCache: TabCache;
  rateLimiter: RateLimiter;
  manualContentFetcher: ManualContentFetcher;
  /**
   * The AIService composition root.
   *
   * Previously accessed through AIClient (ADR 2026-07-27); now created
   * directly via createAIService with a shared RemoteAIService instance.
   */
  aiService: AIService;
  sessionStore: SessionStore;
  headerDetector: HeaderDetector;
  /** Shared RecordingCache instance used by all cache consumers (PBI-03). */
  recordingCache: RecordingCacheInstance;
  /**
   * Shared weekly/monthly review summary generator.
   *
   * Built once here (deep-dig 子PBI 5) so the alarm path and the
   * GENERATE_REVIEW_SUMMARY message path share one instance instead of each
   * constructing its own AIService.
   */
  reviewSummaryGenerator: ReviewSummaryGenerator;
}

/**
 * Composition result consumed by service-worker.ts. The extra members exist so
 * the production wiring and the composition contract test observe one shared
 * RecordingPipeline and one shared SqliteClient across every recording path.
 * popup and Dashboard code never see this type.
 */
export interface BackgroundServicesComposition extends BackgroundServices {
  dashboardSqliteClient: SqliteClient;
  manualRecordDeps: ManualRecordHandlerDeps;
  saveRecordDeps: SaveRecordHandlerDeps;
  messageRouter: MessageRouter;
  dashboardSqliteHandler: MessageHandler;
  autoSavedBadgeTabs: AutoSavedBadgeTabs;
}

// PBI#04: 静的保証 — BackgroundServices のコアフィールドが MessageRouterDeps の
// サブセットとして代入可能であることをコンパイル時に検証。
// もし BackgroundServices の型が router 側の Pick より狭すぎる/広すぎる場合、ここで型エラーになる。
type _CoreServicesSubsetCheck = Pick<BackgroundServices, 'obsidian' | 'tabCache' | 'recordingPipeline' | 'aiService'> extends Pick<
  MessageRouterDeps,
  'obsidian' | 'tabCache' | 'recordingPipeline' | 'aiService'
>
  ? true
  : never;
const _subsetCheck: _CoreServicesSubsetCheck = true as const;
void _subsetCheck;

export function createBackgroundServices(container = new ServiceContainer()): BackgroundServicesComposition {
  // Register core singletons in the container — adding a dependency is one register() call
  // instead of touching BackgroundServices + Composition + MessageRouterDeps.
  if (!container.has('sessionStore')) container.register('sessionStore', () => new SessionStore(), { singleton: true });
  if (!container.has('recordingCache')) container.register('recordingCache', () => {
    const ss = container.resolve<SessionStore>('sessionStore');
    const rc = new RecordingCacheInstance(new SessionStoreRecordingCacheStore(ss));
    rc.ensureStorageListener?.();
    return rc;
  }, { singleton: true });
  if (!container.has('headerDetector')) container.register('headerDetector', () => new HeaderDetector(container.resolve<RecordingCacheInstance>('recordingCache')), { singleton: true });
  if (!container.has('obsidian')) container.register('obsidian', () => new ObsidianClient(), { singleton: true });
  if (!container.has('sqliteClient')) container.register('sqliteClient', () => getSharedSqliteClient(), { singleton: true });
  if (!container.has('tabCache')) container.register('tabCache', () => new TabCache(container.resolve<SessionStore>('sessionStore')), { singleton: true });
  if (!container.has('rateLimiter')) container.register('rateLimiter', () => new RateLimiter(container.resolve<SessionStore>('sessionStore')), { singleton: true });
  if (!container.has('manualContentFetcher')) container.register('manualContentFetcher', () => new ManualContentFetcher(), { singleton: true });
  if (!container.has('remoteAiService')) container.register('remoteAiService', () => new RemoteAIService(), { singleton: true });
  if (!container.has('aiService')) container.register('aiService', () => createAIService({ remoteAiService: container.resolve<RemoteAIService>('remoteAiService') }), { singleton: true });

  const sessionStore = container.resolve<SessionStore>('sessionStore');
  const recordingCache = container.resolve<RecordingCacheInstance>('recordingCache');
  const headerDetector = container.resolve<HeaderDetector>('headerDetector');

  // Wires the pending-write queue's storage adapter explicitly, instead of the
  // module constructing a ChromeStorageAdapter at import time. Tests inject an
  // InMemoryAdapter-backed queue via setPendingWriteQueue instead.
  setPendingWriteQueue(createPendingWriteQueue(new ChromeStorageAdapter()));

  const obsidian = container.resolve<ObsidianClient>('obsidian');
  // Shared singleton: independent SqliteClient instances would each race to
  // create the offscreen document (see getSharedSqliteClient).
  const sqliteClient = container.resolve<SqliteClient>('sqliteClient');
  // Inject SQLite health check into storageMaintenance (removes utils→background dynamic import)
  setSqliteHealthCheck(async () => {
    const r = await sqliteClient.maintain({ type: 'healthCheck' });
    return r.success ? Boolean(r.data) : false;
  });
  const tabCache = container.resolve<TabCache>('tabCache');
  const rateLimiter = container.resolve<RateLimiter>('rateLimiter');
  const manualContentFetcher = container.resolve<ManualContentFetcher>('manualContentFetcher');
  const aiService = container.resolve<AIService>('aiService');

  // One shared review summary generator for the alarm and message paths
  // (deep-dig 子PBI 5): both observe the same AIService composition.
  const reviewSummaryGenerator = createReviewSummaryGenerator({ aiService, sqliteClient });

  // One shared pipeline for every recording path, automatic and handler-based.
  const recordingPipeline = createRecordingPipeline(buildRecordingPipelineDeps({
    getPrivacyInfoWithCache: (url: string) => recordingCache.getPrivacyInfoWithCache(url),
    getSettingsWithCache: () => recordingCache.getSettingsWithCache(),
    obsidian,
    aiService,
    sqliteClient,
    urlStore: { getSavedUrlsWithTimestamps },
    offlineNetworkQueue: sharedOfflineNetworkQueue,
  }));

  // Content backfill must not reorder LRU, so the timestamp is left alone. One
  // closure is shared by both recording handlers instead of being rebuilt per
  // handler (deep-dig 子PBI 4).
  const setUrlContent = async (url: string, content: string): Promise<void> => {
    await saveSavedUrlEntryMetadata(url, { content }, { refreshTimestamp: false, createIfMissing: false });
  };

  const manualRecordDeps: ManualRecordHandlerDeps = {
    isRecordingAllowed: () => hasPrivacyConsent(),
    checkRateLimit: (sender, settings) => rateLimiter.check(sender, settings),
    fetchContent: (url: string) => manualContentFetcher.fetchContent(url),
    recordingPipeline,
    getSettings: () => getSettings(),
    setUrlContent,
  };

  const saveRecordDeps: SaveRecordHandlerDeps = {
    isRecordingAllowed: () => hasPrivacyConsent(),
    recordingPipeline,
    getSettings: () => getSettings(),
    setUrlContent,
  };

  // Construct the dashboard SQLite handler and auto-saved badge tabs
  const dashboardSqliteHandler = createDashboardSqliteMessageHandler({ sqliteClient, ensureConfirmToken });
  const autoSavedBadgeTabs = createAutoSavedBadgeTabs();

  // Compose the message router here — all wiring centralized in one place.
  // Deep module: MessageRouter hides the 19 handler table behind a single dispatch seam.
  const messageRouterDeps: MessageRouterDeps = {
    recordingPipeline: { record: (data) => recordingPipeline.record(data) },
    tabCache: { add: (tab) => tabCache.add(tab), update: (tabId, data) => tabCache.update(tabId, data) },
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
    getPrivacyCache: () => recordingCache.getPrivacyCache(),
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
    generateWeeklySummary: () => reviewSummaryGenerator.generateWeeklySummary(),
    generateMonthlySummary: () => reviewSummaryGenerator.generateMonthlySummary(),
    dashboardSqliteHandler,
  };

  const messageRouter = createMessageRouter(messageRouterDeps);

  return {
    obsidian,
    sqliteClient,
    tabCache,
    rateLimiter,
    manualContentFetcher,
    aiService,
    reviewSummaryGenerator,
    sessionStore,
    headerDetector,
    recordingCache,
    recordingPipeline,
    dashboardSqliteClient: sqliteClient,
    manualRecordDeps,
    saveRecordDeps,
    messageRouter,
    dashboardSqliteHandler,
    autoSavedBadgeTabs,
  };
}
