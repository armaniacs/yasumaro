/**
 * offlineQueueProcessor.ts
 * Retries queued offline-network jobs (obsidian_sync / ai_summary) on the
 * yasumaro-offline-network-retry alarm. Extracted from service-worker.ts
 * as part of the God File split (PBI-29).
 */
import type { OfflineJob } from './offlineNetworkQueue.js';
import type { RecordingData } from '../messaging/types.js';
import { pickDefined } from '../utils/objectUtils.js';

interface OfflineNetworkQueueLike {
    retryAll(handler: (job: OfflineJob) => Promise<boolean>): Promise<void>;
}

interface RecordingPipelineLike {
    record(data: RecordingData): Promise<{ success: boolean; skipped?: boolean }>;
    retryObsidianWriteOnly(job: { title: string; url: string; summary: string; tags?: string[] }): Promise<boolean>;
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
            };

            // obsidian_sync jobs mean the AI summary already succeeded and only the
            // Obsidian append failed — retry that write only, without re-calling the
            // AI provider. Jobs queued before this field existed (or with a missing
            // summary) fall through to the full pipeline for backward compatibility.
            if (job.type === 'obsidian_sync' && payload.summary) {
                try {
                    return await deps.recordingPipeline.retryObsidianWriteOnly({
                        title: payload.title,
                        url: payload.url,
                        summary: payload.summary,
                        ...pickDefined({ tags: payload.tags }),
                    });
                } catch {
                    return false;
                }
            }

            try {
                const result = await deps.recordingPipeline.record({
                    title: payload.title,
                    url: payload.url,
                    content: payload.content,
                    force: false,
                    skipDuplicateCheck: true,
                    recordType: 'manual',
                } as RecordingData);
                return result.success && !result.skipped;
            } catch {
                return false;
            }
        });
    };
}
