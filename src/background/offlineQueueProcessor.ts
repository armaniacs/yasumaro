/**
 * offlineQueueProcessor.ts
 * Retries queued offline-network jobs (obsidian_sync / ai_summary) on the
 * yasumaro-offline-network-retry alarm. Extracted from service-worker.ts
 * as part of the God File split (PBI-29).
 */
import type { OfflineJob } from './offlineNetworkQueue.js';
import type { RecordingData } from '../messaging/types.js';
import { pickDefined } from '../utils/objectUtils.js';
import { logError, logWarn, ErrorCode } from '../utils/logger.js';
import { buildOfflineRetryRequest, type OfflineJobPayload } from './recordRequestBuilder.js';

interface OfflineNetworkQueueLike {
    retryAll(handler: (job: OfflineJob) => Promise<boolean>): Promise<void>;
}

interface RecordingPipelineLike {
    record(data: RecordingData): Promise<{ success: boolean; skipped?: boolean }>;
    retryObsidianWrite(job: { title: string; url: string; summary: string; tags?: string[] }): Promise<boolean>;
}

export interface OfflineQueueProcessorDeps {
    offlineNetworkQueue: OfflineNetworkQueueLike;
    recordingPipeline: RecordingPipelineLike;
}

export function createOfflineQueueProcessor(deps: OfflineQueueProcessorDeps): () => Promise<void> {
    return async function processOfflineNetworkQueue(): Promise<void> {
        await deps.offlineNetworkQueue.retryAll(async (job: OfflineJob) => {
            // PBI 2026-09-12-11: the payload shape is owned by the shared
            // field table (OfflineJobPayload) — no third spelling here.
            const payload = job.payload as OfflineJobPayload;

            // obsidian_sync jobs mean the AI summary already succeeded and only the
            // Obsidian append failed — retry that write only, without re-calling the
            // AI provider. Jobs queued before this field existed (or with a missing
            // summary) fall through to the full pipeline for backward compatibility.
            if (job.type === 'obsidian_sync' && payload.summary) {
                try {
                    return await deps.recordingPipeline.retryObsidianWrite({
                        title: payload.title,
                        url: payload.url,
                        summary: payload.summary,
                        ...pickDefined({ tags: payload.tags }),
                    });
                } catch (error) {
                    // Poison jobs must be distinguishable from transient
                    // failures in telemetry (PBI 2026-09-12-04).
                    logWarn('Offline obsidian_sync retry failed', { url: payload.url, error: error instanceof Error ? error.message : String(error) }, undefined, 'service-worker');
                    return false;
                }
            }

            try {
                // PBI 2026-09-12-11: rebuild through the shared field table so
                // the retry cannot drop fields the enqueue packed.
                const result = await deps.recordingPipeline.record(buildOfflineRetryRequest(payload));
                return result.success && !result.skipped;
            } catch (error) {
                logError('Offline full-pipeline retry failed', { cause: error, url: payload.url }, ErrorCode.INTERNAL_ERROR, 'service-worker');
                return false;
            }
        });
    };
}
