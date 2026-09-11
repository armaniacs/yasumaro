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
import { buildRecordRequest } from './recordRequestBuilder.js';

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
            const payload = job.payload as {
                title: string;
                url: string;
                content: string;
                summary?: string;
                maskedCount?: number;
                tags?: string[];
                pageBytes?: number;
                candidateBytes?: number;
                originalBytes?: number;
                cleansedBytes?: number;
                aiSummaryOriginalBytes?: number;
                aiSummaryCleansedBytes?: number;
                aiSummaryCleansedElements?: number;
                aiSummaryCleansedReason?: import('../utils/commonTypes.js').AiSummaryCleansedReason;
                aiSummaryCleansedReasons?: string[];
            };

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
                // PBI 2026-09-12-04: route through the shared builder so the
                // diagnostic stats enqueued with the job survive the retry
                // (the old literal dropped them behind an `as` cast).
                const result = await deps.recordingPipeline.record(buildRecordRequest('offline-retry', {
                    title: payload.title,
                    url: payload.url,
                    content: payload.content,
                    maskedCount: payload.maskedCount,
                    pageBytes: payload.pageBytes,
                    candidateBytes: payload.candidateBytes,
                    originalBytes: payload.originalBytes,
                    cleansedBytes: payload.cleansedBytes,
                    aiSummaryOriginalBytes: payload.aiSummaryOriginalBytes,
                    aiSummaryCleansedBytes: payload.aiSummaryCleansedBytes,
                    aiSummaryCleansedElements: payload.aiSummaryCleansedElements,
                    aiSummaryCleansedReason: payload.aiSummaryCleansedReason,
                    aiSummaryCleansedReasons: payload.aiSummaryCleansedReasons,
                }));
                return result.success && !result.skipped;
            } catch (error) {
                logError('Offline full-pipeline retry failed', { cause: error, url: payload.url }, ErrorCode.INTERNAL_ERROR, 'service-worker');
                return false;
            }
        });
    };
}
