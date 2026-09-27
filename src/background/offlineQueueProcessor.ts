/**
 * offlineQueueProcessor.ts
 * Retries queued offline-network jobs (obsidian_sync / ai_summary) on the
 * yasumaro-offline-network-retry alarm. Extracted from service-worker.ts
 * as part of the God File split (PBI-29).
 *
 * PBI 2026-09-25-12: a job dropped as a terminal failure (3 retries used up
 * or TTL expired) is handed to a pending page — the sole remaining recovery
 * owner — before the queue forgets it, and the pending-recovery notice is
 * sent exactly once at that handover.
 */
import type { OfflineJob } from './offlineNetworkQueue.js';
import type { RecordingData } from '../messaging/types.js';
import { pickDefined } from '../utils/objectUtils.js';
import { ErrorCode } from '../utils/logger/types.js';
import { logError, logWarn } from '../utils/logger/api.js';
import { errorMessage } from '../utils/errorUtils.js';
import { getMessageOr } from '../utils/i18n.js';
import { addPendingPage } from '../utils/pendingStorage.js';
import { claimRecoveryOwner, releaseRecoveryOwner } from '../utils/recoveryClaimStore.js';
import { notifyRecordingError } from './pipeline/resultBuilder.js';
import { buildOfflineRetryRequest, type OfflineJobPayload } from './recordRequestBuilder.js';

/** Same pending recovery TTL the outcome policy uses (recordingOutcome). */
const HANDOVER_PENDING_TTL_MS = 24 * 60 * 60 * 1000;

interface OfflineNetworkQueueLike {
    retryAll(
        handler: (job: OfflineJob) => Promise<boolean>,
        onDropped?: (job: OfflineJob, reason: 'max-retries' | 'ttl') => Promise<void> | void
    ): Promise<void>;
}

interface RecordingPipelineLike {
    record(data: RecordingData): Promise<{ success: boolean; skipped?: boolean }>;
    retryObsidianWrite(job: { title: string; url: string; summary: string; tags?: string[] }): Promise<boolean>;
}

/**
 * Terminal-failure seam (PBI 2026-09-25-12): records a pending page for the
 * dropped job and notifies the user exactly once. Injectable so tests can
 * observe the handover without chrome.storage / notifications.
 */
export interface TerminalFailureHandler {
    handOver(job: OfflineJob): Promise<void>;
}

const prodTerminalFailureHandler: TerminalFailureHandler = {
    async handOver(job: OfflineJob): Promise<void> {
        const payload = job.payload as OfflineJobPayload;
        // Without a URL there is nothing a pending page could recover.
        if (!payload.url) {
            logWarn('Offline terminal-failure handover skipped: payload has no URL', { type: job.type }, undefined, 'service-worker');
            return;
        }
        await addPendingPage({
            url: payload.url,
            title: payload.title,
            timestamp: Date.now(),
            reason: job.type === 'obsidian_sync' ? 'obsidian-write-failed' : 'pipeline-error',
            errorMessage: 'Offline retry exhausted (max 3 attempts)',
            expiry: Date.now() + HANDOVER_PENDING_TTL_MS,
        });
        notifyRecordingError(
            payload.title || payload.url,
            getMessageOr('pendingRecoveryReady', 'Automatic retries were exhausted. You can re-run this recording from the pending pages list.')
        );
    },
};

export interface OfflineQueueProcessorDeps {
    offlineNetworkQueue: OfflineNetworkQueueLike;
    recordingPipeline: RecordingPipelineLike;
    terminalFailureHandler?: TerminalFailureHandler;
}

export function createOfflineQueueProcessor(deps: OfflineQueueProcessorDeps): () => Promise<void> {
    const terminalFailureHandler = deps.terminalFailureHandler ?? prodTerminalFailureHandler;
    return async function processOfflineNetworkQueue(): Promise<void> {
        await deps.offlineNetworkQueue.retryAll(async (job: OfflineJob) => {
            // PBI 2026-09-12-11: the payload shape is owned by the shared
            // field table (OfflineJobPayload) — no third spelling here.
            const payload = job.payload as OfflineJobPayload;

            // PBI 2026-09-25-12: the offline job is the recovery owner — take
            // the durable claim so a concurrent manual re-run cannot start the
            // same recording twice. Failed claim = someone else owns it now.
            if (!(await claimRecoveryOwner(payload.url, 'offline-queue'))) {
                logWarn('Offline retry skipped: recovery claim held by another owner', { url: payload.url }, undefined, 'service-worker');
                return false;
            }
            try {
                return await processJob(job, payload);
            } finally {
                await releaseRecoveryOwner(payload.url, 'offline-queue');
            }
        }, (job) => terminalFailureHandler.handOver(job));
    };

    async function processJob(job: OfflineJob, payload: OfflineJobPayload): Promise<boolean> {
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
                logWarn('Offline obsidian_sync retry failed', { url: payload.url, error: errorMessage(error) }, undefined, 'service-worker');
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
    }
}
