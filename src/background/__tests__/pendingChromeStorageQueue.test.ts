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

  it('queues and flushes a metadata-patch payload', async () => {
    await enqueuePendingWrite({
      type: 'metadataPatch',
      key: 'savedUrlsWithTimestamps',
      url: 'https://example.com',
      patch: { recordType: 'auto', tags: ['news'] },
      refreshTimestamp: true,
      mergeTags: true,
    });

    const retryFn = vi.fn().mockResolvedValue(true);
    await flushPendingWrites(retryFn);

    expect(retryFn).toHaveBeenCalledWith({
      type: 'metadataPatch',
      key: 'savedUrlsWithTimestamps',
      url: 'https://example.com',
      patch: { recordType: 'auto', tags: ['news'] },
      refreshTimestamp: true,
      mergeTags: true,
    });
  });

  it('keeps a metadata-patch payload queued when retry fails', async () => {
    await enqueuePendingWrite({
      type: 'metadataPatch',
      key: 'savedUrlsWithTimestamps',
      url: 'https://example.com',
      patch: { content: 'body' },
    });

    const retryFn = vi.fn().mockResolvedValue(false);
    await flushPendingWrites(retryFn);

    const remaining = storageData[PENDING_CHROME_STORAGE_KEY] as unknown[];
    expect(remaining).toHaveLength(1);
    expect((remaining[0] as { type?: string }).type).toBe('metadataPatch');
  });

  it('handles a queue mixing legacy and metadata-patch payloads', async () => {
    await enqueuePendingWrite({ key: 'savedUrlsWithTimestamps', value: [{ url: 'https://legacy.com', timestamp: 1 }] });
    await enqueuePendingWrite({
      type: 'metadataPatch',
      key: 'savedUrlsWithTimestamps',
      url: 'https://patch.com',
      patch: { aiSummary: 's' },
    });

    const retryFn = vi.fn().mockResolvedValue(true);
    await flushPendingWrites(retryFn);

    expect(retryFn).toHaveBeenCalledTimes(2);
    expect(retryFn).toHaveBeenCalledWith(expect.objectContaining({ key: 'savedUrlsWithTimestamps', value: expect.anything() }));
    expect(retryFn).toHaveBeenCalledWith(expect.objectContaining({ type: 'metadataPatch', url: 'https://patch.com' }));
  });
});
