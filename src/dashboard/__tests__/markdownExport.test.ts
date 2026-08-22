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
const mockGetSettings = vi.fn();
const mockGetPlatformOs = vi.fn();

vi.mock('../dashboardSqliteService.js', () => ({
  queryLogs: (...args: unknown[]) => mockQueryLogs(...args),
}));

vi.mock('../../utils/storage/types.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    getSettings: (...args: unknown[]) => mockGetSettings(...args),
    StorageKeys: {
      LOCAL_MARKDOWN_EXPORT_PATH: 'local_markdown_export_path',
      MARKDOWN_EXPORT_TEMPLATES: 'markdown_export_templates',
      ACTIVE_MARKDOWN_EXPORT_TEMPLATE_ID: 'active_markdown_export_template_id',
    },

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;
vi.mock('../../utils/storage/defaults.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    getSettings: (...args: unknown[]) => mockGetSettings(...args),
    StorageKeys: {
      LOCAL_MARKDOWN_EXPORT_PATH: 'local_markdown_export_path',
      MARKDOWN_EXPORT_TEMPLATES: 'markdown_export_templates',
      ACTIVE_MARKDOWN_EXPORT_TEMPLATE_ID: 'active_markdown_export_template_id',
    },

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;
vi.mock('../../utils/storage/encryptionSession.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    getSettings: (...args: unknown[]) => mockGetSettings(...args),
    StorageKeys: {
      LOCAL_MARKDOWN_EXPORT_PATH: 'local_markdown_export_path',
      MARKDOWN_EXPORT_TEMPLATES: 'markdown_export_templates',
      ACTIVE_MARKDOWN_EXPORT_TEMPLATE_ID: 'active_markdown_export_template_id',
    },

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;
vi.mock('../../utils/storage/settingsStore.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    getSettings: (...args: unknown[]) => mockGetSettings(...args),
    StorageKeys: {
      LOCAL_MARKDOWN_EXPORT_PATH: 'local_markdown_export_path',
      MARKDOWN_EXPORT_TEMPLATES: 'markdown_export_templates',
      ACTIVE_MARKDOWN_EXPORT_TEMPLATE_ID: 'active_markdown_export_template_id',
    },

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;
vi.mock('../../utils/storage/savedUrlRepository.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    getSettings: (...args: unknown[]) => mockGetSettings(...args),
    StorageKeys: {
      LOCAL_MARKDOWN_EXPORT_PATH: 'local_markdown_export_path',
      MARKDOWN_EXPORT_TEMPLATES: 'markdown_export_templates',
      ACTIVE_MARKDOWN_EXPORT_TEMPLATE_ID: 'active_markdown_export_template_id',
    },

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;
vi.mock('../../utils/storage/domainFilterCache.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    getSettings: (...args: unknown[]) => mockGetSettings(...args),
    StorageKeys: {
      LOCAL_MARKDOWN_EXPORT_PATH: 'local_markdown_export_path',
      MARKDOWN_EXPORT_TEMPLATES: 'markdown_export_templates',
      ACTIVE_MARKDOWN_EXPORT_TEMPLATE_ID: 'active_markdown_export_template_id',
    },

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;
vi.mock('../../utils/storage/quota.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    getSettings: (...args: unknown[]) => mockGetSettings(...args),
    StorageKeys: {
      LOCAL_MARKDOWN_EXPORT_PATH: 'local_markdown_export_path',
      MARKDOWN_EXPORT_TEMPLATES: 'markdown_export_templates',
      ACTIVE_MARKDOWN_EXPORT_TEMPLATE_ID: 'active_markdown_export_template_id',
    },

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;

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
  type ExportConfig,
} from '../markdownExport.js';
import type { BrowsingLogEntry } from '../dashboardSqliteService.js';

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
    mockGetSettings.mockResolvedValue({});
    const loaded = await loadExportConfig();
    expect(loaded.exportPath).toBe(DEFAULT_EXPORT_PATH);
  });

  it('uses the configured export path', async () => {
    mockGetSettings.mockResolvedValue({ local_markdown_export_path: 'MyVault/Logs' });
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
