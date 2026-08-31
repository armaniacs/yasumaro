/**
 * Recording Pipeline — backward-compatible facade over RecordingOrchestrator.
 *
 * New code should use RecordingOrchestrator directly.
 * This class is retained only for existing callers/tests that reference
 * RecordingPipeline; it delegates every call to the internal orchestrator.
 */

import type { RecordingData, RecordingResult } from '../../messaging/types.js';
import type { Settings } from '../../utils/storage/types.js';
import type { ObsidianClient } from '../obsidianClient.js';
import type { AIService } from '../ai/AIService.js';
import type { SqliteClient } from '../sqliteClient.js';
import type { PrivacyInfo } from '../../utils/privacyChecker.js';
import type { OfflineNetworkQueue } from '../offlineNetworkQueue.js';
import type { UrlStore } from './types.js';
import { RecordingOrchestrator, type RecordingOrchestratorDeps } from './RecordingOrchestrator.js';
import type { PerUrlMutexMap } from './perUrlMutex.js';
import { pickDefined } from '../../utils/objectUtils.js';

export interface RecordingPipelineDeps extends RecordingOrchestratorDeps {}

export function createRecordingPipeline(deps: RecordingPipelineDeps): RecordingPipeline {
  return new RecordingPipeline(
    deps.getPrivacyInfoWithCache,
    deps.obsidian,
    deps.aiService,
    deps.sqliteClient,
    deps.offlineNetworkQueue,
    deps.urlStore,
    deps.getSettingsWithCache,
    deps.perUrlMutexMap
  );
}

/** @deprecated Use RecordingOrchestrator directly — this shallow identity function will be removed */
export function buildRecordingPipelineDeps(deps: Pick<RecordingPipelineDeps, 'getPrivacyInfoWithCache' | 'getSettingsWithCache' | 'obsidian' | 'aiService' | 'sqliteClient' | 'urlStore' | 'offlineNetworkQueue' | 'perUrlMutexMap'>): RecordingPipelineDeps {
  return { ...deps };
}

export class RecordingPipeline {
  private orchestrator: RecordingOrchestrator;

  // Expose steps for tests that inspect pipeline internals (offlineRetry metadata)
  // This keeps the deep module testable via its seam while preserving legacy test compat.
  get steps(): unknown {
    return (this.orchestrator as unknown as { steps: unknown }).steps;
  }

  constructor(
    getPrivacyInfoWithCache: (url: string) => Promise<PrivacyInfo | null>,
    obsidian: ObsidianClient,
    aiService: AIService | null = null,
    sqliteClient: SqliteClient | null = null,
    offlineNetworkQueue: OfflineNetworkQueue | null = null,
    urlStore: UrlStore | undefined = undefined,
    getSettingsWithCache: () => Promise<Settings>,
    perUrlMutexMap: PerUrlMutexMap | undefined = undefined
  ) {
    this.orchestrator = new RecordingOrchestrator({
      getPrivacyInfoWithCache,
      getSettingsWithCache,
      obsidian,
      aiService,
      sqliteClient,
      offlineNetworkQueue,
      ...pickDefined({ urlStore, perUrlMutexMap }),
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
    return this.orchestrator.record(data, { mode: 'preview' });
  }

  async retryObsidianWriteOnly(job: { title: string; url: string; summary: string; tags?: string[] }): Promise<boolean> {
    return this.orchestrator.retryObsidianWriteOnly(job);
  }
}
