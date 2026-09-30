/**
 * localExportRetention.test.ts
 * VULN-004: retention for local Markdown auto-export.
 * Covers download-ID record format + cap, retention boundary (29/30/31 days),
 * MAX_DAILY_BUFFER_ENTRIES truncation, and the read-modify-write races between
 * a flush's recordDownloadId and the daily purge.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useTimerClock } from '../../../testDir/waitPolicy.js';

/**
 * Stateful chrome.storage.local stand-in. The download-ID list is written
 * through withOptimisticLock, whose post-write verification re-reads storage
 * and compares the value: a mockResolvedValue-per-call stub would replay the
 * pre-write snapshot forever and every update would fail its own verification.
 */
const store = vi.hoisted(() => ({ data: {} as Record<string, unknown> }));

const mockStorageGet = vi.hoisted(() =>
  vi.fn((keys?: string | string[] | null) => {
    if (keys === null || keys === undefined) return Promise.resolve({ ...store.data });
    if (typeof keys === 'string') {
      // Chrome returns the exact key plus every key sharing it as a prefix.
      const out: Record<string, unknown> = {};
      if (keys in store.data) out[keys] = store.data[keys];
      for (const k of Object.keys(store.data)) {
        if (k !== keys && k.startsWith(keys)) out[k] = store.data[k];
      }
      return Promise.resolve(out);
    }
    const out: Record<string, unknown> = {};
    for (const k of keys) if (k in store.data) out[k] = store.data[k];
    return Promise.resolve(out);
  }),
);
const mockStorageSet = vi.hoisted(() =>
  vi.fn((items: Record<string, unknown>) => {
    // Clone on write, like a real storage round trip.
    Object.assign(store.data, structuredClone(items));
    return Promise.resolve();
  }),
);
const mockStorageRemove = vi.hoisted(() => vi.fn());
const mockErase = vi.hoisted(() => vi.fn());
const mockRemoveFile = vi.hoisted(() => vi.fn());

vi.stubGlobal('chrome', {
  storage: {
    local: { get: mockStorageGet, set: mockStorageSet, remove: mockStorageRemove },
  },
  downloads: { erase: mockErase, removeFile: mockRemoveFile },
});

import {
  LOCAL_MARKDOWN_EXPORT_RETENTION_DAYS,
  LOCAL_MARKDOWN_BUFFER_RETENTION_DAYS,
  MAX_DOWNLOAD_RECORDS,
  LOCAL_EXPORT_DOWNLOAD_IDS_KEY,
  recordDownloadId,
  purgeExpiredDownloadRecords,
  type DownloadRecord,
} from '../localMarkdownExportRetention.js';
import { MarkdownBufferManager, MAX_DAILY_BUFFER_ENTRIES } from '../pipeline/buffers/MarkdownBufferManager.js';
import type { MarkdownEntry } from '../pipeline/buffers/MarkdownBufferManager.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function seedRecords(records: DownloadRecord[]): void {
  store.data[LOCAL_EXPORT_DOWNLOAD_IDS_KEY] = records;
}

function storedRecords(): DownloadRecord[] {
  return store.data[LOCAL_EXPORT_DOWNLOAD_IDS_KEY] as DownloadRecord[];
}

describe('localMarkdownExportRetention constants', () => {
  it('defaults retention to 30 days', () => {
    expect(LOCAL_MARKDOWN_EXPORT_RETENTION_DAYS).toBe(30);
  });

  it('caps the download-record list at 200', () => {
    expect(MAX_DOWNLOAD_RECORDS).toBe(200);
  });

  it('keeps the buffer-key window separate from the download-record window', () => {
    expect(LOCAL_MARKDOWN_BUFFER_RETENTION_DAYS).toBe(7);
    expect(LOCAL_MARKDOWN_BUFFER_RETENTION_DAYS).not.toBe(LOCAL_MARKDOWN_EXPORT_RETENTION_DAYS);
  });
});

describe('recordDownloadId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.data = {};
  });

  it('appends a { downloadId, date, createdAt } record', async () => {
    const before = Date.now();
    await recordDownloadId(42, '2026-01-01');

    const written = mockStorageSet.mock.calls[0]?.[0][LOCAL_EXPORT_DOWNLOAD_IDS_KEY] as DownloadRecord[];
    expect(written).toHaveLength(1);
    expect(written[0]?.downloadId).toBe(42);
    expect(written[0]?.date).toBe('2026-01-01');
    expect(written[0]?.createdAt).toBeGreaterThanOrEqual(before);
  });

  it('writes the list in a single locked update that carries the version bump', async () => {
    await recordDownloadId(42, '2026-01-01');

    // One write, and it participates in the CAS — a bare set on this key would
    // be invisible to withOptimisticLock's verify read.
    expect(mockStorageSet).toHaveBeenCalledTimes(1);
    expect(mockStorageSet.mock.calls[0]?.[0]).toHaveProperty(`${LOCAL_EXPORT_DOWNLOAD_IDS_KEY}_version`, 1);
  });

  it('drops the oldest record when the list exceeds MAX_DOWNLOAD_RECORDS', async () => {
    const existing: DownloadRecord[] = Array.from({ length: MAX_DOWNLOAD_RECORDS }, (_, i) => ({
      downloadId: i,
      date: '2026-01-01',
      createdAt: i,
    }));
    seedRecords(existing);

    await recordDownloadId(9999, '2026-02-02');

    const written = mockStorageSet.mock.calls[0]?.[0][LOCAL_EXPORT_DOWNLOAD_IDS_KEY] as DownloadRecord[];
    expect(written).toHaveLength(MAX_DOWNLOAD_RECORDS);
    expect(written[0]?.downloadId).toBe(1);
    expect(written[written.length - 1]?.downloadId).toBe(9999);
  });
});

describe('purgeExpiredDownloadRecords', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.data = {};
    mockErase.mockResolvedValue([]);
    mockRemoveFile.mockResolvedValue(undefined);
  });

  it('keeps a 29-day-old record, removes a 31-day-old record, and treats exactly 30 days as expired', async () => {
    const now = Date.now();
    seedRecords([
      { downloadId: 1, date: 'd29', createdAt: now - 29 * DAY_MS },
      { downloadId: 2, date: 'd30', createdAt: now - 30 * DAY_MS },
      { downloadId: 3, date: 'd31', createdAt: now - 31 * DAY_MS },
    ]);

    await purgeExpiredDownloadRecords();

    expect(mockErase).toHaveBeenCalledWith({ id: 2 });
    expect(mockErase).toHaveBeenCalledWith({ id: 3 });
    expect(mockErase).not.toHaveBeenCalledWith({ id: 1 });

    const written = mockStorageSet.mock.calls[0]?.[0][LOCAL_EXPORT_DOWNLOAD_IDS_KEY] as DownloadRecord[];
    expect(written.map((r) => r.downloadId)).toEqual([1]);
  });

  it('still calls erase even when removeFile rejects for an already-deleted file', async () => {
    const now = Date.now();
    mockRemoveFile.mockRejectedValue(new Error('file already deleted'));
    seedRecords([{ downloadId: 7, date: 'old', createdAt: now - 40 * DAY_MS }]);

    await purgeExpiredDownloadRecords();

    expect(mockErase).toHaveBeenCalledWith({ id: 7 });
  });

  it('is a no-op when there are no records', async () => {
    await purgeExpiredDownloadRecords();

    expect(mockErase).not.toHaveBeenCalled();
    expect(mockStorageSet).not.toHaveBeenCalled();
  });

  it('is a no-op when every record is still inside the retention window', async () => {
    const now = Date.now();
    seedRecords([{ downloadId: 3, date: 'd31', createdAt: now - 29 * DAY_MS }]);

    await purgeExpiredDownloadRecords();

    expect(mockErase).not.toHaveBeenCalled();
    expect(mockStorageSet).not.toHaveBeenCalled();
  });
});

describe('download-record read-modify-write races', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.data = {};
    mockErase.mockResolvedValue([]);
    mockRemoveFile.mockResolvedValue(undefined);
  });

  it('keeps an id recorded while the purge is parked in chrome.downloads', async () => {
    // The purge's slow path (removeFile/erase) is the window a concurrent flush
    // slips through. Before the fix the purge wrote a kept-list computed before
    // that await, silently dropping any id recorded in between.
    const now = Date.now();
    seedRecords([
      { downloadId: 1, date: 'expired', createdAt: now - 40 * DAY_MS },
      { downloadId: 2, date: 'recent', createdAt: now - 1000 },
    ]);

    let markParked: () => void = () => {};
    const parked = new Promise<void>((resolve) => { markParked = resolve; });
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    mockRemoveFile.mockImplementation(async () => {
      markParked();
      await gate;
    });

    const purgePromise = purgeExpiredDownloadRecords();
    await parked;
    await recordDownloadId(999, '2026-09-28');
    release();
    await purgePromise;

    // The new id survived and the expired record did not come back.
    expect(storedRecords().map((r) => r.downloadId)).toEqual([2, 999]);
    expect(mockErase).toHaveBeenCalledWith({ id: 1 });
    expect(mockErase).toHaveBeenCalledTimes(1);
  });

  it('merges a flush and the daily purge that run at the same time', async () => {
    // The other interleaving: both writers read the same list before either
    // writes. The lock serializes the writes, and the loser retries against the
    // winner's value — so neither the new id nor the un-expired record is lost.
    // The CAS retry sleeps, so drive the clock instead of the wall clock.
    useTimerClock();
    try {
      const now = Date.now();
      seedRecords([
        { downloadId: 1, date: 'expired', createdAt: now - 40 * DAY_MS },
        { downloadId: 2, date: 'recent', createdAt: now - 1000 },
      ]);

      const settled = Promise.all([
        purgeExpiredDownloadRecords(),
        recordDownloadId(999, '2026-09-28'),
      ]);
      await vi.advanceTimersByTimeAsync(1000);
      await settled;

      expect(storedRecords().map((r) => r.downloadId).sort()).toEqual([2, 999]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('MarkdownBufferManager entry-count cap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exposes MAX_DAILY_BUFFER_ENTRIES = 2000', () => {
    expect(MAX_DAILY_BUFFER_ENTRIES).toBe(2000);
  });

  it('drops the oldest entries once the buffer exceeds the cap', () => {
    const manager = new MarkdownBufferManager();
    const makeEntry = (i: number): MarkdownEntry => ({
      url: `https://example.com/${i}`,
      title: `Page ${i}`,
      visitedAt: i,
      entryData: {
        timestamp: '00:00',
        title: `Page ${i}`,
        url: `https://example.com/${i}`,
        summary: '',
        tags: '',
        domain: 'example.com',
      },
    });

    for (let i = 0; i < MAX_DAILY_BUFFER_ENTRIES + 50; i++) {
      manager.add(makeEntry(i));
    }

    expect(manager.count).toBe(MAX_DAILY_BUFFER_ENTRIES);
  });
});
