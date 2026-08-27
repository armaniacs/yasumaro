/**
 * Recording Pipeline — orchestrates 13 steps.
 * Steps: truncate, domainFilter, permission, trust, privacyHeaders, duplicate,
 *        privacyPipeline (RETRY, previewBreakpoint), extractSentences (RETRY),
 *        formatMarkdown, saveObsidian (BEST_EFFORT), saveLocalMarkdown,
 *        saveSqlite, saveMetadata. See steps/index.ts for details.
 */

import { addLog, LogType } from '../../utils/logger.js';
import { pickDefined } from '../../utils/objectUtils.js';
import { ErrorStrategy, type RecordingContext, type PipelineStep, type PipelineError, type StepDeps, type UrlStore } from './types.js';
import { buildResult, buildErrorResult, buildPrivatePageResult, notifyObsidianSaveSuccess, notifyRecordingError } from './resultBuilder.js';
import {
  truncateContentStep, checkDomainFilterStep, checkPermissionStep, checkTrustDomainStep,
  PrivacyHeadersChecker, PrivatePageError, checkDuplicateStep, DuplicateError,
  processPrivacyPipelineStep, extractSentencesStep, formatMarkdownStep,
  saveToObsidianStep, saveLocalMarkdownStep, saveMetadataStep, saveSqliteStep
} from './steps/index.js';
import type { RecordingData, RecordingResult } from '../../messaging/types.js';
import type { Settings } from '../../utils/storage/types.js';
import { toExternalResult } from './piiBoundary.js';
import type { ObsidianClient } from '../obsidianClient.js';
import type { AIService } from '../ai/AIService.js';
import type { SqliteClient } from '../sqliteClient.js';
import { mapToBrowsingLogRecord } from './mappers/BrowsingLogRecordMapper.js';
import type { PrivacyInfo } from '../../utils/privacyChecker.js';
import type { OfflineNetworkQueue } from '../offlineNetworkQueue.js';
import { PerUrlMutexMap } from './perUrlMutex.js';
import { StepExecutor } from './stepExecutor.js';
import { PipelineKernel } from './PipelineKernel.js';

export interface RecordingPipelineDeps {
  getPrivacyInfoWithCache: (url: string) => Promise<PrivacyInfo | null>;
  getSettingsWithCache: () => Promise<Settings>;
  obsidian: ObsidianClient;
  aiService: AIService | null;
  sqliteClient: SqliteClient | null;
  offlineNetworkQueue?: OfflineNetworkQueue | null;
  urlStore?: UrlStore;
}

export function createRecordingPipeline(deps: RecordingPipelineDeps): RecordingPipeline {
  return new RecordingPipeline(deps.getPrivacyInfoWithCache, deps.obsidian, deps.aiService, deps.sqliteClient, deps.offlineNetworkQueue, deps.urlStore, deps.getSettingsWithCache);
}

export function buildRecordingPipelineDeps(deps: Pick<RecordingPipelineDeps, 'getPrivacyInfoWithCache' | 'getSettingsWithCache' | 'obsidian' | 'aiService' | 'sqliteClient' | 'urlStore' | 'offlineNetworkQueue'>): RecordingPipelineDeps {
  return { ...deps };
}

export class RecordingPipeline {
  private steps: PipelineStep[];
  private getPrivacyInfoWithCache: (url: string) => Promise<PrivacyInfo | null>;
  private getSettingsWithCache: () => Promise<Settings>;
  private obsidian: ObsidianClient;
  private aiService: AIService | null;
  private sqliteClient: SqliteClient | null;
  private urlStore: UrlStore | undefined;
  private mutexMap = new PerUrlMutexMap();
  private executor: StepExecutor;

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
    this.getPrivacyInfoWithCache = getPrivacyInfoWithCache;
    this.getSettingsWithCache = getSettingsWithCache;
    this.obsidian = obsidian;
    this.aiService = aiService;
    this.sqliteClient = sqliteClient;
    this.urlStore = urlStore;
    this.executor = new StepExecutor(offlineNetworkQueue);

    this.steps = [
      { name: 'truncate', errorStrategy: ErrorStrategy.FATAL, execute: truncateContentStep },
      { name: 'domainFilter', errorStrategy: ErrorStrategy.FATAL, execute: checkDomainFilterStep },
      { name: 'permission', errorStrategy: ErrorStrategy.FATAL, execute: checkPermissionStep },
      { name: 'trust', errorStrategy: ErrorStrategy.FATAL, execute: checkTrustDomainStep },
      { name: 'privacyHeaders', errorStrategy: ErrorStrategy.FATAL, execute: this.createPrivacyHeadersStep() },
      { name: 'duplicate', errorStrategy: ErrorStrategy.FATAL, execute: checkDuplicateStep },
      { name: 'privacyPipeline', errorStrategy: ErrorStrategy.RETRY, maxRetries: 3, offlineRetry: { jobKind: 'ai_summary' }, previewBreakpoint: true, execute: processPrivacyPipelineStep },
      { name: 'extractSentences', errorStrategy: ErrorStrategy.RETRY, maxRetries: 3, offlineRetry: { jobKind: 'ai_summary' }, execute: extractSentencesStep },
      { name: 'formatMarkdown', errorStrategy: ErrorStrategy.FATAL, execute: formatMarkdownStep },
      { name: 'saveObsidian', errorStrategy: ErrorStrategy.BEST_EFFORT, offlineRetry: { jobKind: 'obsidian_sync' }, execute: this.createSaveToObsidianStep() },
      { name: 'saveLocalMarkdown', errorStrategy: ErrorStrategy.BEST_EFFORT, execute: saveLocalMarkdownStep },
      { name: 'saveSqlite', errorStrategy: ErrorStrategy.BEST_EFFORT, execute: this.createSaveSqliteStep() },
      { name: 'saveMetadata', errorStrategy: ErrorStrategy.BEST_EFFORT, execute: saveMetadataStep }
    ];
  }

  private createPrivacyHeadersStep() {
    const checker = new PrivacyHeadersChecker(this.getPrivacyInfoWithCache);
    return (context: RecordingContext, _deps?: StepDeps) => checker.execute(context);
  }

  private createSaveToObsidianStep() {
    const deps: StepDeps = { obsidian: this.obsidian, aiService: this.aiService! };
    return (context: RecordingContext) => saveToObsidianStep(context, deps);
  }

  private createSaveSqliteStep() {
    return async (context: RecordingContext, _deps?: StepDeps): Promise<RecordingContext> => {
      if (!this.sqliteClient) {
        addLog(LogType.WARN, 'No SqliteClient available, skipping SQLite save', { url: context.data.url, traceId: context.traceId });
        return context;
      }
      const record = mapToBrowsingLogRecord(context);
      await saveSqliteStep({ recordId: 0, record, sqliteClient: this.sqliteClient, ...pickDefined({ obsidianSynced: context.obsidianDuration !== undefined ? true : undefined, traceId: context.traceId }) });
      addLog(LogType.INFO, 'Saved to SQLite', { url: context.data.url, title: context.data.title, traceId: context.traceId });
      return context;
    };
  }

  async execute(data: RecordingData, settings: Settings): Promise<RecordingResult> {
    return this.mutexMap.runExclusive(data.url, () => this.executeInternal(data, settings));
  }

  async record(data: RecordingData): Promise<RecordingResult> {
    const settings = await this.getSettingsWithCache();
    return this.execute(data, settings);
  }

  async recordWithPreview(data: RecordingData): Promise<RecordingResult> {
    return this.record({ ...data, previewOnly: true });
  }

  async retryObsidianWriteOnly(job: { title: string; url: string; summary: string; tags?: string[] }): Promise<boolean> {
    return this.mutexMap.runExclusive(job.url, async () => {
      const settings = await this.getSettingsWithCache();
      const context: RecordingContext = {
        data: { title: job.title, url: job.url, content: '' } as RecordingData,
        settings, force: true, errors: [],
        privacyResult: { summary: job.summary, ...pickDefined({ tags: job.tags }) },
      };
      const deps: StepDeps = { obsidian: this.obsidian, aiService: this.aiService! };
      let result = await formatMarkdownStep(context);
      result = await saveToObsidianStep(result, deps);
      if (result.obsidianDuration != null) notifyObsidianSaveSuccess(job.title);
      return true;
    });
  }

  private async executeInternal(data: RecordingData, settings: Settings): Promise<RecordingResult> {
    const traceId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : (() => { const a = new Uint32Array(2); if (typeof crypto !== 'undefined') crypto.getRandomValues(a); return (a[0] ?? 0).toString(36) + (a[1] ?? 0).toString(36); })();
    const deps: StepDeps = { obsidian: this.obsidian, aiService: this.aiService!, ...pickDefined({ urlStore: this.urlStore }) };
    const kernel = new PipelineKernel(this.steps, this.mutexMap, this.executor);
    return kernel.execute(data, settings, deps, traceId);
  }
}
