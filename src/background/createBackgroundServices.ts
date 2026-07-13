import { ObsidianClient } from './obsidianClient.js';
import { SqliteClient } from './sqliteClient.js';
import { RecordingLogic } from './recordingLogic.js';
import { TabCache } from './tabCache.js';
import { RateLimiter } from './rateLimiter.js';
import { ManualContentFetcher } from './manualContentFetcher.js';
import { AIClient } from './aiClient.js';
import { FallbackAIService } from './ai/FallbackAIService.js';
import { RemoteAIService } from './ai/RemoteAIService.js';
import { LocalAIService } from './ai/LocalAIService.js';
import { LocalAIClient } from './localAiClient.js';
import { SessionStore } from './sessionStore.js';

export interface BackgroundServices {
  obsidian: ObsidianClient;
  sqliteClient: SqliteClient;
  recordingLogic: RecordingLogic;
  tabCache: TabCache;
  rateLimiter: RateLimiter;
  manualContentFetcher: ManualContentFetcher;
  aiClient: AIClient;
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
  const localClient = new LocalAIClient();
  const aiService = new FallbackAIService({
    local: new LocalAIService({
      localAiClient: localClient,
      ensureOffscreenDocument: () => localClient.ensureOffscreenDocument(),
    }),
    remote: new RemoteAIService({ aiClient }),
  });

  const recordingLogic = new RecordingLogic(obsidian, aiService, undefined, sqliteClient);

  return {
    obsidian,
    sqliteClient,
    recordingLogic,
    tabCache,
    rateLimiter,
    manualContentFetcher,
    aiClient,
    sessionStore,
  };
}
