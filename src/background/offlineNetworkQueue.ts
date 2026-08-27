/**
 * offlineNetworkQueue.ts
 * Queues network-dependent work (AI summary, Obsidian sync) when the browser
 * is offline or the remote endpoint is unreachable. Queued jobs persist in
 * chrome.storage.local so they survive Service Worker restarts.
 */

import { addLog, LogType } from '../utils/logger.js';
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

const adapter = new ChromeStorageAdapter();
const queue = new PersistentRetryQueue<OfflineJob>(adapter, {
  storageKey: STORAGE_KEY,
  maxSize: MAX_QUEUED_JOBS,
  logLabel: 'offlineNetworkQueue',
  ttlMs: JOB_TTL_MS,
  maxRetryCount: MAX_RETRY_COUNT,
  maxJobsPerCycle: MAX_JOBS_PER_CYCLE,
  maxPayloadBytes: MAX_JOB_PAYLOAD_BYTES,
  persistPerItem: true,
});

/**
 * Port that OfflineNetworkQueue depends on. Lets tests substitute a NoOp
 * implementation via composition (see NoOpQueuePort below) instead of
 * subclassing and overriding every method.
 */
export interface QueuePort<T> {
  enqueue(item: T): Promise<void>;
  load(): Promise<T[]>;
  save(items: T[]): Promise<void>;
  flush(handler: (item: T) => Promise<boolean>): Promise<T[]>;
  getQueueSize(): Promise<number>;
  filterExpiredAndOverRetry(items: T[]): { kept: T[]; dropped: T[] };
}

/** Builds OfflineJob values with generated id/createdAt/retryCount so callers only supply intent. */
export const OfflineJobFactory = {
  create(options: EnqueueOptions): OfflineJob {
    return {
      id: generateId(),
      type: options.type,
      payload: options.payload,
      createdAt: Date.now(),
      retryCount: 0,
    };
  },
};

export class OfflineNetworkQueue {
  constructor(private readonly port: QueuePort<OfflineJob> = queue) {}

  async enqueue(options: EnqueueOptions): Promise<void> {
    const job = OfflineJobFactory.create(options);
    await this.port.enqueue(job);
    addLog(LogType.INFO, 'OfflineNetworkQueue: enqueued job', { type: job.type, id: job.id });
  }

  async dequeue(): Promise<OfflineJob | null> {
    const jobs = await this.port.load();
    // TTL/retry filtering lives only in PersistentRetryQueue.filterExpiredAndOverRetry
    // so flush()/flushBatch() and this facade never diverge on expiry policy.
    const { kept, dropped } = this.port.filterExpiredAndOverRetry(jobs);
    if (dropped.length > 0) {
      addLog(LogType.INFO, 'OfflineNetworkQueue: dropped expired jobs', { count: dropped.length });
    }
    if (kept.length === 0) return null;
    const job = kept.shift()!;
    await this.port.save(kept);
    return job;
  }

  async retryAll(handler: (job: OfflineJob) => Promise<boolean>): Promise<void> {
    await this.port.flush(handler);
  }

  async getQueueSize(): Promise<number> {
    return this.port.getQueueSize();
  }

  async peek(): Promise<OfflineJob | null> {
    const jobs = await this.port.load();
    const { kept, dropped } = this.port.filterExpiredAndOverRetry(jobs);
    if (dropped.length > 0) {
      await this.port.save(kept);
    }
    return kept[0] ?? null;
  }
}

export const sharedOfflineNetworkQueue = new OfflineNetworkQueue();

/**
 * NoOp QueuePort for tests: reports nothing pending, discards everything.
 * Injected via composition (OfflineNetworkQueue's constructor) so no
 * inheritance/override chain is needed.
 */
export class NoOpQueuePort implements QueuePort<OfflineJob> {
  async enqueue(): Promise<void> {
    // Intentionally discarded — this port never persists anything.
  }
  async load(): Promise<OfflineJob[]> {
    return [];
  }
  async save(): Promise<void> {
    // Nothing to persist.
  }
  async flush(): Promise<OfflineJob[]> {
    return [];
  }
  async getQueueSize(): Promise<number> {
    return 0;
  }
  filterExpiredAndOverRetry(items: OfflineJob[]): { kept: OfflineJob[]; dropped: OfflineJob[] } {
    return { kept: items, dropped: [] };
  }
}

/**
 * No-op queue for tests: enqueue/dequeue are ignored, retryAll/peek report
 * nothing pending. Avoids touching chrome.storage.local in tests that don't
 * care about offline-retry behaviour.
 */
export class NoOpOfflineNetworkQueue extends OfflineNetworkQueue {
  constructor() {
    super(new NoOpQueuePort());
  }
}
