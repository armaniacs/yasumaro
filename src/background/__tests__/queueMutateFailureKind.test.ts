/**
 * queueMutateFailureKind.test.ts
 * Pins that PersistentRetryQueue.mutate distinguishes caller-policy failures
 * (fn throws) from storage failures (load/save reject) with separate log
 * messages, so quota/I-O triage does not misdiagnose a caller bug.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  addLog: vi.fn(),
  LogType: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' },
}));

import { addLog } from '../../utils/logger.js';
import { PersistentRetryQueue } from '../persistentRetryQueue.js';
import type { QueueStorageAdapter } from '../queueStorageAdapter.js';

function messagesOf(type: string): string[] {
  return (addLog as ReturnType<typeof vi.fn>).mock.calls
    .filter(([t]) => t === type)
    .map(([, message]) => String(message));
}

function storageFailures(): { load: boolean; save: boolean } {
  return { load: false, save: false };
}

function makeAdapter(store: Map<string, unknown[]>, failures: { load: boolean; save: boolean }): QueueStorageAdapter {
  return {
    async load<T>(key: string): Promise<T[]> {
      if (failures.load) return Promise.reject(new Error('EIO: read failed'));
      return (store.get(key) as T[] | undefined) ?? [];
    },
    async save<T>(key: string, items: T[]): Promise<void> {
      if (failures.save) return Promise.reject(new Error('EIO: quota exceeded'));
      store.set(key, items);
    },
  };
}

function makeQueue(store: Map<string, unknown[]>, failures = storageFailures()): PersistentRetryQueue<{ url: string }> {
  return new PersistentRetryQueue<{ url: string }>(makeAdapter(store, failures), {
    storageKey: 'q',
    maxSize: 100,
    logLabel: 'testQueue',
  });
}

describe('PersistentRetryQueue.mutate failure attribution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs "failed to apply queue mutation" (not a storage message) when fn throws', async () => {
    const store = new Map<string, unknown[]>([['q', [{ url: 'https://a.example.com' }]]]);
    const queue = makeQueue(store);

    await expect(
      queue.mutate(() => {
        throw new Error('coalesce bug');
      }),
    ).resolves.toBe(false);

    const errors = messagesOf('ERROR');
    expect(errors.some((m) => m.includes('failed to apply queue mutation'))).toBe(true);
    expect(errors.some((m) => m === 'testQueue: failed to mutate queue')).toBe(false);
    // Storage snapshot untouched.
    expect(store.get('q')).toEqual([{ url: 'https://a.example.com' }]);
  });

  it('logs "failed to mutate queue" when save rejects', async () => {
    const failures = storageFailures();
    failures.save = true;
    const queue = makeQueue(new Map(), failures);

    await expect(queue.mutate((items) => items)).resolves.toBe(false);

    const errors = messagesOf('ERROR');
    expect(errors.some((m) => m.includes('failed to mutate queue'))).toBe(true);
    expect(errors.some((m) => m.includes('failed to apply queue mutation'))).toBe(false);
  });

  it('logs "failed to mutate queue" when load rejects', async () => {
    const failures = storageFailures();
    failures.load = true;
    const queue = makeQueue(new Map(), failures);

    await expect(queue.mutate((items) => items)).resolves.toBe(false);

    expect(messagesOf('ERROR').some((m) => m.includes('failed to mutate queue'))).toBe(true);
  });
});
