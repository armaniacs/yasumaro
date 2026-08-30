/**
 * localExportRetention.test.ts
 * VULN-004: retention for local Markdown auto-export.
 * Covers download-ID record format + cap, retention boundary (29/30/31 days),
 * and MAX_DAILY_BUFFER_ENTRIES truncation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockStorageGet = vi.hoisted(() => vi.fn());
const mockStorageSet = vi.hoisted(() => vi.fn());
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
  MAX_DOWNLOAD_RECORDS,
  LOCAL_EXPORT_DOWNLOAD_IDS_KEY,
  recordDownloadId,
  purgeExpiredDownloadRecords,
  type DownloadRecord,
} from '../localMarkdownExportRetention.js';
import { MarkdownBufferManager, MAX_DAILY_BUFFER_ENTRIES } from '../pipeline/buffers/MarkdownBufferManager.js';
import type { MarkdownEntry } from '../pipeline/buffers/MarkdownBufferManager.js';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('localMarkdownExportRetention constants', () => {
  it('defaults retention to 30 days', () => {
    expect(LOCAL_MARKDOWN_EXPORT_RETENTION_DAYS).toBe(30);
  });

  it('caps the download-record list at 200', () => {
    expect(MAX_DOWNLOAD_RECORDS).toBe(200);
  });
});

describe('recordDownloadId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorageGet.mockResolvedValue({});
    mockStorageSet.mockResolvedValue(undefined);
  });

  it('appends a { downloadId, date, createdAt } record', async () => {
    const before = Date.now();
    await recordDownloadId(42, '2026-01-01');

    const written = mockStorageSet.mock.calls[0][0][LOCAL_EXPORT_DOWNLOAD_IDS_KEY] as DownloadRecord[];
    expect(written).toHaveLength(1);
    expect(written[0].downloadId).toBe(42);
    expect(written[0].date).toBe('2026-01-01');
    expect(written[0].createdAt).toBeGreaterThanOrEqual(before);
  });

  it('drops the oldest record when the list exceeds MAX_DOWNLOAD_RECORDS', async () => {
    const existing: DownloadRecord[] = Array.from({ length: MAX_DOWNLOAD_RECORDS }, (_, i) => ({
      downloadId: i,
      date: '2026-01-01',
      createdAt: i,
    }));
    mockStorageGet.mockResolvedValue({ [LOCAL_EXPORT_DOWNLOAD_IDS_KEY]: existing });

    await recordDownloadId(9999, '2026-02-02');

    const written = mockStorageSet.mock.calls[0][0][LOCAL_EXPORT_DOWNLOAD_IDS_KEY] as DownloadRecord[];
    expect(written).toHaveLength(MAX_DOWNLOAD_RECORDS);
    expect(written[0].downloadId).toBe(1);
    expect(written[written.length - 1].downloadId).toBe(9999);
  });
});

describe('purgeExpiredDownloadRecords', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorageSet.mockResolvedValue(undefined);
    mockErase.mockResolvedValue([]);
    mockRemoveFile.mockResolvedValue(undefined);
  });

  it('keeps a 29-day-old record, removes a 31-day-old record, and treats exactly 30 days as expired', async () => {
    const now = Date.now();
    const records: DownloadRecord[] = [
      { downloadId: 1, date: 'd29', createdAt: now - 29 * DAY_MS },
      { downloadId: 2, date: 'd30', createdAt: now - 30 * DAY_MS },
      { downloadId: 3, date: 'd31', createdAt: now - 31 * DAY_MS },
    ];
    mockStorageGet.mockResolvedValue({ [LOCAL_EXPORT_DOWNLOAD_IDS_KEY]: records });

    await purgeExpiredDownloadRecords();

    expect(mockErase).toHaveBeenCalledWith({ id: 2 });
    expect(mockErase).toHaveBeenCalledWith({ id: 3 });
    expect(mockErase).not.toHaveBeenCalledWith({ id: 1 });

    const written = mockStorageSet.mock.calls[0][0][LOCAL_EXPORT_DOWNLOAD_IDS_KEY] as DownloadRecord[];
    expect(written.map((r) => r.downloadId)).toEqual([1]);
  });

  it('still calls erase even when removeFile rejects for an already-deleted file', async () => {
    const now = Date.now();
    mockRemoveFile.mockRejectedValue(new Error('file already deleted'));
    mockStorageGet.mockResolvedValue({
      [LOCAL_EXPORT_DOWNLOAD_IDS_KEY]: [{ downloadId: 7, date: 'old', createdAt: now - 40 * DAY_MS }],
    });

    await purgeExpiredDownloadRecords();

    expect(mockErase).toHaveBeenCalledWith({ id: 7 });
  });

  it('is a no-op when there are no records', async () => {
    mockStorageGet.mockResolvedValue({});

    await purgeExpiredDownloadRecords();

    expect(mockErase).not.toHaveBeenCalled();
    expect(mockStorageSet).not.toHaveBeenCalled();
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
