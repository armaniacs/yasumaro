import { describe, it, expect, vi, beforeEach } from 'vitest';
import { enqueuePendingWrite, flushPendingWrites, PENDING_CHROME_STORAGE_KEY } from '../pendingChromeStorageQueue.js';

describe('pendingChromeStorageQueue', () => {
  let storageData: Record<string, unknown>;

  beforeEach(() => {
    storageData = {};
    globalThis.chrome = {
      storage: {
        local: {
          get: vi.fn((key: string) => Promise.resolve({ [key]: storageData[key] })),
          set: vi.fn((obj: Record<string, unknown>) => {
            Object.assign(storageData, obj);
            return Promise.resolve();
          }),
        },
      },
    } as unknown as typeof chrome;
  });

  it('queues a failed write and retries it on flush', async () => {
    await enqueuePendingWrite({ key: 'savedUrlsWithTimestamps', value: [{ url: 'https://example.com', title: 't', timestamp: 1 }] });

    const retryFn = vi.fn().mockResolvedValue(true);
    await flushPendingWrites(retryFn);

    expect(retryFn).toHaveBeenCalledWith({ key: 'savedUrlsWithTimestamps', value: [{ url: 'https://example.com', title: 't', timestamp: 1 }] });
  });

  it('keeps a write queued when retry fails', async () => {
    await enqueuePendingWrite({ key: 'savedUrlsWithTimestamps', value: [] });

    const retryFn = vi.fn().mockResolvedValue(false);
    await flushPendingWrites(retryFn);

    const remaining = storageData[PENDING_CHROME_STORAGE_KEY] as unknown[];
    expect(remaining).toHaveLength(1);
  });

  it('caps the queue at MAX_PENDING_WRITES entries', async () => {
    for (let i = 0; i < 600; i++) {
      await enqueuePendingWrite({ key: 'savedUrlsWithTimestamps', value: [], id: i });
    }
    const queue = storageData[PENDING_CHROME_STORAGE_KEY] as unknown[];
    expect(queue.length).toBeLessThanOrEqual(500);
  });
});
