/**
 * createBackgroundServices
 * Composition root for the Service Worker's long-lived collaborators.
 *
 * NOTE: service-worker.ts does not call this yet — it still constructs each
 * singleton inline (see PBI 2026-08-07-13, which introduced this module but
 * stopped short of rewiring the entrypoint). Until that migration happens this
 * module is exercised only by its own test. It is kept rather than deleted
 * because the wiring it centralizes is still the intended end state; deleting
 * it would discard the design without removing the duplication it targets.
 */

import { AIClient } from './aiClient.js';
import { createAIService } from './ai/aiServiceFactory.js';
import type { AIService } from './ai/AIService.js';
import { ObsidianClient } from './obsidianClient.js';
import { SqliteClient } from './sqliteClient.js';
import { RecordingLogic } from './recordingLogic.js';
import { TabCache } from './tabCache.js';
import { RateLimiter } from './rateLimiter.js';
import { ManualContentFetcher } from './manualContentFetcher.js';
import { SessionStore } from './sessionStore.js';

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
}

export function createBackgroundServices(): BackgroundServices {
  const sessionStore = new SessionStore();

  const obsidian = new ObsidianClient();
  const sqliteClient = new SqliteClient();
  const tabCache = new TabCache(sessionStore);
  const rateLimiter = new RateLimiter(sessionStore);
  const manualContentFetcher = new ManualContentFetcher();
  const aiClient = new AIClient();
  const aiService = createAIService({ aiClient });

  const recordingLogic = new RecordingLogic(obsidian, aiService, undefined, sqliteClient);

  return {
    obsidian,
    sqliteClient,
    recordingLogic,
    tabCache,
    rateLimiter,
    manualContentFetcher,
    aiClient,
    aiService,
    sessionStore,
  };
}
