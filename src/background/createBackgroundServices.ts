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
import { SettingsRepository, ChromeStorageAdapter as SettingsChromeStorageAdapter } from '../utils/storage/SettingsRepository.js';

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

// PBI-03: 全フィールド網羅 — BackgroundServices が container 登録と乖離していないことを保証。
// 新しいフィールドを追加した際はこの union も更新する必要があり、差分を見逃さない。
type _BackgroundServicesKeys =
  | 'obsidian'
  | 'sqliteClient'
  | 'recordingPipeline'
  | 'tabCache'
  | 'rateLimiter'
  | 'manualContentFetcher'
  | 'aiService'
  | 'sessionStore'
  | 'headerDetector'
  | 'recordingCache'
  | 'reviewSummaryGenerator';
type _BackgroundServicesExhaustiveCheck =
  keyof BackgroundServices extends _BackgroundServicesKeys
    ? _BackgroundServicesKeys extends keyof BackgroundServices
      ? true
      : never
    : never;
const _exhaustiveCheck: _BackgroundServicesExhaustiveCheck = true as const;
void _exhaustiveCheck;

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
  if (!container.has('settingsRepository')) container.register('settingsRepository', () => new SettingsRepository(new SettingsChromeStorageAdapter()), { singleton: true });

  // Content backfill must not reorder LRU, so the timestamp is left alone. One
  // closure is shared by both recording handlers instead of being rebuilt per
  // handler (deep-dig 子PBI 4).
  const setUrlContent = async (url: string, content: string): Promise<void> => {
    await saveSavedUrlEntryMetadata(url, { content }, { refreshTimestamp: false, createIfMissing: false });
  };

  // — Remaining services moved into container (PBI-03) —
  // Each guarded by `has` so tests can `override()` before calling createBackgroundServices.
  if (!container.has('pendingWriteQueue')) container.register('pendingWriteQueue', () => createPendingWriteQueue(new ChromeStorageAdapter()), { singleton: true });
  if (!container.has('reviewSummaryGenerator')) container.register('reviewSummaryGenerator', () => createReviewSummaryGenerator({ aiService: container.resolve<AIService>('aiService'), sqliteClient: container.resolve<SqliteClient>('sqliteClient') }), { singleton: true });
  if (!container.has('recordingPipeline')) container.register('recordingPipeline', () => {
    const rc = container.resolve<RecordingCacheInstance>('recordingCache');
    return createRecordingPipeline(buildRecordingPipelineDeps({
      getPrivacyInfoWithCache: (url: string) => rc.getPrivacyInfoWithCache(url),
      getSettingsWithCache: () => rc.getSettingsWithCache(),
      obsidian: container.resolve<ObsidianClient>('obsidian'),
      aiService: container.resolve<AIService>('aiService'),
      sqliteClient: container.resolve<SqliteClient>('sqliteClient'),
      urlStore: { getSavedUrlsWithTimestamps },
      offlineNetworkQueue: sharedOfflineNetworkQueue,
    }));
  }, { singleton: true });
  if (!container.has('dashboardSqliteHandler')) container.register('dashboardSqliteHandler', () => createDashboardSqliteMessageHandler({ sqliteClient: container.resolve<SqliteClient>('sqliteClient'), ensureConfirmToken }), { singleton: true });
  if (!container.has('autoSavedBadgeTabs')) container.register('autoSavedBadgeTabs', () => createAutoSavedBadgeTabs(), { singleton: true });
  if (!container.has('manualRecordDeps')) container.register('manualRecordDeps', () => ({
    isRecordingAllowed: () => hasPrivacyConsent(),
    checkRateLimit: (sender, settings) => container.resolve<RateLimiter>('rateLimiter').check(sender as never, settings as never),
    fetchContent: (url: string) => container.resolve<ManualContentFetcher>('manualContentFetcher').fetchContent(url),
    recordingPipeline: container.resolve<RecordingPipeline>('recordingPipeline'),
    getSettings: () => getSettings(),
    setUrlContent,
  } as ManualRecordHandlerDeps), { singleton: true });
  if (!container.has('saveRecordDeps')) container.register('saveRecordDeps', () => ({
    isRecordingAllowed: () => hasPrivacyConsent(),
    recordingPipeline: container.resolve<RecordingPipeline>('recordingPipeline'),
    getSettings: () => getSettings(),
    setUrlContent,
  } as SaveRecordHandlerDeps), { singleton: true });
  if (!container.has('messageRouter')) container.register('messageRouter', () => {
    const obsidian = container.resolve<ObsidianClient>('obsidian');
    const aiService = container.resolve<AIService>('aiService');
    const tabCache = container.resolve<TabCache>('tabCache');
    const recordingPipeline = container.resolve<RecordingPipeline>('recordingPipeline');
    const recordingCache = container.resolve<RecordingCacheInstance>('recordingCache');
    const manualRecordDeps = container.resolve<ManualRecordHandlerDeps>('manualRecordDeps');
    const saveRecordDeps = container.resolve<SaveRecordHandlerDeps>('saveRecordDeps');
    const autoSavedBadgeTabs = container.resolve<AutoSavedBadgeTabs>('autoSavedBadgeTabs');
    const reviewSummaryGenerator = container.resolve<ReviewSummaryGenerator>('reviewSummaryGenerator');
    const dashboardSqliteHandler = container.resolve<MessageHandler>('dashboardSqliteHandler');
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
    return createMessageRouter(messageRouterDeps);
  }, { singleton: true });

  const sessionStore = container.resolve<SessionStore>('sessionStore');
  const recordingCache = container.resolve<RecordingCacheInstance>('recordingCache');
  const headerDetector = container.resolve<HeaderDetector>('headerDetector');

  // Wires the pending-write queue's storage adapter explicitly via container.
  // Tests can override 'pendingWriteQueue' with an InMemoryAdapter-backed queue.
  const pendingWriteQueue = container.resolve<ReturnType<typeof createPendingWriteQueue>>('pendingWriteQueue');
  setPendingWriteQueue(pendingWriteQueue);

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
  const reviewSummaryGenerator = container.resolve<ReviewSummaryGenerator>('reviewSummaryGenerator');
  const recordingPipeline = container.resolve<RecordingPipeline>('recordingPipeline');
  const dashboardSqliteHandler = container.resolve<MessageHandler>('dashboardSqliteHandler');
  const autoSavedBadgeTabs = container.resolve<AutoSavedBadgeTabs>('autoSavedBadgeTabs');
  const manualRecordDeps = container.resolve<ManualRecordHandlerDeps>('manualRecordDeps');
  const saveRecordDeps = container.resolve<SaveRecordHandlerDeps>('saveRecordDeps');
  const messageRouter = container.resolve<MessageRouter>('messageRouter');

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
