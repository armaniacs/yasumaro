/**
 * offlineNetworkQueue.ts
 * Queues network-dependent work (AI summary, Obsidian sync) when the browser
 * is offline or the remote endpoint is unreachable. Queued jobs persist in
 * chrome.storage.local so they survive Service Worker restarts.
 */

import { addLog, LogType } from '../utils/logger.js';

export interface OfflineJob {
  id: string;
  type: 'ai_summary' | 'obsidian_sync';
  payload: unknown;
  createdAt: number;
  retryCount: number;
  lastError?: string;
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

function estimatePayloadSize(payload: unknown): number {
  try {
    return new Blob([JSON.stringify(payload)]).size;
  } catch {
    return 0;
  }
}

function isExpired(job: OfflineJob): boolean {
  return Date.now() - job.createdAt > JOB_TTL_MS;
}

export class OfflineNetworkQueue {
  async enqueue(options: EnqueueOptions): Promise<void> {
    const { type, payload } = options;
    const size = estimatePayloadSize(payload);
    if (size > MAX_JOB_PAYLOAD_BYTES) {
      addLog(LogType.WARN, 'OfflineNetworkQueue: payload too large, dropping job', {
        type,
        size,
        max: MAX_JOB_PAYLOAD_BYTES,
      });
      return;
    }

    const queue = await this.loadQueue();
    const job: OfflineJob = {
      id: generateId(),
      type,
      payload,
      createdAt: Date.now(),
      retryCount: 0,
    };
    queue.push(job);
    if (queue.length > MAX_QUEUED_JOBS) {
      const dropped = queue.splice(0, queue.length - MAX_QUEUED_JOBS);
      addLog(LogType.WARN, 'OfflineNetworkQueue: queue full, dropped oldest jobs', {
        dropped: dropped.length,
      });
    }
    await this.saveQueue(queue);
    addLog(LogType.INFO, 'OfflineNetworkQueue: enqueued job', { type, id: job.id });
  }

  async dequeue(): Promise<OfflineJob | null> {
    const queue = await this.loadQueue();
    this.dropExpired(queue);
    if (queue.length === 0) return null;
    const job = queue.shift()!;
    await this.saveQueue(queue);
    return job;
  }

  async retryAll(handler: (job: OfflineJob) => Promise<boolean>): Promise<void> {
    const queue = await this.loadQueue();
    const expiredCount = this.dropExpired(queue);
    if (expiredCount > 0) {
      addLog(LogType.INFO, 'OfflineNetworkQueue: dropped expired jobs', { count: expiredCount });
    }

    // Only the first MAX_JOBS_PER_CYCLE jobs are processed this pass; the
    // rest are left untouched in the queue for the next alarm cycle
    // (PBI-2026-08-01-15).
    const jobsToProcess = queue.slice(0, MAX_JOBS_PER_CYCLE);
    const untouched = queue.slice(MAX_JOBS_PER_CYCLE);
    if (untouched.length > 0) {
      addLog(LogType.INFO, 'OfflineNetworkQueue: deferring jobs to next cycle', {
        deferred: untouched.length,
        processing: jobsToProcess.length,
      });
    }

    // Jobs not yet processed in this pass; persisted after every job so a
    // Service Worker termination mid-pass doesn't lose retryCount progress
    // for jobs already handled (PBI-2026-08-01-14).
    //
    // `pending` starts as a copy of `jobsToProcess` and each iteration
    // removes the job currently being handled via shift() rather than
    // filter(), since the for-of loop below visits jobsToProcess in the same
    // order it was built (queue.slice(0, N)) — the job at the front of
    // `pending` is always the one being processed (PBI-2026-08-01-18).
    const pending = [...jobsToProcess];
    const remaining: OfflineJob[] = [];

    for (const job of jobsToProcess) {
      pending.shift();

      try {
        const success = await handler(job);
        if (success) {
          addLog(LogType.INFO, 'OfflineNetworkQueue: job succeeded', { id: job.id, type: job.type });
          await this.saveQueue([...remaining, ...pending, ...untouched]);
          continue;
        }
        job.retryCount++;
      } catch (error) {
        job.retryCount++;
        job.lastError = error instanceof Error ? error.message : String(error);
      }

      if (job.retryCount >= MAX_RETRY_COUNT) {
        addLog(LogType.WARN, 'OfflineNetworkQueue: job exceeded max retries, dropping', {
          id: job.id,
          type: job.type,
        });
        await this.saveQueue([...remaining, ...pending, ...untouched]);
        continue;
      }

      remaining.push(job);
      await this.saveQueue([...remaining, ...pending, ...untouched]);
    }
  }

  async getQueueSize(): Promise<number> {
    const queue = await this.loadQueue();
    return queue.length;
  }

  async peek(): Promise<OfflineJob | null> {
    const queue = await this.loadQueue();
    this.dropExpired(queue);
    await this.saveQueue(queue);
    return queue[0] ?? null;
  }

  private async loadQueue(): Promise<OfflineJob[]> {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      const stored = result[STORAGE_KEY];
      return Array.isArray(stored) ? (stored as OfflineJob[]) : [];
    } catch (error) {
      addLog(LogType.ERROR, 'OfflineNetworkQueue: failed to load queue', { error: String(error) });
      return [];
    }
  }

  private async saveQueue(queue: OfflineJob[]): Promise<void> {
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: queue });
    } catch (error) {
      addLog(LogType.ERROR, 'OfflineNetworkQueue: failed to save queue', { error: String(error) });
    }
  }

  private dropExpired(queue: OfflineJob[]): number {
    let expired = 0;
    for (let i = queue.length - 1; i >= 0; i--) {
      if (isExpired(queue[i])) {
        queue.splice(i, 1);
        expired++;
      }
    }
    return expired;
  }
}

export const sharedOfflineNetworkQueue = new OfflineNetworkQueue();
