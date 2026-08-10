/**
 * offlineNetworkQueue.ts
 * Queues network-dependent work (AI summary, Obsidian sync) when the browser
 * is offline or the remote endpoint is unreachable. Queued jobs persist in
 * chrome.storage.local so they survive Service Worker restarts.
 */

import { addLog, LogType } from '../utils/logger.js';
import { errorMessage } from '../utils/errorUtils.js';
import { PersistentRetryQueue, ChromeStorageAdapter, RetryableItem } from './persistentRetryQueue.js';
import type { OfflineJobKind } from './pipeline/types.js';

export interface OfflineJob extends RetryableItem {
  id: string;
  type: OfflineJobKind;
  payload: unknown;
}

interface EnqueueOptions {
  type: OfflineJob['type'];
  payload: unknown;
}

const STORAGE_KEY = 'offline_network_queue';
const MAX_QUEUED_JOBS = 200;
const JOB_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_JOB_PAYLOAD_BYTES = 50 * 1024;
const MAX_RETRY_COUNT = 3;
// Caps how many jobs a single retryAll() pass processes. Without this, a
// large queue (up to MAX_QUEUED_JOBS) could trigger that many cloud AI calls
// back-to-back in one 5-minute alarm cycle with no rate limiting
// (PBI-2026-08-01-15). Jobs beyond the cap stay queued for the next cycle.
const MAX_JOBS_PER_CYCLE = 20;

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function isExpired(job: OfflineJob): boolean {
  return Date.now() - job.createdAt > JOB_TTL_MS;
}

const adapter = new ChromeStorageAdapter();
const queue = new PersistentRetryQueue<OfflineJob>(adapter, {
  storageKey: STORAGE_KEY,
  maxSize: MAX_QUEUED_JOBS,
  logLabel: 'offlineNetworkQueue',
  ttlMs: JOB_TTL_MS,
  maxRetryCount: MAX_RETRY_COUNT,
  maxJobsPerCycle: MAX_JOBS_PER_CYCLE,
  maxPayloadBytes: MAX_JOB_PAYLOAD_BYTES,
});

export class OfflineNetworkQueue {
  async enqueue(options: EnqueueOptions): Promise<void> {
    const job: OfflineJob = {
      id: generateId(),
      type: options.type,
      payload: options.payload,
      createdAt: Date.now(),
      retryCount: 0,
    };
    await queue.enqueue(job);
    addLog(LogType.INFO, 'OfflineNetworkQueue: enqueued job', { type: job.type, id: job.id });
  }

  async dequeue(): Promise<OfflineJob | null> {
    const jobs = await queue.load();
    const now = Date.now();
    const expired = jobs.filter(j => now - j.createdAt > JOB_TTL_MS);
    if (expired.length > 0) {
      addLog(LogType.INFO, 'OfflineNetworkQueue: dropped expired jobs', { count: expired.length });
    }
    const valid = jobs.filter(j => now - j.createdAt <= JOB_TTL_MS);
    if (valid.length === 0) return null;
    const job = valid.shift()!;
    await queue.save(valid);
    return job;
  }

  async retryAll(handler: (job: OfflineJob) => Promise<boolean>): Promise<void> {
    const jobs = await queue.load();
    const expiredCount = jobs.filter(j => Date.now() - j.createdAt > JOB_TTL_MS).length;
    if (expiredCount > 0) {
      addLog(LogType.INFO, 'OfflineNetworkQueue: dropped expired jobs', { count: expiredCount });
    }

    // Only the first MAX_JOBS_PER_CYCLE jobs are processed this pass; the
    // rest are left untouched in the queue for the next alarm cycle
    // (PBI-2026-08-01-15).
    const jobsToProcess = jobs.slice(0, MAX_JOBS_PER_CYCLE);
    const untouched = jobs.slice(MAX_JOBS_PER_CYCLE);
    if (untouched.length > 0) {
      addLog(LogType.INFO, 'OfflineNetworkQueue: deferring jobs to next cycle', {
        deferred: untouched.length,
        processing: jobsToProcess.length,
      });
    }

    // Jobs not yet processed in this pass; persisted after every job so a
    // Service Worker termination mid-pass doesn't lose retryCount progress
    // for jobs already handled (PBI-2026-08-01-14).
    const pending = [...jobsToProcess];
    const remaining: OfflineJob[] = [];

    for (const job of jobsToProcess) {
      pending.shift();

      try {
        const success = await handler(job);
        if (success) {
          addLog(LogType.INFO, 'OfflineNetworkQueue: job succeeded', { id: job.id, type: job.type });
          await queue.save([...remaining, ...pending, ...untouched]);
          continue;
        }
        job.retryCount++;
      } catch (error) {
        job.retryCount++;
        job.lastError = errorMessage(error);
      }

      if (job.retryCount >= MAX_RETRY_COUNT) {
        addLog(LogType.WARN, 'OfflineNetworkQueue: job exceeded max retries, dropping', {
          id: job.id,
          type: job.type,
        });
        await queue.save([...remaining, ...pending, ...untouched]);
        continue;
      }

      remaining.push(job);
      await queue.save([...remaining, ...pending, ...untouched]);
    }
  }

  async getQueueSize(): Promise<number> {
    return queue.getQueueSize();
  }

  async peek(): Promise<OfflineJob | null> {
    const jobs = await queue.load();
    const now = Date.now();
    const valid = jobs.filter(j => now - j.createdAt <= JOB_TTL_MS);
    await queue.save(valid);
    return valid[0] ?? null;
  }
}

export const sharedOfflineNetworkQueue = new OfflineNetworkQueue();
