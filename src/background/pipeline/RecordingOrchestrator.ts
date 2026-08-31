/**
 * RecordingOrchestrator — deep module hiding 13 steps + PerUrlMutex + PipelineKernel
 *
 * Interface is one method: record(data, opts) -> RecordingResult.
 * All 13 steps, mutex, kernel, executor, traceId generation, and the
 * retry/preview modes are hidden behind the seam.
 *
 * Deletion test: deleting this module forces 13 step registrations + mutex +
 * kernel to reappear in every caller. Deleting a shallow factory only moves one line.
 */

import { addLog, LogType } from '../../utils/logger.js';
import { pickDefined } from '../../utils/objectUtils.js';
import { ErrorStrategy, type RecordingContext, type PipelineStep, type StepDeps, type UrlStore } from './types.js';
import { notifyObsidianSaveSuccess } from './resultBuilder.js';
import {
  truncateContentStep, checkDomainFilterStep, checkPermissionStep, checkTrustDomainStep,
  PrivacyHeadersChecker, checkDuplicateStep,
  processPrivacyPipelineStep, extractSentencesStep, formatMarkdownStep,
  saveToObsidianStep, saveLocalMarkdownStep, saveMetadataStep, saveSqliteStep
} from './steps/index.js';
import type { RecordingData, RecordingResult } from '../../messaging/types.js';
import type { Settings } from '../../utils/storage/types.js';
import type { ObsidianClient } from '../obsidianClient.js';
import type { AIService } from '../ai/AIService.js';
import type { SqliteClient } from '../sqliteClient.js';
import { mapToBrowsingLogRecord } from './mappers/BrowsingLogRecordMapper.js';
import type { PrivacyInfo } from '../../utils/privacyChecker.js';
import type { OfflineNetworkQueue } from '../offlineNetworkQueue.js';
import { PerUrlMutexMap } from './perUrlMutex.js';
import { StepExecutor } from './stepExecutor.js';
import { PipelineKernel } from './PipelineKernel.js';

export interface RecordingOrchestratorDeps {
  getPrivacyInfoWithCache: (url: string) => Promise<PrivacyInfo | null>;
  getSettingsWithCache: () => Promise<Settings>;
  obsidian: ObsidianClient;
  aiService: AIService | null;
  sqliteClient: SqliteClient | null;
  offlineNetworkQueue?: OfflineNetworkQueue | null;
  urlStore?: UrlStore;
  perUrlMutexMap?: PerUrlMutexMap;
}

export type RecordMode = 'normal' | 'preview' | 'retryObsidian';

export interface RecordOptions {
  mode?: RecordMode;
  previewOnly?: boolean;
}

export class RecordingOrchestrator {
  private steps: PipelineStep[];
  private getPrivacyInfoWithCache: (url: string) => Promise<PrivacyInfo | null>;
  private getSettingsWithCache: () => Promise<Settings>;
  private obsidian: ObsidianClient;
  private aiService: AIService | null;
  private sqliteClient: SqliteClient | null;
  private urlStore: UrlStore | undefined;
  private mutexMap: PerUrlMutexMap;
  private executor: StepExecutor;

  constructor(deps: RecordingOrchestratorDeps) {
    this.getPrivacyInfoWithCache = deps.getPrivacyInfoWithCache;
    this.getSettingsWithCache = deps.getSettingsWithCache;
    this.obsidian = deps.obsidian;
    this.aiService = deps.aiService;
    this.sqliteClient = deps.sqliteClient;
    this.urlStore = deps.urlStore;
    this.mutexMap = deps.perUrlMutexMap ?? new PerUrlMutexMap();
    this.executor = new StepExecutor(deps.offlineNetworkQueue ?? null);

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
    // Unified via StepDeps so test and prod use the same seam (previously closure over this.sqliteClient)
    return async (context: RecordingContext, deps?: StepDeps): Promise<RecordingContext> => {
      const client = (deps?.sqliteClient as unknown as SqliteClient | null | undefined) ?? this.sqliteClient;
      if (!client) {
        addLog(LogType.WARN, 'No SqliteClient available, skipping SQLite save', { url: context.data.url, traceId: context.traceId });
        return context;
      }
      const record = mapToBrowsingLogRecord(context);
      await saveSqliteStep({ recordId: 0, record, sqliteClient: client, ...pickDefined({ obsidianSynced: context.obsidianDuration !== undefined ? true : undefined, traceId: context.traceId }) });
      addLog(LogType.INFO, 'Saved to SQLite', { url: context.data.url, title: context.data.title, traceId: context.traceId });
      return context;
    };
  }

  private generateTraceId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    const a = new Uint32Array(2);
    if (typeof crypto !== 'undefined') crypto.getRandomValues(a);
    return (a[0] ?? 0).toString(36) + (a[1] ?? 0).toString(36);
  }

  /**
   * Deep seam: one method for all recording paths.
   * - normal: full 13 steps
   * - preview: short-circuit after privacyPipeline (previewBreakpoint)
   * - retryObsidian: formatMarkdown + saveToObsidian only
   */
  async record(data: RecordingData, opts: RecordOptions = {}): Promise<RecordingResult> {
    const mode: RecordMode = opts.mode ?? (opts.previewOnly || (data as { previewOnly?: boolean }).previewOnly ? 'preview' : 'normal');

    if (mode === 'retryObsidian') {
      return this.mutexMap.runExclusive(data.url, async () => {
        const settings = await this.getSettingsWithCache();
        const context: RecordingContext = {
          data: { title: (data as unknown as { title: string }).title ?? '', url: data.url, content: '' } as RecordingData,
          // retry payload may be { title, url, summary, tags } — pick summary/tags
          settings, force: true, errors: [],
          privacyResult: { summary: (data as unknown as { summary: string }).summary ?? '', ...pickDefined({ tags: (data as unknown as { tags?: string[] }).tags }) },
        };
        // Also handle job shape { title, url, summary, tags } passed via record()
        const summary = (data as unknown as { summary?: string }).summary ?? (context.privacyResult as { summary?: string }).summary ?? '';
        const tags = (data as unknown as { tags?: string[] }).tags;
        context.privacyResult = { summary, ...pickDefined({ tags }) };
        const deps: StepDeps = { obsidian: this.obsidian, aiService: this.aiService! };
        let result = await formatMarkdownStep(context);
        result = await saveToObsidianStep(result, deps);
        if (result.obsidianDuration != null) notifyObsidianSaveSuccess((data as unknown as { title: string }).title ?? data.url);
        // For retry mode, return minimal success result
        return { success: true } as unknown as RecordingResult;
      });
    }

    // preview mode is handled by PipelineKernel's previewBreakpoint on privacyPipeline step
    const effectiveData = mode === 'preview' ? { ...data, previewOnly: true } as RecordingData : data;
    const settings = await this.getSettingsWithCache();
    return this.mutexMap.runExclusive(effectiveData.url, () => this.executeInternal(effectiveData, settings));
  }

  // Convenience alias for callers that previously used recordWithPreview
  async recordWithPreview(data: RecordingData): Promise<RecordingResult> {
    return this.record(data, { mode: 'preview' });
  }

  async retryObsidianWriteOnly(job: { title: string; url: string; summary: string; tags?: string[] }): Promise<boolean> {
    const result = await this.record(job as unknown as RecordingData, { mode: 'retryObsidian' });
    return Boolean((result as unknown as { success: boolean }).success ?? true);
  }

  private async executeInternal(data: RecordingData, settings: Settings): Promise<RecordingResult> {
    const traceId = this.generateTraceId();
    const deps: StepDeps = { obsidian: this.obsidian, aiService: this.aiService!, ...pickDefined({ urlStore: this.urlStore, sqliteClient: this.sqliteClient }) as unknown as Pick<StepDeps, 'urlStore' | 'sqliteClient'> };
    const kernel = new PipelineKernel(this.steps, this.mutexMap, this.executor);
    return kernel.execute(data, settings, deps, traceId);
  }
}

export function createRecordingOrchestrator(deps: RecordingOrchestratorDeps): RecordingOrchestrator {
  return new RecordingOrchestrator(deps);
}
