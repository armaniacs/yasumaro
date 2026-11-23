/**
 * offlineNetworkQueue.ts
 * Queues network-dependent work (AI summary, Obsidian sync) when the browser
 * is offline or the remote endpoint is unreachable. Queued jobs persist in
 * chrome.storage.local so they survive Service Worker restarts.
 */

import { LogType } from '../utils/logger/types.js';
import { addLog } from '../utils/logger/core.js';
import { generateId } from '../utils/generateId.js';
import { PersistentRetryQueue, ChromeStorageAdapter, RetryableItem } from './persistentRetryQueue.js';
import type { QueueStorageAdapter } from './queueStorageAdapter.js';
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

function createPersistentQueue(adapter: QueueStorageAdapter): PersistentRetryQueue<OfflineJob> {
  return new PersistentRetryQueue<OfflineJob>(adapter, {
    storageKey: STORAGE_KEY,
    maxSize: MAX_QUEUED_JOBS,
    logLabel: 'offlineNetworkQueue',
    ttlMs: JOB_TTL_MS,
    maxRetryCount: MAX_RETRY_COUNT,
    maxJobsPerCycle: MAX_JOBS_PER_CYCLE,
    maxPayloadBytes: MAX_JOB_PAYLOAD_BYTES,
    persistPerItem: true,
  });
}

const adapter = new ChromeStorageAdapter();
const queue = createPersistentQueue(adapter);

/**
 * Create an OfflineNetworkQueue over the given adapter.
 * Production passes ChromeStorageAdapter; tests inject InMemoryAdapter.
 */
export function createOfflineNetworkQueue(adapter: QueueStorageAdapter): OfflineNetworkQueue {
  return new OfflineNetworkQueue(createPersistentQueue(adapter));
}

/**
 * Port that OfflineNetworkQueue depends on. Lets tests substitute a NoOp
 * implementation via composition (see NoOpQueuePort below) instead of
 * subclassing and overriding every method.
 */
export interface QueuePort<T> {
  enqueue(item: T): Promise<boolean>;
  load(): Promise<T[]>;
  save(items: T[]): Promise<void>;
  flush(handler: (item: T) => Promise<boolean>, onDropped?: (item: T, reason: 'max-retries' | 'ttl') => Promise<void> | void): Promise<T[]>;
  getQueueSize(): Promise<number>;
  filterExpiredAndOverRetry(items: T[]): { kept: T[]; dropped: T[] };
  /** In-lock read-modify-write (VULN-056). dequeue/peek route through this. */
  mutate(fn: (items: T[]) => T[] | Promise<T[]>): Promise<boolean>;
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

  /**
   * Job objects already compensated by offsetNonFailureResult in this queue
   * instance (idempotency guard). Per-object identity is the right key: every
   * flush load materializes fresh job objects from storage, so each cycle may
   * lend once, while a duplicated call on the same reference lends nothing
   * more. Entries vanish with their job objects (WeakSet holds no strong
   * reference), so no cleanup pass is needed.
   */
  private readonly offsetApplied = new WeakSet<OfflineJob>();

  /**
   * Enqueue a job. Returns true when durably queued, false when the job was
   * dropped or could not be persisted (logged, never thrown — PBI 2026-09-17-15).
   */
  async enqueue(options: EnqueueOptions): Promise<boolean> {
    const job = OfflineJobFactory.create(options);
    const ok = await this.port.enqueue(job);
    if (ok) {
      addLog(LogType.INFO, 'OfflineNetworkQueue: enqueued job', { type: job.type, id: job.id });
    } else {
      addLog(LogType.ERROR, 'OfflineNetworkQueue: failed to enqueue job', { type: job.type, id: job.id });
    }
    return ok;
  }

  async dequeue(): Promise<OfflineJob | null> {
    // PBI 2026-09-12-08: route through the queue lock — the old direct
    // load→filter→save raced an in-flight flush (the exact VULN-056
    // interleave the lock exists for).
    let job: OfflineJob | null = null;
    const persisted = await this.port.mutate((jobs) => {
      // TTL/retry filtering lives only in PersistentRetryQueue.filterExpiredAndOverRetry
      // so flush()/flushBatch() and this facade never diverge on expiry policy.
      const { kept, dropped } = this.port.filterExpiredAndOverRetry(jobs);
      if (dropped.length > 0) {
        addLog(LogType.INFO, 'OfflineNetworkQueue: dropped expired jobs', { count: dropped.length });
      }
      if (kept.length === 0) return [];
      job = kept.shift()!;
      return kept;
    });
    // Fail-closed: when the mutation could not persist, the stored snapshot is
    // untouched, so the in-memory take must be discarded — otherwise the same
    // job would be processed twice (duplicate AI calls / Obsidian writes).
    if (!persisted) {
      addLog(LogType.WARN, 'OfflineNetworkQueue: dequeue not persisted, discarding take');
      return null;
    }
    return job;
  }

  async retryAll(
    handler: (job: OfflineJob) => Promise<boolean>,
    onDropped?: (job: OfflineJob, reason: 'max-retries' | 'ttl') => Promise<void> | void
  ): Promise<void> {
    await this.port.flush(handler, onDropped);
  }

  /**
   * Offset the retry increment flush() applies to every `false` handler
   * result when that `false` was NOT a send failure (e.g. the recovery claim
   * is held by another owner). flush() adds exactly one retry per `false`
   * before persisting, so pre-lending one here nets zero and the job is kept
   * without spending budget. Must be called on the same job reference flush
   * handed to the handler, immediately before returning `false` — the
   * increment lands on that same object.
   */
  offsetNonFailureResult(job: OfflineJob): void {
    // Guard non-finite budgets (e.g. a corrupted NaN from storage): lending
    // against them would spread the corruption instead of compensating a
    // flush increment, so they are left untouched.
    if (typeof job.retryCount !== 'number' || !Number.isFinite(job.retryCount)) return;
    // Idempotency: at most one lend per job object. A duplicated contention
    // branch calling this twice must not spend the budget twice for the single
    // increment flush() is about to apply.
    if (this.offsetApplied.has(job)) return;
    this.offsetApplied.add(job);
    // No lower bound here: the lend is always paired with flush()'s +1 on
    // the same object (see the contract above), so -1 + 1 nets exactly zero
    // even from a fresh budget of 0. Flooring at 0 would break the pairing
    // (0 -> 0 -> +1 lands at 1 and burns a retry on a job that was never
    // attempted). Unpaired lends cannot occur: this runs only on the false
    // path that flush() always follows with exactly one increment.
    job.retryCount = job.retryCount - 1;
  }

  async getQueueSize(): Promise<number> {
    return this.port.getQueueSize();
  }

  async peek(): Promise<OfflineJob | null> {
    let first: OfflineJob | null = null;
    const persisted = await this.port.mutate((jobs) => {
      const { kept, dropped } = this.port.filterExpiredAndOverRetry(jobs);
      if (dropped.length > 0) {
        addLog(LogType.INFO, 'OfflineNetworkQueue: dropped expired jobs', { count: dropped.length });
      }
      first = kept[0] ?? null;
      // Pure read when expiry changed nothing — keep the stored list as-is.
      return dropped.length > 0 ? kept : jobs;
    });
    // Peek is read-only, but a failed mutate means storage may be unusable;
    // report null so callers do not act on an unverifiable snapshot.
    if (!persisted) {
      addLog(LogType.WARN, 'OfflineNetworkQueue: peek not persisted, reporting empty');
      return null;
    }
    return first;
  }
}

/**
 * Shared instance predating the composition manifest; the constructor's
 * QueuePort param is the DI seam (NoOpQueuePort in tests). New SW-only deps
 * should resolve via the manifest instead of adding module singletons.
 * See dev-docs/ADR/2026-09-17-module-singleton-policy.md.
 *
 * Production wiring replaces this once from the composition root
 * (compositionManifest.offlineNetworkQueue onReady); tests swap in an
 * InMemoryAdapter-backed queue via setOfflineNetworkQueue so the shared
 * facade never touches real storage.
 */
export let sharedOfflineNetworkQueue = new OfflineNetworkQueue(queue);

/**
 * Inject the shared OfflineNetworkQueue. The composition root wires this once
 * via the manifest's onReady (compositionManifest.offlineNetworkQueue); tests
 * call it with a queue built from InMemoryAdapter to avoid touching
 * chrome.storage.
 */
export function setOfflineNetworkQueue(next: OfflineNetworkQueue): void {
  sharedOfflineNetworkQueue = next;
}

/**
 * Test alias for setOfflineNetworkQueue (same injection seam, BDD-facing name).
 */
export function setQueueForTesting(next: OfflineNetworkQueue): void {
  setOfflineNetworkQueue(next);
}

/**
 * NoOp QueuePort for tests: reports nothing pending, discards everything.
 * Injected via composition (OfflineNetworkQueue's constructor) so no
 * inheritance/override chain is needed.
 */
export class NoOpQueuePort implements QueuePort<OfflineJob> {
  async enqueue(): Promise<boolean> {
    // Intentionally discarded — this port never persists anything.
    return false;
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
  async mutate(fn: (items: OfflineJob[]) => OfflineJob[] | Promise<OfflineJob[]>): Promise<boolean> {
    await fn([]);
    return true;
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
