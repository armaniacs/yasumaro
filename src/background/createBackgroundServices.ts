/**
 * createBackgroundServices
 * Production composition root for the Service Worker's long-lived collaborators.
 *
 * service-worker.ts constructs every singleton through this module (shared
 * SqliteClient via getSharedSqliteClient, one shared RecordingPipeline, and the
 * manual/save handler dependency objects), so manual record, context menu, and
 * message paths observe the same references instead of rebuilding per message.
 */

import { AIClient } from './aiClient.js';
import { createAIService } from './ai/aiServiceFactory.js';
import type { AIService } from './ai/AIService.js';
import { ObsidianClient } from './obsidianClient.js';
import { getSharedSqliteClient } from './sqliteClient.js';
import type { SqliteClient } from './sqliteClient.js';
import { RecordingLogic } from './recordingLogic.js';
import { RecordingCache } from './recordingCache.js';
import { TabCache } from './tabCache.js';
import { RateLimiter } from './rateLimiter.js';
import { ManualContentFetcher } from './manualContentFetcher.js';
import { SessionStore } from './sessionStore.js';
import { createRecordingPipeline, buildRecordingPipelineDeps } from './pipeline/RecordingPipeline.js';
import type { RecordingPipeline } from './pipeline/RecordingPipeline.js';
import { createReviewSummaryGenerator } from './reviewSummaryGenerator.js';
import type { ReviewSummaryGenerator } from './reviewSummaryGenerator.js';
import { hasPrivacyConsent } from '../popup/privacyConsent.js';
import { getSettings } from '../utils/storage.js';
import { saveSavedUrlEntryMetadata } from '../utils/storage/savedUrlStore.js';
import type { ManualRecordHandlerDeps, SaveRecordHandlerDeps } from './handlers/messageHandlers.js';

export interface BackgroundServices {
  obsidian: ObsidianClient;
  sqliteClient: SqliteClient;
  recordingLogic: RecordingLogic;
  tabCache: TabCache;
  rateLimiter: RateLimiter;
  manualContentFetcher: ManualContentFetcher;
  aiClient: AIClient;
  /**
   * The AIService composition built over aiClient.
   *
   * Previously this was created internally and thrown away, so callers could
   * only reach the raw AIClient — the exact dependency ADR 2026-07-27 asks new
   * code to avoid. Returning it makes the module usable without violating that.
   */
  aiService: AIService;
  sessionStore: SessionStore;
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
  /** Single RecordingPipeline shared by the manual/save handler deps. */
  recordingPipeline: RecordingPipeline;
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

  const obsidian = new ObsidianClient();
  // Shared singleton: independent SqliteClient instances would each race to
  // create the offscreen document (see getSharedSqliteClient).
  const sqliteClient = getSharedSqliteClient();
  const tabCache = new TabCache(sessionStore);
  const rateLimiter = new RateLimiter(sessionStore);
  const manualContentFetcher = new ManualContentFetcher();
  const aiClient = new AIClient();
  const aiService = createAIService({ aiClient });

  // One shared review summary generator for the alarm and message paths
  // (deep-dig 子PBI 5): both observe the same AIService composition.
  const reviewSummaryGenerator = createReviewSummaryGenerator({ aiService, sqliteClient });

  // One shared pipeline for every recording path, automatic and handler-based.
  const recordingPipeline = createRecordingPipeline(buildRecordingPipelineDeps({
    getPrivacyInfoWithCache: (url: string) => RecordingCache.getPrivacyInfoWithCache(url),
    obsidian,
    aiService,
    sqliteClient,
  }));

  const recordingLogic = new RecordingLogic(obsidian, aiService, recordingPipeline, sqliteClient);

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
    recordingLogic,
    tabCache,
    rateLimiter,
    manualContentFetcher,
    aiClient,
    aiService,
    reviewSummaryGenerator,
    sessionStore,
    recordingPipeline,
    dashboardSqliteClient: sqliteClient,
    manualRecordDeps,
    saveRecordDeps,
  };
}
