/**
 * Recording Pipeline — orchestrates 13 steps.
 * Steps: truncate, domainFilter, permission, trust, privacyHeaders, duplicate,
 *        privacyPipeline (RETRY, previewBreakpoint), extractSentences (RETRY),
 *        formatMarkdown, saveObsidian (BEST_EFFORT), saveLocalMarkdown,
 *        saveSqlite, saveMetadata. See steps/index.ts for details.
 */

import type { RecordingData, RecordingResult } from '../../messaging/types.js';
import type { Settings } from '../../utils/storage/types.js';
import type { ObsidianClient } from '../obsidianClient.js';
import type { AIService } from '../ai/AIService.js';
import type { SqliteClient } from '../sqliteClient.js';
import type { PrivacyInfo } from '../../utils/privacyChecker.js';
import type { OfflineNetworkQueue } from '../offlineNetworkQueue.js';
import type { UrlStore } from './types.js';
import { PerUrlMutexMap } from './perUrlMutex.js';
import { RecordingOrchestrator, type RecordingOrchestratorDeps } from './RecordingOrchestrator.js';
import { pickDefined } from '../../utils/objectUtils.js';

export interface RecordingPipelineDeps extends RecordingOrchestratorDeps {}

export function createRecordingPipeline(deps: RecordingPipelineDeps): RecordingPipeline {
  return new RecordingPipeline(deps.getPrivacyInfoWithCache, deps.obsidian, deps.aiService, deps.sqliteClient, deps.offlineNetworkQueue, deps.urlStore, deps.getSettingsWithCache);
}

/** @deprecated Use RecordingOrchestrator directly — this identity function is shallow (6 LOC) and will be removed */
export function buildRecordingPipelineDeps(deps: Pick<RecordingPipelineDeps, 'getPrivacyInfoWithCache' | 'getSettingsWithCache' | 'obsidian' | 'aiService' | 'sqliteClient' | 'urlStore' | 'offlineNetworkQueue'>): RecordingPipelineDeps {
  return { ...deps };
}

export class RecordingPipeline {
  private orchestrator: RecordingOrchestrator;

  // Expose steps for tests that inspect pipeline internals (offlineRetry metadata)
  // This keeps the deep module testable via its seam while preserving legacy test compat.
  get steps(): unknown {
    return (this.orchestrator as unknown as { steps: unknown }).steps;
  }

  // Static compat for legacy tests that inspect urlRecordMutexes directly
  static get urlRecordMutexes() {
    return PerUrlMutexMap.getSharedMap();
  }

  private static getUrlMutex(url: string) {
    return PerUrlMutexMap.getOrCreateStatic(url);
  }

  private static withUrlRecordMutex<T>(url: string, fn: () => Promise<T>): Promise<T> {
    return PerUrlMutexMap.runExclusiveStatic(url, fn);
  }

  constructor(
    getPrivacyInfoWithCache: (url: string) => Promise<PrivacyInfo | null>,
    obsidian: ObsidianClient,
    aiService: AIService | null = null,
    sqliteClient: SqliteClient | null = null,
    offlineNetworkQueue: OfflineNetworkQueue | null = null,
    urlStore: UrlStore | undefined = undefined,
    getSettingsWithCache: () => Promise<Settings>
  ) {
    this.orchestrator = new RecordingOrchestrator({
      getPrivacyInfoWithCache,
      getSettingsWithCache,
      obsidian,
      aiService,
      sqliteClient,
      offlineNetworkQueue,
      ...pickDefined({ urlStore }),
    });
  }

  async execute(data: RecordingData, settings: Settings): Promise<RecordingResult> {
    // execute with explicit settings — bypass cache, delegate to orchestrator's internal execute
    // For compat, we still support this shallow entry; orchestrator's record will re-fetch settings,
    // so we call orchestrator directly with settings via a temporary override.
    // Simplest: create a one-off orchestrator with a stub getSettingsWithCache returning the given settings
    const orig = (this.orchestrator as unknown as { getSettingsWithCache: () => Promise<Settings> }).getSettingsWithCache;
    (this.orchestrator as unknown as { getSettingsWithCache: () => Promise<Settings> }).getSettingsWithCache = async () => settings;
    try {
      return await this.orchestrator.record(data);
    } finally {
      (this.orchestrator as unknown as { getSettingsWithCache: () => Promise<Settings> }).getSettingsWithCache = orig;
    }
  }

  async record(data: RecordingData): Promise<RecordingResult> {
    return this.orchestrator.record(data);
  }

  async recordWithPreview(data: RecordingData): Promise<RecordingResult> {
    return this.orchestrator.recordWithPreview(data);
  }

  async retryObsidianWriteOnly(job: { title: string; url: string; summary: string; tags?: string[] }): Promise<boolean> {
    return this.orchestrator.retryObsidianWriteOnly(job);
  }
}
