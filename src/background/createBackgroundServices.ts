/**
 * createBackgroundServices
 * Production composition root for the Service Worker's long-lived collaborators.
 *
 * service-worker.ts constructs every singleton through this module (shared
 * SqliteClient via getSharedSqliteClient, one shared RecordingPipeline, and the
 * shared RecordingAdmission pre-stage), so manual record, context menu, and
 * message paths observe the same references instead of rebuilding per message.
 *
 * The wiring itself is declared in `compositionManifest.ts`. This function
 * registers every manifest entry the container does not already have (so tests
 * can `override()` first), resolves them, runs `onReady` side effects once, and
 * hands back the typed composition.
 */

import type { AIService } from './ai/AIService.js';
import type { ObsidianClient } from './obsidianClient.js';
import type { SqliteClient } from './sqlite/offscreenGateway.js';
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
import type { RecordingAdmission } from './recordingAdmission.js';
import type { SessionAlarmService } from './SessionAlarmService.js';
import type { AlarmRegistry } from './alarmRegistry.js';
import { ServiceContainer, type ServiceKey } from './serviceContainer.js';
import { compositionManifest } from './compositionManifest.js';
import { errorMessage } from '../utils/errorUtils.js';

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
  /** PBI 03: the shared recording admission pre-stage. */
  recordingAdmission: RecordingAdmission;
  messageRouter: MessageRouter;
  autoSavedBadgeTabs: AutoSavedBadgeTabs;
  /** PBI 2026-09-15-17: promoted from service-worker.ts direct creation. */
  sessionAlarmService: SessionAlarmService;
  alarmRegistry: AlarmRegistry;
  deferredMigrationRunner: () => Promise<void>;
}

/**
 * One isolated service-initialization failure. A throwing factory is recorded
 * here instead of aborting the remaining initializations, so every failure is
 * still detected when the composition below throws (PBI 2026-11-08-13).
 */
export interface ServiceInitFailure {
  readonly key: ServiceKey;
  readonly message: string;
}

/**
 * Thrown by createBackgroundServices when one or more service factories (or
 * onReady wirings) failed. Carries every failure so a partial outage is never
 * mistaken for a healthy composition: the return type stays honest (every
 * member defined) because this function either returns fully or throws.
 *
 * Fail-open is deliberately not an option here: resolving a failed slot as
 * `undefined` would satisfy the type while handing every consumer a value
 * that crashes on first use, far from the cause. Fail fast at startup
 * instead — the Service Worker restart that follows re-runs the factories.
 */
export class ServiceInitError extends Error {
  readonly failures: readonly ServiceInitFailure[];

  constructor(failures: readonly ServiceInitFailure[]) {
    super(
      `createBackgroundServices: ${failures.length} service(s) failed to initialize: ` +
        failures.map((f) => `${f.key} (${f.message})`).join('; '),
    );
    this.name = 'ServiceInitError';
    this.failures = failures;
  }
}

export function createBackgroundServices(container = new ServiceContainer()): BackgroundServicesComposition {
  // Register every manifest entry the container does not already have, so a
  // test that called container.override(key, fake) keeps its fake.
  for (const entry of compositionManifest) {
    if (!container.has(entry.key)) {
      container.register(entry.key, () => entry.factory(container), { singleton: entry.singleton });
    }
  }

  // Resolve everything, isolating one service's factory exception from the
  // rest: a failure is recorded so the remaining services still initialize
  // and every failure is reported together. Nothing degraded is returned —
  // the composition below throws a ServiceInitError when any failure was
  // recorded, so no consumer ever observes an undefined slot through a
  // success-typed member (fail-open). Detection rides on the thrown error's
  // `failures`, which names every failed key instead of just the first.
  const failures: ServiceInitFailure[] = [];
  const failedKeys = new Set<ServiceKey>();
  for (const entry of compositionManifest) {
    try {
      container.resolve(entry.key);
    } catch (error) {
      failures.push({ key: entry.key, message: errorMessage(error) });
      failedKeys.add(entry.key);
    }
  }
  for (const entry of compositionManifest) {
    if (failedKeys.has(entry.key)) continue;
    try {
      entry.onReady?.(container);
    } catch (error) {
      failures.push({ key: entry.key, message: errorMessage(error) });
      failedKeys.add(entry.key);
    }
  }

  if (failures.length > 0) {
    throw new ServiceInitError(failures);
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
    recordingAdmission: container.resolve<RecordingAdmission>('recordingAdmission'),
    messageRouter: container.resolve<MessageRouter>('messageRouter'),
    autoSavedBadgeTabs: container.resolve<AutoSavedBadgeTabs>('autoSavedBadgeTabs'),
    sessionAlarmService: container.resolve<SessionAlarmService>('sessionAlarmService'),
    alarmRegistry: container.resolve<AlarmRegistry>('alarmRegistry'),
    deferredMigrationRunner: container.resolve<() => Promise<void>>('deferredMigrationRunner'),
  };
}

// Re-exported so existing test imports (`import { MessageHandler }`) keep working.
export type { MessageHandler };
