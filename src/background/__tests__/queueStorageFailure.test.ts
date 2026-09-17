/**
 * queueStorageFailure.test.ts
 * Pins the failure propagation contract of PersistentRetryQueue and the
 * pendingChromeStorageQueue facade (PBI 2026-09-17-15): a storage failure in
 * the last-resort queue must reach the caller as a structured log plus a
 * false return, never as a silent success and never by masking the caller's
 * original error.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  addLog: vi.fn(),
  LogType: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' },
}));

import { addLog } from '../../utils/logger.js';
import { PersistentRetryQueue } from '../persistentRetryQueue.js';
import type { QueueStorageAdapter } from '../queueStorageAdapter.js';
import {
  enqueuePendingWrite,
  createPendingWriteQueue,
  setPendingWriteQueue,
} from '../pendingChromeStorageQueue.js';

const LABEL = 'testQueue';

/**
 * Scripted adapter: seeds an in-memory store and can be told to fail load
 * or save independently, simulating quota/I-O failures of chrome.storage.
 */
class ScriptedAdapter implements QueueStorageAdapter {
  store = new Map<string, unknown[]>();
  failLoad = false;
  failSave = false;

  async load<T>(key: string): Promise<T[]> {
    if (this.failLoad) return Promise.reject(new Error('EIO: read failed'));
    return (this.store.get(key) as T[] | undefined) ?? [];
  }

  async save<T>(key: string, items: T[]): Promise<void> {
    if (this.failSave) return Promise.reject(new Error('EIO: quota exceeded'));
    this.store.set(key, items);
  }
}

function makeQueue(adapter: QueueStorageAdapter): PersistentRetryQueue<{ url: string }> {
  return new PersistentRetryQueue<{ url: string }>(adapter, {
    storageKey: 'q',
    maxSize: 100,
    logLabel: LABEL,
  });
}

function errorLogs(): string[] {
  return (addLog as ReturnType<typeof vi.fn>).mock.calls
    .filter(([type]) => type === 'ERROR')
    .map(([, message]) => String(message));
}

describe('PersistentRetryQueue storage failure propagation (PBI 2026-09-17-15)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('enqueue reports false and logs ERROR when save fails, without throwing', async () => {
    const adapter = new ScriptedAdapter();
    adapter.failSave = true;
    const queue = makeQueue(adapter);

    await expect(queue.enqueue({ url: 'https://example.com' })).resolves.toBe(false);
    expect(errorLogs().some((m) => m.includes('failed to enqueue'))).toBe(true);
  });

  it('enqueue reports false and logs ERROR when load fails, without throwing', async () => {
    const adapter = new ScriptedAdapter();
    adapter.failLoad = true;
    const queue = makeQueue(adapter);

    await expect(queue.enqueue({ url: 'https://example.com' })).resolves.toBe(false);
    expect(errorLogs().some((m) => m.includes('failed to enqueue'))).toBe(true);
  });

  it('never masks the caller original error when the queue save also fails', async () => {
    const adapter = new ScriptedAdapter();
    adapter.failSave = true;
    const queue = makeQueue(adapter);

    const originalError = new Error('primary chrome.storage write failed');
    let caught: unknown;
    try {
      throw originalError;
    } catch (error) {
      // Caller pattern: primary write failed -> enqueue into the fallback queue.
      const queued = await queue.enqueue({ url: 'https://example.com' });
      expect(queued).toBe(false);
      caught = error;
    }
    expect(caught).toBe(originalError);
  });

  it('flush treats a failed load as an unresolved cycle, not an empty queue', async () => {
    const adapter = new ScriptedAdapter();
    adapter.store.set('q', [{ url: 'https://pending.example.com' }]);
    adapter.failLoad = true;
    const saveSpy = vi.spyOn(adapter, 'save');
    const queue = makeQueue(adapter);

    const handler = vi.fn(async () => true);
    await expect(queue.flush(handler)).resolves.toEqual([]);

    expect(handler).not.toHaveBeenCalled();
    expect(saveSpy).not.toHaveBeenCalled();
    expect(errorLogs().some((m) => m.includes('failed to load queue for flush'))).toBe(true);
  });

  it('flush with a failing persist keeps the persisted snapshot untouched', async () => {
    const adapter = new ScriptedAdapter();
    const pending = [{ url: 'https://pending.example.com' }];
    adapter.store.set('q', pending);
    adapter.failSave = true;
    const queue = makeQueue(adapter);

    const handler = vi.fn(async () => true);
    const result = await queue.flush(handler);

    // In-memory result reflects progress, but storage keeps the pre-flush
    // snapshot so the pending item survives for the next flush cycle.
    expect(result).toEqual([]);
    expect(adapter.store.get('q')).toEqual(pending);
    expect(errorLogs().some((m) => m.includes('failed to persist remaining items'))).toBe(true);
  });

  it('mutate reports false and logs ERROR when persistence fails', async () => {
    const adapter = new ScriptedAdapter();
    adapter.failSave = true;
    const queue = makeQueue(adapter);

    await expect(queue.mutate((items) => items)).resolves.toBe(false);
    expect(errorLogs().some((m) => m.includes('failed to mutate queue'))).toBe(true);
  });
});

describe('pendingChromeStorageQueue failure propagation (PBI 2026-09-17-15)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('enqueuePendingWrite reports false for a plain write when the queue cannot persist', async () => {
    const adapter = new ScriptedAdapter();
    adapter.failSave = true;
    setPendingWriteQueue(createPendingWriteQueue(adapter));

    await expect(
      enqueuePendingWrite({ key: 'savedUrlsWithTimestamps', value: [{ url: 'https://example.com' }] })
    ).resolves.toBe(false);
  });

  it('enqueuePendingWrite reports false for a metadata patch when the queue cannot persist', async () => {
    const adapter = new ScriptedAdapter();
    adapter.failSave = true;
    setPendingWriteQueue(createPendingWriteQueue(adapter));

    await expect(
      enqueuePendingWrite({
        type: 'metadataPatch',
        key: 'savedUrlsWithTimestamps',
        url: 'https://example.com',
        patch: { title: 't' },
        refreshTimestamp: false,
        timestamp: Date.now(),
        mergeTags: true,
        createdAt: Date.now(),
        retryCount: 0,
      })
    ).resolves.toBe(false);
  });
});
