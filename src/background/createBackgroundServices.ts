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
import { hasPrivacyConsent } from '../popup/privacyConsent.js';
import { getSettings } from '../utils/storage.js';
import { getSavedUrlsWithTimestamps } from '../utils/storage/savedUrlStore.js';
import { saveSavedUrlEntryMetadata } from '../utils/storage/savedUrlStore.js';
import type { ManualRecordHandlerDeps, SaveRecordHandlerDeps } from './handlers/recordingHandlers.js';

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
  /**
   * The SqliteClient handed to the Dashboard SQLite handler wiring; must be
   * the same instance as `sqliteClient` (guarded by backgroundComposition.test).
   */
  dashboardSqliteClient: SqliteClient;
  /** Deps for MANUAL_RECORD / PREVIEW_RECORD / context-menu handlers. */
  manualRecordDeps: ManualRecordHandlerDeps;
  /** Deps for SAVE_RECORD. */
  saveRecordDeps: SaveRecordHandlerDeps;
}

export function createBackgroundServices(): BackgroundServicesComposition {
  const sessionStore = new SessionStore();
  const recordingCache = new RecordingCacheInstance(new SessionStoreRecordingCacheStore(sessionStore));
  const headerDetector = new HeaderDetector(recordingCache);

  // Wires the pending-write queue's storage adapter explicitly, instead of the
  // module constructing a ChromeStorageAdapter at import time. Tests inject an
  // InMemoryAdapter-backed queue via setPendingWriteQueue instead.
  setPendingWriteQueue(createPendingWriteQueue(new ChromeStorageAdapter()));

  const obsidian = new ObsidianClient();
  // Shared singleton: independent SqliteClient instances would each race to
  // create the offscreen document (see getSharedSqliteClient).
  const sqliteClient = getSharedSqliteClient();
  const tabCache = new TabCache(sessionStore);
  const rateLimiter = new RateLimiter(sessionStore);
  const manualContentFetcher = new ManualContentFetcher();
  const remoteAiService = new RemoteAIService();
  const aiService = createAIService({ remoteAiService });

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
  };
}
