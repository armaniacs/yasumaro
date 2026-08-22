/**
 * localMarkdownExportCore.test.ts
 * Shared flush logic used by immediate / idle / daily export timings.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetSettings = vi.hoisted(() => vi.fn());
const mockStorageGet = vi.hoisted(() => vi.fn());
const mockDownload = vi.hoisted(() => vi.fn());

vi.mock('../../utils/storage/types.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    StorageKeys: {
      LOCAL_MARKDOWN_EXPORT_PATH: 'local_markdown_export_path',
      MARKDOWN_EXPORT_TEMPLATES: 'markdown_export_templates',
      ACTIVE_MARKDOWN_EXPORT_TEMPLATE_ID: 'active_markdown_export_template_id',
    },
    getSettings: mockGetSettings,

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

    StorageKeys: {
      LOCAL_MARKDOWN_EXPORT_PATH: 'local_markdown_export_path',
      MARKDOWN_EXPORT_TEMPLATES: 'markdown_export_templates',
      ACTIVE_MARKDOWN_EXPORT_TEMPLATE_ID: 'active_markdown_export_template_id',
    },
    getSettings: mockGetSettings,

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

    StorageKeys: {
      LOCAL_MARKDOWN_EXPORT_PATH: 'local_markdown_export_path',
      MARKDOWN_EXPORT_TEMPLATES: 'markdown_export_templates',
      ACTIVE_MARKDOWN_EXPORT_TEMPLATE_ID: 'active_markdown_export_template_id',
    },
    getSettings: mockGetSettings,

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

    StorageKeys: {
      LOCAL_MARKDOWN_EXPORT_PATH: 'local_markdown_export_path',
      MARKDOWN_EXPORT_TEMPLATES: 'markdown_export_templates',
      ACTIVE_MARKDOWN_EXPORT_TEMPLATE_ID: 'active_markdown_export_template_id',
    },
    getSettings: mockGetSettings,

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

    StorageKeys: {
      LOCAL_MARKDOWN_EXPORT_PATH: 'local_markdown_export_path',
      MARKDOWN_EXPORT_TEMPLATES: 'markdown_export_templates',
      ACTIVE_MARKDOWN_EXPORT_TEMPLATE_ID: 'active_markdown_export_template_id',
    },
    getSettings: mockGetSettings,

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

    StorageKeys: {
      LOCAL_MARKDOWN_EXPORT_PATH: 'local_markdown_export_path',
      MARKDOWN_EXPORT_TEMPLATES: 'markdown_export_templates',
      ACTIVE_MARKDOWN_EXPORT_TEMPLATE_ID: 'active_markdown_export_template_id',
    },
    getSettings: mockGetSettings,

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

    StorageKeys: {
      LOCAL_MARKDOWN_EXPORT_PATH: 'local_markdown_export_path',
      MARKDOWN_EXPORT_TEMPLATES: 'markdown_export_templates',
      ACTIVE_MARKDOWN_EXPORT_TEMPLATE_ID: 'active_markdown_export_template_id',
    },
    getSettings: mockGetSettings,

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
});
