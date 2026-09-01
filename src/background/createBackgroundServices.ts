/**
 * createBackgroundServices
 * Production composition root for the Service Worker's long-lived collaborators.
 *
 * service-worker.ts constructs every singleton through this module (shared
 * SqliteClient via getSharedSqliteClient, one shared RecordingPipeline, and the
 * manual/save handler dependency objects), so manual record, context menu, and
 * message paths observe the same references instead of rebuilding per message.
 *
 * The wiring itself is declared in `compositionManifest.ts`. This function
 * registers every manifest entry the container does not already have (so tests
 * can `override()` first), resolves them, runs `onReady` side effects once, and
 * hands back the typed composition.
 */

import type { AIService } from './ai/AIService.js';
import type { ObsidianClient } from './obsidianClient.js';
import type { SqliteClient } from './sqliteClient.js';
import type { RecordingCacheInstance } from './recordingCache.js';
import type { TabCache } from './tabCache.js';
import type { RateLimiter } from './rateLimiter.js';
import type { ManualContentFetcher } from './manualContentFetcher.js';
import type { SessionStore } from './sessionStore.js';
import type { HeaderDetector } from './headerDetector.js';
import type { RecordingOrchestrator } from './pipeline/RecordingOrchestrator.js';
import type { ReviewSummaryGenerator } from './reviewSummaryGenerator.js';
import type { AutoSavedBadgeTabs } from './swStatePersistence.js';
import type { MessageRouter, MessageHandler } from './handlers/MessageRouter.js';
import type { ManualRecordHandlerDeps, SaveRecordHandlerDeps } from './handlers/recordingHandlers.js';
import { ServiceContainer } from './serviceContainer.js';
import { compositionManifest } from './compositionManifest.js';

export interface BackgroundServices {
  obsidian: ObsidianClient;
  sqliteClient: SqliteClient;
  /** Shared RecordingOrchestrator; owns per-URL mutex, settings fetch, and step execution. */
  recordingPipeline: RecordingOrchestrator;
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
 *
 * `dashboardSqliteHandler` is not a member: it is an internal wiring value that
 * only reaches `MessageRouterDeps`. Consumers get it via
 * `messageRouter.getHandler('DASHBOARD_SQLITE')`.
 */
export interface BackgroundServicesComposition extends BackgroundServices {
  manualRecordDeps: ManualRecordHandlerDeps;
  saveRecordDeps: SaveRecordHandlerDeps;
  messageRouter: MessageRouter;
  autoSavedBadgeTabs: AutoSavedBadgeTabs;
}

export function createBackgroundServices(container = new ServiceContainer()): BackgroundServicesComposition {
  // Register every manifest entry the container does not already have, so a
  // test that called container.override(key, fake) keeps its fake.
  for (const entry of compositionManifest) {
    if (!container.has(entry.key)) {
      container.register(entry.key, () => entry.factory(container), { singleton: entry.singleton });
    }
  }

  // Resolve everything, then run onReady side effects once (setPendingWriteQueue,
  // setSqliteHealthCheck — the utils↔background boundary wiring).
  for (const entry of compositionManifest) {
    container.resolve(entry.key);
  }
  for (const entry of compositionManifest) {
    entry.onReady?.(container);
  }

  return {
    obsidian: container.resolve<ObsidianClient>('obsidian'),
    sqliteClient: container.resolve<SqliteClient>('sqliteClient'),
    tabCache: container.resolve<TabCache>('tabCache'),
    rateLimiter: container.resolve<RateLimiter>('rateLimiter'),
    manualContentFetcher: container.resolve<ManualContentFetcher>('manualContentFetcher'),
    aiService: container.resolve<AIService>('aiService'),
    reviewSummaryGenerator: container.resolve<ReviewSummaryGenerator>('reviewSummaryGenerator'),
    sessionStore: container.resolve<SessionStore>('sessionStore'),
    headerDetector: container.resolve<HeaderDetector>('headerDetector'),
    recordingCache: container.resolve<RecordingCacheInstance>('recordingCache'),
    recordingPipeline: container.resolve<RecordingOrchestrator>('recordingPipeline'),
    manualRecordDeps: container.resolve<ManualRecordHandlerDeps>('manualRecordDeps'),
    saveRecordDeps: container.resolve<SaveRecordHandlerDeps>('saveRecordDeps'),
    messageRouter: container.resolve<MessageRouter>('messageRouter'),
    autoSavedBadgeTabs: container.resolve<AutoSavedBadgeTabs>('autoSavedBadgeTabs'),
  };
}

// Re-exported so existing test imports (`import { MessageHandler }`) keep working.
export type { MessageHandler };
