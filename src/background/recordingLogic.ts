/**
 * RecordingLogic
 * Thin delegation layer over RecordingPipeline.
 *
 * All orchestration (mutex, retry, step execution) now lives in RecordingPipeline.
 * This class exists only for backward compatibility with callers that reference
 * RecordingLogic by name (createBackgroundServices, service-worker, handlers).
 *
 * Caching logic extracted to RecordingCache (PBI-2026-08-08-01).
 * Validation/truncation extracted to RecordingValidator.
 */

import type { RecordingData, RecordingResult } from '../messaging/types.js';
import type { RecordingPipeline } from './pipeline/RecordingPipeline.js';
import { RecordingCache } from './recordingCache.js';

// Re-export RecordingCache for backward compatibility
export { RecordingCache } from './recordingCache.js';
export { SETTINGS_CACHE_TTL } from './recordingCache.js';
export { redactSettingsApiKeys } from './recordingCache.js';
export { truncateContentSize, isValidFetchUrl, MAX_RECORD_SIZE } from './recordingValidator.js';

// Re-export RecordingData from the canonical source (messaging/types.ts)
export type { RecordingData } from '../messaging/types.js';

/**
 * Recording orchestration.
 * Delegates to RecordingPipeline which owns per-URL mutex and step execution.
 */
export class RecordingLogic {
  private pipeline: RecordingPipeline;

  constructor(pipeline: RecordingPipeline) {
    this.pipeline = pipeline;
  }

  /**
   * Retry an Obsidian write for an offline-queued job.
   * Delegates to pipeline.retryObsidianWriteOnly.
   */
  async retryObsidianWriteOnly(job: {
    title: string;
    url: string;
    summary: string;
    tags?: string[];
  }): Promise<boolean> {
    return this.pipeline.retryObsidianWriteOnly(job);
  }

  /**
   * Record a browsing event.
   * Delegates to pipeline.execute (which handles per-URL mutex).
   */
  async record(data: RecordingData): Promise<RecordingResult> {
    const settings = await RecordingCache.getSettingsWithCache();
    return this.pipeline.execute(data, settings);
  }

  /**
   * Record a browsing event in preview mode.
   */
  async recordWithPreview(data: RecordingData): Promise<RecordingResult> {
    return this.record({ ...data, previewOnly: true });
  }
}
