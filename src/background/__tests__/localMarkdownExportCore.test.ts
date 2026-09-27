/**
 * localMarkdownExportCore.test.ts
 * Shared flush logic used by immediate / idle / daily export timings.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetAll = vi.hoisted(() => vi.fn());
const mockDownload = vi.hoisted(() => vi.fn());

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
      setAll: vi.fn(),
      getMany: vi.fn(),
    },
    SettingsRepository: class {
      getAll = mockGetAll;
      setAll = vi.fn();
      getMany = vi.fn();
    },
  };
});

vi.mock('../../utils/logger/types.js', () => ({
  addLog: vi.fn(),
  LogType: { INFO: 'INFO', ERROR: 'ERROR' },
}));
vi.mock('../../utils/logger/core.js', () => ({
  addLog: vi.fn(),
  LogType: { INFO: 'INFO', ERROR: 'ERROR' },
}));
vi.mock('../../utils/logger/api.js', () => ({
  addLog: vi.fn(),
  LogType: { INFO: 'INFO', ERROR: 'ERROR' },
}));

vi.mock('../pipeline/steps/saveLocalMarkdownStep.js', () => ({
  DAILY_BUFFER_PREFIX: 'local_export_',
  buildDailyMarkdown: vi.fn((date: string, entries: string[]) => `# ${date}\n${entries.join('\n')}`),
}));

vi.mock('../../utils/markdownTemplateUtils.js', () => ({
  getActiveTemplate: vi.fn(() => ({
    id: 'default',
    name: 'Default',
    fileTemplate: '# {{date}}\n\n{{entries}}',
    entryTemplate: '- {{timestamp}} [{{title}}]({{url}})\n    - {{tags}} {{summary}}',
    isDefault: true,
    createdAt: 0,
    updatedAt: 0,
  })),
}));

const mockStorageRemove = vi.hoisted(() => vi.fn());

/**
 * Stateful chrome.storage.local stand-in.
 *
 * It has to answer two call shapes that come from different code: the flush
 * reads everything with a no-arg get, while `recordDownloadId` writes the
 * download-id list through withOptimisticLock, whose post-write verification
 * re-reads that key by name and compares the value. One mockResolvedValue
 * snapshot answers every call with the same pre-write object, so the lock's own
 * verification could never pass and the record write ended in a retried conflict
 * — which surfaced as the flush never reaching its key removal.
 */
const storageState = vi.hoisted(() => ({ data: {} as Record<string, unknown> }));

function seedStorage(data: Record<string, unknown>): void {
  for (const key of Object.keys(storageState.data)) delete storageState.data[key];
  Object.assign(storageState.data, structuredClone(data));
}

const mockStorageGet = vi.hoisted(() =>
  vi.fn((keys?: unknown): Promise<Record<string, unknown>> => {
    if (keys === undefined || keys === null) return Promise.resolve({ ...storageState.data });
    const out: Record<string, unknown> = {};
    const requested = Array.isArray(keys) ? keys : [keys as string];
    for (const key of requested) if (key in storageState.data) out[key] = storageState.data[key];
    return Promise.resolve(out);
  }),
);
const mockStorageSet = vi.hoisted(() =>
  vi.fn((items: Record<string, unknown>): Promise<void> => {
    Object.assign(storageState.data, structuredClone(items));
    return Promise.resolve();
  }),
);

vi.stubGlobal('chrome', {
  storage: { local: { get: mockStorageGet, set: mockStorageSet, remove: mockStorageRemove } },
  downloads: { download: mockDownload, erase: vi.fn(), removeFile: vi.fn() },
});

import { flushBufferedExports } from '../localMarkdownExportCore.js';

describe('flushBufferedExports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedStorage({});
    mockGetAll.mockResolvedValue({ local_markdown_export_path: 'Yasumaro' });
    mockDownload.mockResolvedValue(123);
    mockStorageRemove.mockResolvedValue(undefined);
  });

  it('downloads every buffered day when no filter is given', async () => {
    seedStorage({
      'local_export_2026-07-08': ['# a'],
      'local_export_2026-07-09': ['# b'],
    });

    await flushBufferedExports();

    expect(mockDownload).toHaveBeenCalledTimes(2);
  });

  it('downloads only days that pass the filter', async () => {
    seedStorage({
      'local_export_2026-07-08': ['# a'],
      'local_export_2026-07-09': ['# b'],
    });

    await flushBufferedExports((date) => date === '2026-07-08');

    expect(mockDownload).toHaveBeenCalledTimes(1);
    const [arg] = mockDownload.mock.calls[0] ?? [];
    expect(arg.filename).toBe('Yasumaro/2026-07-08.md');
  });

  it('skips days with empty entries', async () => {
    seedStorage({
      'local_export_2026-07-08': [],
    });

    await flushBufferedExports();

    expect(mockDownload).not.toHaveBeenCalled();
  });

  it('ignores non-buffer keys', async () => {
    seedStorage({
      other_key: 'value',
    });

    await flushBufferedExports();

    expect(mockDownload).not.toHaveBeenCalled();
  });

  it('swallows errors and does not throw', async () => {
    mockStorageGet.mockRejectedValueOnce(new Error('storage failure'));

    await expect(flushBufferedExports()).resolves.toBeUndefined();
  });

  it('Final review Fix 1: continues flushing other days even when one day of buildDailyMarkdown throws', async () => {
    const { buildDailyMarkdown } = await import('../pipeline/steps/saveLocalMarkdownStep.js');
    const mockBuildDailyMarkdown = buildDailyMarkdown as unknown as ReturnType<typeof vi.fn>;
    mockBuildDailyMarkdown.mockImplementation((date: string, entries: string[]) => {
      if (date === '2026-07-08') {
        // Simulate a legacy/poisoned entry crashing rendering for this date only.
        throw new TypeError("Cannot read properties of undefined (reading 'timestamp')");
      }
      return `# ${date}\n${entries.join('\n')}`;
    });

    seedStorage({
      'local_export_2026-07-08': ['# poisoned'],
      'local_export_2026-07-09': ['# ok'],
    });

    await expect(flushBufferedExports()).resolves.toBeUndefined();

    // The healthy date must still be downloaded despite the other date's crash.
    expect(mockDownload).toHaveBeenCalledTimes(1);
    expect(mockDownload.mock.calls[0]?.[0].filename).toBe('Yasumaro/2026-07-09.md');
  });

  it('VULN-004: deletes the daily buffer key after a successful flush', async () => {
    seedStorage({
      'local_export_2026-09-15': ['# a'],
    });

    await flushBufferedExports();

    expect(mockStorageRemove).toHaveBeenCalledWith('local_export_2026-09-15');
  });

  it('VULN-004: does not delete the buffer key when the download throws', async () => {
    mockDownload.mockRejectedValue(new Error('download failed'));
    seedStorage({
      'local_export_2026-09-15': ['# a'],
    });

    await flushBufferedExports();

    expect(mockStorageRemove).not.toHaveBeenCalledWith('local_export_2026-09-15');
  });

  it('VULN-004: records the generated download ID', async () => {
    mockDownload.mockResolvedValue(555);
    seedStorage({
      'local_export_2026-09-15': ['# a'],
    });

    await flushBufferedExports();

    const idWrite = mockStorageSet.mock.calls.find(
      (c) => 'local_md_export_download_ids' in c[0],
    );
    expect(idWrite).toBeDefined();
    const records = idWrite![0]['local_md_export_download_ids'] as Array<{ downloadId: number; date: string }>;
    expect(records[records.length - 1]).toMatchObject({ downloadId: 555, date: '2026-09-15' });
  });

  it('PBI 27: traversal in exportPath never reaches the download filename', async () => {
    mockGetAll.mockResolvedValue({ local_markdown_export_path: '../../etc/passwd' });
    seedStorage({
      'local_export_2026-09-15': ['# a'],
    });

    await flushBufferedExports();

    expect(mockDownload).toHaveBeenCalledTimes(1);
    const [arg] = mockDownload.mock.calls[0] ?? [];
    expect(arg.filename).not.toContain('..');
    expect(arg.filename).toBe('Yasumaro/2026-09-15.md');
  });
});
