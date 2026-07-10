/**
 * localMarkdownExportCore.test.ts
 * Shared flush logic used by immediate / idle / daily export timings.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetSettings = vi.hoisted(() => vi.fn());
const mockStorageGet = vi.hoisted(() => vi.fn());
const mockDownload = vi.hoisted(() => vi.fn());

vi.mock('../../utils/storage.js', () => ({
  StorageKeys: {
    LOCAL_MARKDOWN_EXPORT_PATH: 'local_markdown_export_path',
  },
  getSettings: mockGetSettings,
}));

vi.mock('../../utils/logger.js', () => ({
  addLog: vi.fn(),
  LogType: { INFO: 'INFO', ERROR: 'ERROR' },
}));

vi.mock('../pipeline/steps/saveLocalMarkdownStep.js', () => ({
  DAILY_BUFFER_PREFIX: 'local_export_',
  buildDailyMarkdown: vi.fn((date: string, entries: string[]) => `# ${date}\n${entries.join('\n')}`),
}));

vi.stubGlobal('chrome', {
  storage: { local: { get: mockStorageGet } },
  downloads: { download: mockDownload },
});

import { flushBufferedExports } from '../localMarkdownExportCore.js';

describe('flushBufferedExports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSettings.mockResolvedValue({ local_markdown_export_path: 'Yasumaro' });
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
});
