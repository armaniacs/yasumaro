/**
 * localExportRetention.test.ts
 * VULN-004: retention for local Markdown auto-export.
 * Covers download-ID record format + cap, retention boundary (29/30/31 days),
 * MAX_DAILY_BUFFER_ENTRIES truncation, the read-modify-write races between
 * a flush's recordDownloadId and the daily purge, and the identity re-check
 * that gates every erase (PBI 2026-10-18-22: a recorded downloadId is only
 * erased while chrome.downloads still resolves it to the recorded file).
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
    // Platform contract: a string (or array) argument is an exact-key lookup,
    // and a no-arg (or null) call fetches all of storage. An earlier comment
    // here claimed "Chrome returns the exact key plus every key sharing it as
    // a prefix" and fabricated that prefix branch — chrome.storage.local.get
    // has no prefix mode, and a mock that invents one hides keyed-get bugs
    // (PBI 2026-10-18-07: the same fabrication kept the buffer-key sweep's
    // keyed-get no-op green in dailyPurgeHandler.test.ts).
    if (keys === null || keys === undefined) return Promise.resolve({ ...store.data });
    const out: Record<string, unknown> = {};
    const requested = Array.isArray(keys) ? keys : [keys];
    for (const k of requested) if (k in store.data) out[k] = store.data[k];
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
const mockSearch = vi.hoisted(() => vi.fn());

// addLog is mocked so the identity re-check's two log events (search failure
// vs item mismatch) can be pinned as separate events, and so the log sink
// stays out of the chrome.storage stub's data.
vi.mock('../../utils/logger/core.js', async () =>
  (await import('../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    addLog: 'fn',
  }),
);

vi.stubGlobal('chrome', {
  storage: {
    local: { get: mockStorageGet, set: mockStorageSet, remove: mockStorageRemove },
  },
  downloads: { erase: mockErase, removeFile: mockRemoveFile, search: mockSearch },
});

import { addLog } from '../../utils/logger/core.js';
import {
  LOCAL_MARKDOWN_EXPORT_RETENTION_DAYS,
  LOCAL_MARKDOWN_BUFFER_RETENTION_DAYS,
  MAX_DOWNLOAD_RECORDS,
  LOCAL_EXPORT_DOWNLOAD_IDS_KEY,
  LOCAL_EXPORT_ERASE_QUEUE_KEY,
  recordDownloadId,
  purgeExpiredDownloadRecords,
  type DownloadRecord,
} from '../localMarkdownExportRetention.js';
import { MarkdownBufferManager, MAX_DAILY_BUFFER_ENTRIES } from '../pipeline/buffers/MarkdownBufferManager.js';
import type { MarkdownEntry } from '../pipeline/buffers/MarkdownBufferManager.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Downloads this fixture "recorded", kept outside chrome.storage: the purge
 * claims a record out of the tracked list (removing it from storage) BEFORE
 * eraseDownloadRecord searches for its id, and chrome.downloads is a separate
 * API that still has the item. The default search stand-in answers from here.
 */
const knownDownloads = new Map<number, DownloadRecord>();

function recordDownload(record: DownloadRecord): void {
  knownDownloads.set(record.downloadId, record);
}

function seedRecords(records: DownloadRecord[]): void {
  store.data[LOCAL_EXPORT_DOWNLOAD_IDS_KEY] = records;
  for (const record of records) recordDownload(record);
}

function storedRecords(): DownloadRecord[] {
  return store.data[LOCAL_EXPORT_DOWNLOAD_IDS_KEY] as DownloadRecord[];
}

function seedQueue(records: DownloadRecord[]): void {
  store.data[LOCAL_EXPORT_ERASE_QUEUE_KEY] = records;
  for (const record of records) recordDownload(record);
}

function storedQueue(): DownloadRecord[] {
  const queued = store.data[LOCAL_EXPORT_ERASE_QUEUE_KEY];
  return Array.isArray(queued) ? (queued as DownloadRecord[]) : [];
}

/**
 * The chrome.downloads item a recorded download resolves to. DownloadItem
 * .filename is the absolute local path, so the recorded relative filename is
 * placed under a fake download directory, and startTime mirrors the record's
 * createdAt stamp (both identity criteria of the re-check).
 */
function downloadItemFor(record: DownloadRecord): { id: number; filename: string; startTime: string } {
  return {
    id: record.downloadId,
    filename: `/downloads/${record.filename ?? `${record.date}.md`}`,
    startTime: new Date(record.createdAt).toISOString(),
  };
}

/**
 * Default search stand-in for the erase-path describes: a download this
 * fixture recorded still exists and resolves to the recorded item, so every
 * pre-existing erase expectation keeps holding through the identity re-check.
 * Identity-re-check tests below override mockSearch per test.
 */
function searchRecordedDownloads(query: { id?: number }): Promise<Array<{ id: number; filename: string; startTime: string }>> {
  const record = query.id === undefined ? undefined : knownDownloads.get(query.id);
  return Promise.resolve(record ? [downloadItemFor(record)] : []);
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
    knownDownloads.clear();
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

  it('drops the oldest record into the erase queue when the list exceeds MAX_DOWNLOAD_RECORDS', async () => {
    // PBI 2026-10-18-21: rewritten from a pin on the bare cap-drop. The cap
    // used to slice the oldest records off silently, and they then existed in
    // no deletion path, so their chrome://downloads entries outlived the
    // retention window. The list-side expectations are unchanged; the
    // deletion-path hand-off (the erase queue) is observed as a separate line
    // here, and the erase itself is pinned by the purge tests below.
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
    // The dropped record reached the deletion path instead of vanishing: it
    // waits in the erase queue for the next purge.
    expect(storedQueue().map((r) => r.downloadId)).toEqual([0]);
  });

  it('stores the download filename with the record for the identity re-check', async () => {
    // PBI 2026-10-18-22: the flush passes the filename it handed to
    // chrome.downloads.download, so the purge can match the item at that id.
    await recordDownloadId(42, '2026-01-01', 'Yasumaro/2026-01-01.md');

    const written = mockStorageSet.mock.calls[0]?.[0][LOCAL_EXPORT_DOWNLOAD_IDS_KEY] as DownloadRecord[];
    expect(written[0]?.filename).toBe('Yasumaro/2026-01-01.md');
  });
});

describe('purgeExpiredDownloadRecords', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.data = {};
    mockErase.mockResolvedValue([]);
    mockRemoveFile.mockResolvedValue(undefined);
    knownDownloads.clear();
    mockSearch.mockImplementation(searchRecordedDownloads);
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
    knownDownloads.clear();
    mockSearch.mockImplementation(searchRecordedDownloads);
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

describe('download cap erase queue (PBI 2026-10-18-21)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.data = {};
    mockErase.mockResolvedValue([]);
    mockRemoveFile.mockResolvedValue(undefined);
    knownDownloads.clear();
    mockSearch.mockImplementation(searchRecordedDownloads);
  });

  it('hands a cap-dropped record to the erase queue and erases it once it ages out', async () => {
    // Scenario 1: the flush that rolls the list over passes the dropped record
    // to the deletion path, and the entry does not disappear from
    // chrome://downloads while it is still inside the retention window.
    useTimerClock();
    try {
      const now = Date.now();
      const existing: DownloadRecord[] = Array.from({ length: MAX_DOWNLOAD_RECORDS }, (_, i) => ({
        downloadId: i + 1,
        date: '2026-01-01',
        createdAt: now - DAY_MS,
      }));
      seedRecords(existing);

      await recordDownloadId(9999, '2026-02-02');

      // The oldest record left the list and waits in the erase queue.
      expect(storedRecords().map((r) => r.downloadId)).not.toContain(1);
      expect(storedQueue().map((r) => r.downloadId)).toEqual([1]);

      // Inside the window nothing is erased: the queue is not a fast-path.
      await purgeExpiredDownloadRecords();
      expect(mockErase).not.toHaveBeenCalled();

      // Past the cutoff the queue drains through the deletion path.
      await vi.advanceTimersByTimeAsync(31 * DAY_MS);
      await purgeExpiredDownloadRecords();
      expect(mockErase).toHaveBeenCalledWith({ id: 1 });
      expect(storedQueue()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps sub-cap appends out of the erase queue', async () => {
    // Scenario 2 regression guard: normal operation never treats a record as
    // deletion-pending, and the tracked list keeps every appended record.
    await recordDownloadId(1, '2026-01-01');
    await recordDownloadId(2, '2026-01-02');

    expect(storedRecords().map((r) => r.downloadId)).toEqual([1, 2]);
    expect(storedQueue()).toEqual([]);
  });

  it('drains the erase queue across a service worker restart', async () => {
    // Scenario 3: the queue is persisted, so a worker that dies right after a
    // cap-drop is enough — the next purge sees the queued record and erases it.
    const now = Date.now();
    seedQueue([{ downloadId: 5, date: 'dropped', createdAt: now - 40 * DAY_MS }]);
    seedRecords([{ downloadId: 6, date: 'recent', createdAt: now - 1000 }]);

    await purgeExpiredDownloadRecords();

    expect(mockErase).toHaveBeenCalledWith({ id: 5 });
    expect(storedQueue()).toEqual([]);
    expect(storedRecords().map((r) => r.downloadId)).toEqual([6]);
  });

  it('restores the erase queue when the run dies between the erase and the claim', async () => {
    // Scenario 3, mid-purge crash: the queue claims only records it actually
    // erased, so a crash after the erase leaves the record queued and the next
    // purge retries the erase (harmless duplicate) and claims it then.
    const now = Date.now();
    seedQueue([{ downloadId: 9, date: 'dropped', createdAt: now - 40 * DAY_MS }]);
    mockStorageSet.mockRejectedValueOnce(new Error('service worker terminated'));

    await expect(purgeExpiredDownloadRecords()).rejects.toThrow('service worker terminated');

    // The erase happened; the claim did not land, so the record is still queued.
    expect(mockErase).toHaveBeenCalledWith({ id: 9 });
    expect(storedQueue().map((r) => r.downloadId)).toEqual([9]);

    await purgeExpiredDownloadRecords();
    expect(storedQueue()).toEqual([]);
  });

  it('keeps a queued record whose erase fails so the next purge retries it', async () => {
    const now = Date.now();
    mockErase.mockRejectedValue(new Error('erase failed'));
    seedQueue([{ downloadId: 8, date: 'dropped', createdAt: now - 40 * DAY_MS }]);

    await purgeExpiredDownloadRecords();

    expect(mockErase).toHaveBeenCalledWith({ id: 8 });
    expect(storedQueue().map((r) => r.downloadId)).toEqual([8]);
  });
});

describe('purge identity re-check (PBI 2026-10-18-22)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.data = {};
    knownDownloads.clear();
    mockErase.mockResolvedValue([]);
    mockRemoveFile.mockResolvedValue(undefined);
    // Every test here configures mockSearch itself: the identity re-check is
    // the subject, so no default "the download exists" stand-in applies.
    mockSearch.mockReset();
  });

  it('calls neither removeFile nor erase when the recorded id now refers to an unrelated newer download', async () => {
    // Scenario 1: the download was recorded 30+ days ago, and after a browser
    // restart the id was re-assigned to a brand-new unrelated download.
    const now = Date.now();
    const record: DownloadRecord = {
      downloadId: 777,
      date: '2026-09-10',
      createdAt: now - 40 * DAY_MS,
      filename: 'Yasumaro/2026-09-10.md',
    };
    seedRecords([record]);
    mockSearch.mockResolvedValue([
      { id: 777, filename: '/downloads/invoice-2026.pdf', startTime: new Date(now).toISOString() },
    ]);

    await purgeExpiredDownloadRecords();

    expect(mockRemoveFile).toHaveBeenCalledTimes(0);
    expect(mockErase).toHaveBeenCalledTimes(0);
    // The record leaves the tracked list (claimed before the re-check), but
    // the unrelated chrome://downloads entry is untouched: the user can see
    // and delete it by hand.
    expect(storedRecords()).toEqual([]);
  });

  it('calls neither removeFile nor erase when search returns an empty result', async () => {
    // Scenario 3: the identity search answers "no such item".
    const now = Date.now();
    seedRecords([{ downloadId: 5, date: 'old', createdAt: now - 40 * DAY_MS }]);
    mockSearch.mockResolvedValue([]);

    await purgeExpiredDownloadRecords();

    expect(mockRemoveFile).toHaveBeenCalledTimes(0);
    expect(mockErase).toHaveBeenCalledTimes(0);
  });

  it('calls neither removeFile nor erase when the identity search fails, and leaves the entry for the user', async () => {
    // Scenario 3: an API error must not delete; the claimed list record is the
    // same recoverable direction as a crash between the claim and the erase.
    const now = Date.now();
    seedRecords([{ downloadId: 6, date: 'old', createdAt: now - 40 * DAY_MS }]);
    mockSearch.mockRejectedValue(new Error('search unavailable'));

    await purgeExpiredDownloadRecords();

    expect(mockRemoveFile).toHaveBeenCalledTimes(0);
    expect(mockErase).toHaveBeenCalledTimes(0);
    expect(storedRecords()).toEqual([]);
  });

  it('still erases when the id resolves to the recorded download (Scenario 2 regression)', async () => {
    const now = Date.now();
    const record: DownloadRecord = {
      downloadId: 12,
      date: '2026-09-10',
      createdAt: now - 40 * DAY_MS,
      filename: 'Yasumaro/2026-09-10.md',
    };
    seedRecords([record]);
    mockSearch.mockResolvedValue([downloadItemFor(record)]);

    await purgeExpiredDownloadRecords();

    expect(mockRemoveFile).toHaveBeenCalledWith(12);
    expect(mockErase).toHaveBeenCalledWith({ id: 12 });
  });

  it('verifies an old-format record through the startTime criterion and still erases it', async () => {
    // Records written before the identity re-check carry no filename: they go
    // through the same checkpoint via the startTime criterion, so old records
    // are not permanently un-erasable.
    const now = Date.now();
    const record: DownloadRecord = { downloadId: 21, date: 'old', createdAt: now - 40 * DAY_MS };
    seedRecords([record]);
    mockSearch.mockResolvedValue([downloadItemFor(record)]);

    await purgeExpiredDownloadRecords();

    expect(mockErase).toHaveBeenCalledWith({ id: 21 });
  });

  it('does not erase an old-format record whose id was re-assigned to a fresh download', async () => {
    const now = Date.now();
    seedRecords([{ downloadId: 33, date: 'old', createdAt: now - 40 * DAY_MS }]);
    mockSearch.mockResolvedValue([
      { id: 33, filename: '/downloads/other.md', startTime: new Date(now).toISOString() },
    ]);

    await purgeExpiredDownloadRecords();

    expect(mockRemoveFile).toHaveBeenCalledTimes(0);
    expect(mockErase).toHaveBeenCalledTimes(0);
  });

  it('runs erase-queue records through the same identity re-check', async () => {
    const now = Date.now();
    const record: DownloadRecord = {
      downloadId: 44,
      date: 'old',
      createdAt: now - 40 * DAY_MS,
      filename: 'Yasumaro/old.md',
    };
    seedQueue([record]);
    mockSearch.mockResolvedValue([
      { id: 44, filename: '/downloads/unrelated.zip', startTime: new Date(now).toISOString() },
    ]);

    await purgeExpiredDownloadRecords();

    expect(mockRemoveFile).toHaveBeenCalledTimes(0);
    expect(mockErase).toHaveBeenCalledTimes(0);
    // Conclusively not ours: no purge can ever owe this record an erase, so
    // the queue drains it (the unrelated entry itself stays for the user).
    expect(storedQueue()).toEqual([]);
  });

  it('keeps a queued record whose identity search fails so the next purge re-checks it', async () => {
    const now = Date.now();
    seedQueue([{ downloadId: 8, date: 'dropped', createdAt: now - 40 * DAY_MS }]);
    mockSearch.mockRejectedValue(new Error('search unavailable'));

    await purgeExpiredDownloadRecords();

    expect(mockRemoveFile).toHaveBeenCalledTimes(0);
    expect(mockErase).toHaveBeenCalledTimes(0);
    // The record still owes an erase: the queue keeps it for a retry.
    expect(storedQueue().map((r) => r.downloadId)).toEqual([8]);
  });

  it('logs search failure and item mismatch as separate events', async () => {
    // Scenario 3: a skipped purge must be triageable - the search failure and
    // the "no matching item" verdict are distinct log events, and neither is
    // the erase-failure event.
    const now = Date.now();
    seedRecords([
      { downloadId: 50, date: 'a', createdAt: now - 40 * DAY_MS },
      { downloadId: 51, date: 'b', createdAt: now - 40 * DAY_MS },
    ]);
    mockSearch.mockImplementation(async (query: { id?: number }) => {
      if (query.id === 50) throw new Error('search unavailable');
      return [{ id: 51, filename: '/downloads/unrelated.md', startTime: new Date(now).toISOString() }];
    });

    await purgeExpiredDownloadRecords();

    const messages = vi.mocked(addLog).mock.calls.map((call) => call[1]);
    expect(messages).toContain('Local Markdown download identity search failed');
    expect(messages).toContain('Local Markdown download identity mismatch');
    expect(messages).not.toContain('Local Markdown download record erase failed');
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
