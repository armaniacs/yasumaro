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

  it('coalesces metadata patches for the same URL', async () => {
    await enqueuePendingWrite({
      type: 'metadataPatch',
      key: 'savedUrlsWithTimestamps',
      url: 'https://example.com',
      patch: { tags: ['a'], recordType: 'auto' },
      timestamp: 1000,
      mergeTags: true,
      createdAt: 1000,
      retryCount: 0,
    });
    await enqueuePendingWrite({
      type: 'metadataPatch',
      key: 'savedUrlsWithTimestamps',
      url: 'https://example.com',
      patch: { tags: ['b'], aiSummary: 's' },
      timestamp: 2000,
      mergeTags: true,
      createdAt: 2000,
      retryCount: 0,
    });

    const queue = storageData[PENDING_CHROME_STORAGE_KEY] as unknown[];
    expect(queue).toHaveLength(1);
    const merged = queue[0] as { patch: Record<string, unknown> };
    expect(merged.patch.tags).toEqual(['a', 'b']);
    expect(merged.patch.aiSummary).toBe('s');
    expect(merged.patch.recordType).toBe('auto');
    expect((merged as { timestamp?: number }).timestamp).toBe(2000);
  });

  it('omits content when the serialized patch exceeds the payload limit', async () => {
    const largeContent = 'x'.repeat(200 * 1024);
    await enqueuePendingWrite({
      type: 'metadataPatch',
      key: 'savedUrlsWithTimestamps',
      url: 'https://example.com',
      patch: { content: largeContent, tags: ['t'] },
      createdAt: Date.now(),
      retryCount: 0,
    });

    const queue = storageData[PENDING_CHROME_STORAGE_KEY] as unknown[];
    expect(queue).toHaveLength(1);
    const queued = queue[0] as { patch: { content?: string; tags: string[] }; contentOmitted?: boolean };
    expect(queued.patch.content).toBeUndefined();
    expect(queued.contentOmitted).toBe(true);
    expect(queued.patch.tags).toEqual(['t']);
  });

  it('truncates tags when repeated merges exceed the payload limit even without content', async () => {
    // 1件目・2件目それぞれのtagsは単独では上限(100KB)を超えないが、
    // タグ文字列が異なるためmergeTagsでの重複排除が効かず、マージ後は
    // 合計で上限を超える（1件あたり5000件、1タグあたり約13バイト）。
    const manyTags = Array.from({ length: 5000 }, (_, i) => `tag-a-${i}`);
    const moreTags = Array.from({ length: 5000 }, (_, i) => `tag-b-${i}`);
    await enqueuePendingWrite({
      type: 'metadataPatch',
      key: 'savedUrlsWithTimestamps',
      url: 'https://example.com',
      patch: { tags: manyTags },
      timestamp: 1000,
      mergeTags: true,
      createdAt: 1000,
      retryCount: 0,
    });

    // 2件目をマージすることで、既存の巨大なtagsとさらにマージされる。
    // content は含めないため、既存の content 間引きロジックだけでは
    // このペイロードを縮小できない。
    await enqueuePendingWrite({
      type: 'metadataPatch',
      key: 'savedUrlsWithTimestamps',
      url: 'https://example.com',
      patch: { tags: [...moreTags, 'fresh-tag'] },
      timestamp: 2000,
      mergeTags: true,
      createdAt: 2000,
      retryCount: 0,
    });

    const queue = storageData[PENDING_CHROME_STORAGE_KEY] as Array<{
      patch: { tags?: string[]; content?: string };
      tagsOmitted?: boolean;
    }>;
    expect(queue).toHaveLength(1);
    const merged = queue[0];

    const mergedSize = new Blob([JSON.stringify(merged.patch)]).size;
    expect(mergedSize).toBeLessThanOrEqual(100 * 1024);
    expect(merged.tagsOmitted).toBe(true);
    // 直近に追加したタグ（末尾側）は優先して残るはず。
    expect(merged.patch.tags).toContain('fresh-tag');
  });
});
