/**
 * localMarkdownExportCore.test.ts
 * Shared flush logic used by immediate / idle / daily export timings.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetAll = vi.hoisted(() => vi.fn());
const mockStorageGet = vi.hoisted(() => vi.fn());
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

vi.mock('../../utils/logger.js', () => ({
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

const mockStorageSet = vi.hoisted(() => vi.fn());
const mockStorageRemove = vi.hoisted(() => vi.fn());

vi.stubGlobal('chrome', {
  storage: { local: { get: mockStorageGet, set: mockStorageSet, remove: mockStorageRemove } },
  downloads: { download: mockDownload, erase: vi.fn(), removeFile: vi.fn() },
});

import { flushBufferedExports } from '../localMarkdownExportCore.js';

describe('flushBufferedExports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAll.mockResolvedValue({ local_markdown_export_path: 'Yasumaro' });
    mockDownload.mockResolvedValue(123);
    mockStorageSet.mockResolvedValue(undefined);
    mockStorageRemove.mockResolvedValue(undefined);
  });

  it('downloads every buffered day when no filter is given', async () => {
    mockStorageGet.mockResolvedValue({
      'local_export_2026-07-08': ['# a'],
      'local_export_2026-07-09': ['# b'],
    });

    await flushBufferedExports();

    expect(mockDownload).toHaveBeenCalledTimes(2);
  });

  it('downloads only days that pass the filter', async () => {
    mockStorageGet.mockResolvedValue({
      'local_export_2026-07-08': ['# a'],
      'local_export_2026-07-09': ['# b'],
    });

    await flushBufferedExports((date) => date === '2026-07-08');

    expect(mockDownload).toHaveBeenCalledTimes(1);
    const [arg] = mockDownload.mock.calls[0];
    expect(arg.filename).toBe('Yasumaro/2026-07-08.md');
  });

  it('skips days with empty entries', async () => {
    mockStorageGet.mockResolvedValue({
      'local_export_2026-07-08': [],
    });

    await flushBufferedExports();

    expect(mockDownload).not.toHaveBeenCalled();
  });

  it('ignores non-buffer keys', async () => {
    mockStorageGet.mockResolvedValue({
      other_key: 'value',
    });

    await flushBufferedExports();

    expect(mockDownload).not.toHaveBeenCalled();
  });

  it('swallows errors and does not throw', async () => {
    mockStorageGet.mockRejectedValue(new Error('storage failure'));

    await expect(flushBufferedExports()).resolves.toBeUndefined();
  });

  it('最終レビュー Fix 1: 1日分の buildDailyMarkdown が throw しても、他の日のフラッシュは継続される', async () => {
    const { buildDailyMarkdown } = await import('../pipeline/steps/saveLocalMarkdownStep.js');
    const mockBuildDailyMarkdown = buildDailyMarkdown as unknown as ReturnType<typeof vi.fn>;
    mockBuildDailyMarkdown.mockImplementation((date: string, entries: string[]) => {
      if (date === '2026-07-08') {
        // Simulate a legacy/poisoned entry crashing rendering for this date only.
        throw new TypeError("Cannot read properties of undefined (reading 'timestamp')");
      }
      return `# ${date}\n${entries.join('\n')}`;
    });

    mockStorageGet.mockResolvedValue({
      'local_export_2026-07-08': ['# poisoned'],
      'local_export_2026-07-09': ['# ok'],
    });

    await expect(flushBufferedExports()).resolves.toBeUndefined();

    // The healthy date must still be downloaded despite the other date's crash.
    expect(mockDownload).toHaveBeenCalledTimes(1);
    expect(mockDownload.mock.calls[0][0].filename).toBe('Yasumaro/2026-07-09.md');
  });

  it('VULN-004: deletes the daily buffer key after a successful flush', async () => {
    mockStorageGet.mockResolvedValue({
      'local_export_2026-09-15': ['# a'],
    });

    await flushBufferedExports();

    expect(mockStorageRemove).toHaveBeenCalledWith('local_export_2026-09-15');
  });

  it('VULN-004: does not delete the buffer key when the download throws', async () => {
    mockDownload.mockRejectedValue(new Error('download failed'));
    mockStorageGet.mockResolvedValue({
      'local_export_2026-09-15': ['# a'],
    });

    await flushBufferedExports();

    expect(mockStorageRemove).not.toHaveBeenCalledWith('local_export_2026-09-15');
  });

  it('VULN-004: records the generated download ID', async () => {
    mockDownload.mockResolvedValue(555);
    mockStorageGet.mockResolvedValue({
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
});
