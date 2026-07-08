/**
 * localMarkdownIdleFlusher.test.ts
 * PBI 2026-07-09-03: defer local Markdown export to idle / periodic flush.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// hoisted mocks (referenced inside stubGlobal)
const mockGetSettings = vi.hoisted(() => vi.fn());
const mockStorageGet = vi.hoisted(() => vi.fn());
const mockDownload = vi.hoisted(() => vi.fn());
const mockOnStateChangedAddListener = vi.hoisted(() => vi.fn());
const mockIdle = vi.hoisted(() => ({ onStateChanged: { addListener: mockOnStateChangedAddListener } }));
const mockAlarmsCreate = vi.hoisted(() => vi.fn());

vi.mock('../../utils/storage.js', () => ({
  StorageKeys: {
    LOCAL_MARKDOWN_EXPORT_AUTO_ENABLED: 'local_markdown_export_auto_enabled',
    LOCAL_MARKDOWN_EXPORT_PATH: 'local_markdown_export_path',
  },
  DEFAULT_SETTINGS: {},
  getSettings: mockGetSettings,
}));

vi.mock('../../utils/logger.js', () => ({
  addLog: vi.fn(),
  LogType: { INFO: 'INFO', ERROR: 'ERROR' },
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
  ErrorCode: { INTERNAL_ERROR: 'INT_001' },
}));

vi.mock('../../utils/errorUtils.js', () => ({
  errorMessage: vi.fn((e: unknown) => String(e)),
}));

vi.mock('../pipeline/steps/saveLocalMarkdownStep.js', () => ({
  DAILY_BUFFER_PREFIX: 'local_export_',
  buildDailyMarkdown: vi.fn((date: string, entries: string[]) => `# ${date}\n${entries.join('\n')}`),
}));

vi.stubGlobal('chrome', {
  storage: { local: { get: mockStorageGet } },
  downloads: { download: mockDownload },
  idle: mockIdle,
  alarms: { create: mockAlarmsCreate },
});

import { flushPendingExports, initIdleFlush } from '../localMarkdownIdleFlusher.js';

describe('localMarkdownIdleFlusher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('downloads once per buffered day when auto export is enabled', async () => {
    mockGetSettings.mockResolvedValue({
      local_markdown_export_auto_enabled: true,
      local_markdown_export_path: 'Yasumaro',
    });
    mockStorageGet.mockResolvedValue({
      'local_export_2026-07-09': ['# a', '# b'],
    });

    await flushPendingExports();

    expect(mockDownload).toHaveBeenCalledTimes(1);
    const [arg] = mockDownload.mock.calls[0];
    expect(arg.filename).toBe('Yasumaro/2026-07-09.md');
    expect(arg.url).toContain('data:text/markdown;base64,');
    expect(arg.conflictAction).toBe('overwrite');
  });

  it('skips download when auto export is disabled', async () => {
    mockGetSettings.mockResolvedValue({
      local_markdown_export_auto_enabled: false,
      local_markdown_export_path: 'Yasumaro',
    });
    mockStorageGet.mockResolvedValue({
      'local_export_2026-07-09': ['# a'],
    });

    await flushPendingExports();

    expect(mockDownload).not.toHaveBeenCalled();
  });

  it('skips flush when no buffered entries exist', async () => {
    mockGetSettings.mockResolvedValue({
      local_markdown_export_auto_enabled: true,
      local_markdown_export_path: 'Yasumaro',
    });
    mockStorageGet.mockResolvedValue({
      'other_key': 'value',
    });

    await flushPendingExports();

    expect(mockDownload).not.toHaveBeenCalled();
  });

  it('initIdleFlush registers idle listener and periodic alarm', () => {
    initIdleFlush();

    expect(mockAlarmsCreate).toHaveBeenCalledWith('yasumaro-local-md-flush', {
      periodInMinutes: 30,
    });
    expect(mockOnStateChangedAddListener).toHaveBeenCalledWith(expect.any(Function));
  });
});
