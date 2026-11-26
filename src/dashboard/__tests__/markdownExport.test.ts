/**
 * markdownExport.test.ts
 * PBI 2026-08-08-09 Phase 1
 *
 * このロジックは dashboard.ts の中にあり、`void initDashboard()` という
 * トップレベル副作用越しにしか到達できなかったため、バッチ分割・日付
 * バケット・テンプレート適用のいずれも直接テストできなかった。
 *
 * markdownExport.ts へ切り出し、chrome.downloads を DownloadPort seam の
 * 裏に置いたことで、出力内容を実際に検証できるようになった。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQueryLogs = vi.fn();
const { mockGetAll, mockGetMany } = vi.hoisted(() => ({
  mockGetAll: vi.fn(),
  mockGetMany: vi.fn(),
}));
const mockGetPlatformOs = vi.fn();

vi.mock('../dashboardSqliteService.js', () => ({
  queryLogs: (...args: unknown[]) => mockQueryLogs(...args),
  isServiceError: (result: object) => 'error' in result,
}));

vi.mock('../../utils/storage/types.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    StorageKeys: {
      LOCAL_MARKDOWN_EXPORT_PATH: 'local_markdown_export_path',
      MARKDOWN_EXPORT_TEMPLATES: 'markdown_export_templates',
      ACTIVE_MARKDOWN_EXPORT_TEMPLATE_ID: 'active_markdown_export_template_id',
    },
  };
});

vi.mock('../../utils/storage/SettingsRepository.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    settingsRepository: {
      getAll: mockGetAll,
      getMany: mockGetMany,
      setAll: vi.fn(),
    },
    SettingsRepository: class {
      getAll = mockGetAll;
      getMany = mockGetMany;
      setAll = vi.fn();
    },
  };
});

vi.mock('../../utils/deviceUtils.js', () => ({
  getPlatformOs: (...args: unknown[]) => mockGetPlatformOs(...args),
}));

vi.mock('../../utils/markdownTemplateUtils.js', () => ({
  renderFileTemplate: vi.fn((_tpl: unknown, entries: Array<{ title: string }>, date: string) =>
    `# ${date}\n${entries.map(e => `- ${e.title}`).join('\n')}\n`),
  getActiveTemplate: vi.fn(() => ({ id: 'default', name: 'Default' })),
  getHostname: vi.fn((url: string) => {
    try { return new URL(url).hostname; } catch { return ''; }
  }),
}));

vi.mock('../../utils/markdownSanitizer.js', () => ({
  sanitizeForObsidian: vi.fn((s: string) => s),
  sanitizeForMarkdownLinkText: vi.fn((s: string) => s),
  sanitizeUrlForMarkdownTarget: vi.fn((s: string) => s),
}));

import {
  getExportBatchSize,
  getLocalDateString,
  groupEntriesByLocalDate,
  exportFilenameFor,
  dateRangeToTimestamps,
  loadExportConfig,
  exportFullHistoryInBatches,
  exportDateRange,
  toMarkdownTemplateEntryData,
  EXPORT_BATCH_SIZE_DESKTOP,
  EXPORT_BATCH_SIZE_MOBILE,
  DEFAULT_EXPORT_PATH,
  DATE_RANGE_QUERY_LIMIT,
  type ExportConfig,
} from '../markdownExport.js';
import type { BrowsingLogEntry } from '../dashboardSqliteService.js';
import { MAX_EXPORT_ROWS, QUERY_CAPS } from '../../utils/limits.js';

/** Build a row at a fixed local time on the given date. */
function row(id: number, dateIso: string, title = `Title ${id}`): BrowsingLogEntry {
  return {
    id,
    url: `https://example.com/${id}`,
    title,
    summary: `Summary ${id}`,
    tags: '',
    created_at: new Date(`${dateIso}T12:00:00`).getTime(),
  } as BrowsingLogEntry;
}

const config: ExportConfig = {
  exportPath: 'Yasumaro',
  template: { id: 'default', name: 'Default' } as ExportConfig['template'],
};

/** Collects what would have been downloaded. */
function makeDownloadSpy(): { calls: Array<{ filename: string; content: string }>; port: (f: string, c: string) => Promise<void> } {
  const calls: Array<{ filename: string; content: string }> = [];
  return {
    calls,
    port: async (filename, content) => { calls.push({ filename, content }); },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetPlatformOs.mockReturnValue('mac');
});

describe('getExportBatchSize', () => {
  it('uses the desktop batch size on desktop platforms', () => {
    mockGetPlatformOs.mockReturnValue('mac');
    expect(getExportBatchSize()).toBe(EXPORT_BATCH_SIZE_DESKTOP);
  });

  it.each(['android', 'ios'])('uses the smaller batch size on %s', (os) => {
    mockGetPlatformOs.mockReturnValue(os);
    expect(getExportBatchSize()).toBe(EXPORT_BATCH_SIZE_MOBILE);
  });
});

describe('getLocalDateString', () => {
  it('formats a timestamp as YYYY-MM-DD in local time', () => {
    const ts = new Date('2026-08-09T12:34:56').getTime();
    expect(getLocalDateString(ts)).toBe('2026-08-09');
  });

  it('zero-pads month and day', () => {
    const ts = new Date('2026-01-05T00:00:00').getTime();
    expect(getLocalDateString(ts)).toBe('2026-01-05');
  });
});

describe('groupEntriesByLocalDate', () => {
  it('buckets rows by their local date, preserving order', () => {
    const grouped = groupEntriesByLocalDate([
      row(1, '2026-08-01'), row(2, '2026-08-01'), row(3, '2026-08-02'),
    ]);

    expect([...grouped.keys()]).toEqual(['2026-08-01', '2026-08-02']);
    expect(grouped.get('2026-08-01')!.map(r => r.id)).toEqual([1, 2]);
    expect(grouped.get('2026-08-02')!.map(r => r.id)).toEqual([3]);
  });

  it('returns an empty map for no rows', () => {
    expect(groupEntriesByLocalDate([]).size).toBe(0);
  });
});

describe('exportFilenameFor', () => {
  it('places one file per date under the export path', () => {
    expect(exportFilenameFor('Yasumaro', '2026-08-09')).toBe('Yasumaro/2026-08-09.md');
  });

  it('PBI 27: traversal in exportPath falls back without ".."', () => {
    const filename = exportFilenameFor('../evil', '2026-08-09');
    expect(filename).not.toContain('..');
    expect(filename).toBe(`${DEFAULT_EXPORT_PATH}/2026-08-09.md`);
  });

  it('PBI 27: absolute-path-like exportPath does not escape', () => {
    const filename = exportFilenameFor('/absolute', '2026-08-09');
    expect(filename.startsWith('/')).toBe(false);
    expect(filename.endsWith('/2026-08-09.md')).toBe(true);
  });

  it('PBI 27: control chars fall back to the default folder', () => {
    const filename = exportFilenameFor('evil\npath', '2026-08-09');
    expect(filename).toBe(`${DEFAULT_EXPORT_PATH}/2026-08-09.md`);
  });

  it('PBI 27: empty exportPath falls back to the default folder', () => {
    expect(exportFilenameFor('', '2026-08-09')).toBe(`${DEFAULT_EXPORT_PATH}/2026-08-09.md`);
  });
});

describe('dateRangeToTimestamps', () => {
  it('covers the whole of both end days', () => {
    const { since, until } = dateRangeToTimestamps('2026-08-01', '2026-08-02');
    expect(new Date(since).getHours()).toBe(0);
    expect(new Date(until).getHours()).toBe(23);
    expect(until).toBeGreaterThan(since);
  });

  it('handles a single-day range', () => {
    const { since, until } = dateRangeToTimestamps('2026-08-01', '2026-08-01');
    expect(until - since).toBeGreaterThan(0);
    expect(getLocalDateString(since)).toBe(getLocalDateString(until));
  });
});

describe('loadExportConfig', () => {
  it('falls back to the default folder when no path is configured', async () => {
    mockGetMany.mockResolvedValue({});
    const loaded = await loadExportConfig();
    expect(loaded.exportPath).toBe(DEFAULT_EXPORT_PATH);
  });

  it('uses the configured export path', async () => {
    mockGetMany.mockResolvedValue({ local_markdown_export_path: 'MyVault/Logs' });
    const loaded = await loadExportConfig();
    expect(loaded.exportPath).toBe('MyVault/Logs');
  });
});

describe('exportDateRange', () => {
  it('writes one file per date and reports the counts', async () => {
    mockQueryLogs.mockResolvedValue({
      data: { rows: [row(1, '2026-08-01'), row(2, '2026-08-01'), row(3, '2026-08-02')], total: 3 },
    });
    const dl = makeDownloadSpy();

    const result = await exportDateRange(config, '2026-08-01', '2026-08-02', dl.port);

    expect(result).toEqual({ totalRows: 3, totalFiles: 2 });
    expect(dl.calls.map(c => c.filename)).toEqual([
      'Yasumaro/2026-08-01.md',
      'Yasumaro/2026-08-02.md',
    ]);
    // The first file carries both of that date's entries.
    expect(dl.calls[0]!.content).toContain('Title 1');
    expect(dl.calls[0]!.content).toContain('Title 2');
    expect(dl.calls[0]!.content).not.toContain('Title 3');
  });

  it('reports zero and writes nothing when the range is empty', async () => {
    mockQueryLogs.mockResolvedValue({ data: { rows: [], total: 0 } });
    const dl = makeDownloadSpy();

    const result = await exportDateRange(config, '2026-08-01', '2026-08-02', dl.port);

    expect(result).toEqual({ totalRows: 0, totalFiles: 0 });
    expect(dl.calls).toHaveLength(0);
  });

  it('surfaces a query error instead of reporting an empty range', async () => {
    mockQueryLogs.mockResolvedValue({ error: 'db unavailable' });
    const dl = makeDownloadSpy();

    await expect(
      exportDateRange(config, '2026-08-01', '2026-08-02', dl.port)
    ).rejects.toThrow('db unavailable');
    expect(dl.calls).toHaveLength(0);
  });

  it('surfaces a query error instead of an empty range', async () => {
    mockQueryLogs.mockResolvedValue({ error: 'Storage quota exceeded.' });
    const dl = makeDownloadSpy();

    await expect(
      exportDateRange(config, '2026-08-01', '2026-08-02', dl.port)
    ).rejects.toThrow('Storage quota exceeded.');
    expect(dl.calls).toHaveLength(0);
  });

  // PBI 2026-10-15-02: spec pin — same HH:MM on different days must render
  // the identical timestamp string, before and after memoization.
  it('renders the same timestamp for the same minute on different days', () => {
    const a = toMarkdownTemplateEntryData({
      url: 'https://example.com/1',
      created_at: new Date(2026, 9, 1, 9, 5, 12).getTime(),
    });
    const b = toMarkdownTemplateEntryData({
      url: 'https://example.com/2',
      created_at: new Date(2026, 9, 15, 9, 5, 47).getTime(),
    });
    expect(a.timestamp).toBe(b.timestamp);
  });
});

describe('exportDateRange keyset paging (PBI 2026-11-26-16)', () => {
  const DAY_MS = 86_400_000;
  const PAGE_BASE = new Date(2026, 7, 1, 0, 0, 0).getTime();
  const RANGE_START = '2026-08-01';
  // Wide enough that every row set used below sits inside the range.
  const RANGE_END = '2026-08-31';
  const { since: rangeSince, until: rangeUntil } = dateRangeToTimestamps(RANGE_START, RANGE_END);

  interface LightRow {
    id: number;
    url: string;
    title: string;
    summary: string;
    tags: string;
    created_at: number;
  }

  /** Rows in ASC created_at order, spread over day-blocks of 7,000 rows. */
  function spreadRows(count: number): LightRow[] {
    return Array.from({ length: count }, (_, i) => {
      const day = Math.floor(i / 7000);
      return {
        id: i + 1,
        url: `https://example.com/${i + 1}`,
        title: `Title ${i + 1}`,
        summary: `Summary ${i + 1}`,
        tags: '',
        created_at: PAGE_BASE + day * DAY_MS + (i % 7000) * 1_000,
      };
    });
  }

  /** Engine double: inclusive since/until window, plain-cap clamp, ASC order. */
  function installRangeStore(rows: LightRow[], total: number = rows.length): void {
    mockQueryLogs.mockImplementation((payload: { since?: number; until?: number }) => {
      const since = typeof payload.since === 'number' ? payload.since : Number.NEGATIVE_INFINITY;
      const until = typeof payload.until === 'number' ? payload.until : Number.POSITIVE_INFINITY;
      const page = rows
        .filter((r) => r.created_at >= since && r.created_at <= until)
        .slice(0, QUERY_CAPS.plain);
      return Promise.resolve({ data: { rows: page, total } });
    });
  }

  function payloads(): Array<{ since?: number; until?: number; limit?: number; orderDir?: string }> {
    return mockQueryLogs.mock.calls.map((call) => call[0]);
  }

  function exportedTitles(files: Array<{ content: string }>): string[] {
    return files.flatMap((f) => [...f.content.matchAll(/Title (\d+)/g)].map((m) => m[1]!));
  }

  it('exports 15,000 rows across three dates with no page-boundary duplicates', async () => {
    installRangeStore(spreadRows(15_000));
    const dl = makeDownloadSpy();

    const result = await exportDateRange(config, RANGE_START, RANGE_END, dl.port);

    expect(result).toEqual({ totalRows: 15_000, totalFiles: 3 });
    expect(mockQueryLogs).toHaveBeenCalledTimes(2);
    // One file per date, written once after all pages were collected: the
    // boundary-spanning date carries rows from both pages in a single file.
    expect(dl.calls.map((c) => c.filename)).toEqual([
      'Yasumaro/2026-08-01.md',
      'Yasumaro/2026-08-02.md',
      'Yasumaro/2026-08-03.md',
    ]);
    expect(dl.calls[1]!.content).toContain('Title 10002');
    const titles = exportedTitles(dl.calls);
    expect(titles).toHaveLength(15_000);
    expect(new Set(titles).size).toBe(15_000);
  });

  it("continues with since = the previous page's newest created_at and keeps the range end", async () => {
    const store = spreadRows(15_000);
    installRangeStore(store);

    await exportDateRange(config, RANGE_START, RANGE_END, makeDownloadSpy().port);

    const calls = payloads();
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.limit).toBe(DATE_RANGE_QUERY_LIMIT);
      expect(call.until).toBe(rangeUntil);
    }
    expect(calls[0]!.since).toBe(rangeSince);
    expect(calls[1]!.since).toBe(store[QUERY_CAPS.plain - 1]!.created_at);
  });

  it('emits page-boundary rows sharing one timestamp exactly once', async () => {
    // Pairs share a created_at, so page 1 ends on a tie that page 2 re-reads
    // inclusively (since is >=); dedup by id must count each row once.
    const rows = spreadRows(12_000).map((r, i) => ({ ...r, created_at: PAGE_BASE + Math.floor(i / 2) * 10 }));
    installRangeStore(rows);
    const dl = makeDownloadSpy();

    const result = await exportDateRange(config, RANGE_START, RANGE_END, dl.port);

    expect(result.totalRows).toBe(12_000);
    const titles = exportedTitles(dl.calls);
    expect(titles).toHaveLength(12_000);
    expect(new Set(titles).size).toBe(12_000);
  });

  it('advances past a full page of boundary ties without stalling', async () => {
    // One page shares a single millisecond and one later row exists: page 2
    // re-reads the same ties, so the cursor must step forward 1ms to reach
    // the later row (queryAllData precedent, cursor direction reversed).
    const ties = spreadRows(QUERY_CAPS.plain).map((r) => ({ ...r, created_at: PAGE_BASE }));
    const later = {
      ...ties[0]!,
      id: QUERY_CAPS.plain + 1,
      title: `Title ${QUERY_CAPS.plain + 1}`,
      created_at: PAGE_BASE + 5,
    };
    installRangeStore([...ties, later]);
    const dl = makeDownloadSpy();

    const result = await exportDateRange(config, RANGE_START, RANGE_END, dl.port);

    expect(result.totalRows).toBe(QUERY_CAPS.plain + 1);
    expect(mockQueryLogs).toHaveBeenCalledTimes(3);
    expect(exportedTitles(dl.calls)).toContain(String(QUERY_CAPS.plain + 1));
  });

  it('completes at exactly MAX_EXPORT_ROWS (100,000 rows)', async () => {
    installRangeStore(spreadRows(MAX_EXPORT_ROWS));
    const dl = makeDownloadSpy();

    const result = await exportDateRange(config, RANGE_START, RANGE_END, dl.port);

    expect(result.totalRows).toBe(MAX_EXPORT_ROWS);
    const titles = exportedTitles(dl.calls);
    expect(new Set(titles).size).toBe(MAX_EXPORT_ROWS);
    // 10 full pages plus a short 11th: each continuation page re-reads one
    // boundary row inclusively.
    expect(mockQueryLogs).toHaveBeenCalledTimes(11);
  });

  it('stops at MAX_EXPORT_ROWS and returns the reached count when the range exceeds it', async () => {
    installRangeStore(spreadRows(MAX_EXPORT_ROWS + 5_000));
    const dl = makeDownloadSpy();

    const result = await exportDateRange(config, RANGE_START, RANGE_END, dl.port);

    // Above-cap rows are not exported; the reached count is returned (no
    // error, totalRows contract kept).
    expect(result.totalRows).toBe(MAX_EXPORT_ROWS);
    const titles = exportedTitles(dl.calls);
    expect(new Set(titles).size).toBe(MAX_EXPORT_ROWS);
    expect(titles).not.toContain(String(MAX_EXPORT_ROWS + 1));
  });
});

describe('exportFullHistoryInBatches', () => {
  it('pages through the history until a short batch ends it', async () => {
    mockGetPlatformOs.mockReturnValue('android'); // batch size 500
    const firstBatch = Array.from({ length: EXPORT_BATCH_SIZE_MOBILE }, (_, i) => row(i, '2026-08-01'));
    const lastBatch = [row(9001, '2026-08-02')];
    mockQueryLogs
      .mockResolvedValueOnce({ data: { rows: firstBatch, total: 501 } })
      .mockResolvedValueOnce({ data: { rows: lastBatch, total: 501 } });
    const dl = makeDownloadSpy();

    const result = await exportFullHistoryInBatches(config, dl.port);

    expect(mockQueryLogs).toHaveBeenCalledTimes(2);
    expect(mockQueryLogs.mock.calls[1]![0]).toMatchObject({ offset: EXPORT_BATCH_SIZE_MOBILE });
    expect(result.totalRows).toBe(EXPORT_BATCH_SIZE_MOBILE + 1);
    expect(result.totalFiles).toBe(2);
  });

  it('flushes a date as soon as the date changes, not at the end', async () => {
    mockQueryLogs.mockResolvedValueOnce({
      data: { rows: [row(1, '2026-08-01'), row(2, '2026-08-02'), row(3, '2026-08-03')], total: 3 },
    });
    const dl = makeDownloadSpy();

    const result = await exportFullHistoryInBatches(config, dl.port);

    expect(result).toEqual({ totalRows: 3, totalFiles: 3 });
    expect(dl.calls.map(c => c.filename)).toEqual([
      'Yasumaro/2026-08-01.md',
      'Yasumaro/2026-08-02.md',
      'Yasumaro/2026-08-03.md',
    ]);
  });

  it('writes nothing for an empty history', async () => {
    mockQueryLogs.mockResolvedValueOnce({ data: { rows: [], total: 0 } });
    const dl = makeDownloadSpy();

    const result = await exportFullHistoryInBatches(config, dl.port);

    expect(result).toEqual({ totalRows: 0, totalFiles: 0 });
    expect(dl.calls).toHaveLength(0);
  });
});

describe('toMarkdownTemplateEntryData', () => {
  it('falls back to the URL when the title is missing', () => {
    const data = toMarkdownTemplateEntryData({
      url: 'https://example.com/a', title: null, summary: null, tags: null, created_at: Date.now(),
    });
    expect(data.title).toBe('https://example.com/a');
  });

  it('renders tags with a # prefix', () => {
    const data = toMarkdownTemplateEntryData({
      url: 'https://example.com/a', title: 'T', summary: 's', tags: 'ai, dev', created_at: Date.now(),
    });
    expect(data.tags).toBe('#ai #dev ');
  });

  it('produces an empty tag string when there are no tags', () => {
    const data = toMarkdownTemplateEntryData({
      url: 'https://example.com/a', title: 'T', summary: 's', tags: null, created_at: Date.now(),
    });
    expect(data.tags).toBe('');
  });

  it('collapses newlines in the summary to single spaces', () => {
    const data = toMarkdownTemplateEntryData({
      url: 'https://example.com/a', title: 'T', summary: 'line1\n\nline2', tags: null, created_at: Date.now(),
    });
    expect(data.summary).toBe('line1 line2');
  });
});
