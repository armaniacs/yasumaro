/**
 * saveLocalMarkdownStep のテスト
 *
 * 検証対象:
 * - ローカル Markdown 書き出しが有効な場合、バッファに蓄積する（PBI 2026-07-09-03: ダウンロードはidle時）
 * - 無効な場合はスキップ
 * - markdown がない場合はスキップ
 * - 日次バッファが chrome.storage.local に蓄積されること
 */

import { vi } from 'vitest';

// 自動モック
vi.mock('../../../../utils/logger.js');
vi.mock('../../../../utils/storage/types.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    StorageKeys: {
      LOCAL_MARKDOWN_EXPORT_ENABLED: 'local_markdown_export_enabled',
      LOCAL_MARKDOWN_EXPORT_AUTO_ENABLED: 'local_markdown_export_auto_enabled',
      LOCAL_MARKDOWN_EXPORT_TIMING: 'local_markdown_export_timing',
      LOCAL_MARKDOWN_EXPORT_PATH: 'local_markdown_export_path',
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
vi.mock('../../../../utils/storage/defaults.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    StorageKeys: {
      LOCAL_MARKDOWN_EXPORT_ENABLED: 'local_markdown_export_enabled',
      LOCAL_MARKDOWN_EXPORT_AUTO_ENABLED: 'local_markdown_export_auto_enabled',
      LOCAL_MARKDOWN_EXPORT_TIMING: 'local_markdown_export_timing',
      LOCAL_MARKDOWN_EXPORT_PATH: 'local_markdown_export_path',
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
vi.mock('../../../../utils/storage/encryptionSession.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    StorageKeys: {
      LOCAL_MARKDOWN_EXPORT_ENABLED: 'local_markdown_export_enabled',
      LOCAL_MARKDOWN_EXPORT_AUTO_ENABLED: 'local_markdown_export_auto_enabled',
      LOCAL_MARKDOWN_EXPORT_TIMING: 'local_markdown_export_timing',
      LOCAL_MARKDOWN_EXPORT_PATH: 'local_markdown_export_path',
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
vi.mock('../../../../utils/storage/savedUrlRepository.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    StorageKeys: {
      LOCAL_MARKDOWN_EXPORT_ENABLED: 'local_markdown_export_enabled',
      LOCAL_MARKDOWN_EXPORT_AUTO_ENABLED: 'local_markdown_export_auto_enabled',
      LOCAL_MARKDOWN_EXPORT_TIMING: 'local_markdown_export_timing',
      LOCAL_MARKDOWN_EXPORT_PATH: 'local_markdown_export_path',
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
vi.mock('../../../../utils/storage/domainFilterCache.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    StorageKeys: {
      LOCAL_MARKDOWN_EXPORT_ENABLED: 'local_markdown_export_enabled',
      LOCAL_MARKDOWN_EXPORT_AUTO_ENABLED: 'local_markdown_export_auto_enabled',
      LOCAL_MARKDOWN_EXPORT_TIMING: 'local_markdown_export_timing',
      LOCAL_MARKDOWN_EXPORT_PATH: 'local_markdown_export_path',
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
vi.mock('../../../../utils/storage/quota.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    StorageKeys: {
      LOCAL_MARKDOWN_EXPORT_ENABLED: 'local_markdown_export_enabled',
      LOCAL_MARKDOWN_EXPORT_AUTO_ENABLED: 'local_markdown_export_auto_enabled',
      LOCAL_MARKDOWN_EXPORT_TIMING: 'local_markdown_export_timing',
      LOCAL_MARKDOWN_EXPORT_PATH: 'local_markdown_export_path',
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

import { saveLocalMarkdownStep, buildDailyMarkdown } from '../saveLocalMarkdownStep.js';
import { DEFAULT_MARKDOWN_TEMPLATE } from '../../../../utils/markdownTemplateUtils.js';
import type { RecordingContext } from '../../types.js';
import type { MarkdownEntry } from '../../buffers/MarkdownBufferManager.js';

// chrome.storage.local のモック
const mockStorage: Record<string, unknown> = {};
const mockChrome = {
  storage: {
    local: {
      get: vi.fn().mockImplementation(async (keys: string | string[]) => {
        const list = Array.isArray(keys) ? keys : [keys];
        const out: Record<string, unknown> = {};
        for (const k of list) {
          if (k in mockStorage) out[k] = mockStorage[k];
        }
        return out;
      }),
      set: vi.fn().mockImplementation(async (obj: Record<string, unknown>) => {
        Object.assign(mockStorage, obj);
      }),
    },
  },
  downloads: {
    download: vi.fn().mockResolvedValue(1),
  },
  alarms: {
    get: vi.fn().mockResolvedValue(undefined),
    create: vi.fn(),
  },
};

// chrome グローバルを設定
vi.stubGlobal('chrome', mockChrome);

type ExplicitUndefined<T> = { [K in keyof T]?: T[K] | undefined };

function makeContext(overrides: ExplicitUndefined<RecordingContext> = {}): RecordingContext {
  return {
    data: {
      title: 'Test Page',
      url: 'https://example.com',
      content: 'Some content',
    },
    settings: {
      local_markdown_export_enabled: true,
      local_markdown_export_auto_enabled: true,
      local_markdown_export_timing: 'idle',
      local_markdown_export_path: 'Yasumaro',
    } as any,
    force: false,
    errors: [],
    markdown: '- 14:30 [Test Page](https://example.com)\n    - This is a test summary',
    markdownEntryData: {
      timestamp: '14:30',
      title: 'Test Page',
      url: 'https://example.com',
      summary: 'This is a test summary',
      tags: '',
      domain: 'example.com',
    },
    ...overrides,
  } as RecordingContext;
}

describe('saveLocalMarkdownStep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // storage をクリア
    for (const key of Object.keys(mockStorage)) {
      delete mockStorage[key];
    }
  });

  describe('無効な場合', () => {
    it('skips when markdownEntryData is undefined regardless of the markdown field', async () => {
      const context = makeContext({ markdown: undefined, markdownEntryData: undefined });

      const result = await saveLocalMarkdownStep(context);

      expect(mockChrome.downloads.download).not.toHaveBeenCalled();
      expect(mockChrome.storage.local.set).not.toHaveBeenCalled();
      expect(result).toBe(context);
    });

    it('buffers when markdownEntryData exists even if the markdown field is empty or unset (Fix 4: removes markdown dependency)', async () => {
      const context = makeContext({ markdown: '' });

      const result = await saveLocalMarkdownStep(context);

      expect(mockChrome.downloads.download).not.toHaveBeenCalled();
      expect(mockChrome.storage.local.set).toHaveBeenCalledTimes(1);
      expect(result).toBe(context);
    });

    it('skips when local_markdown_export_enabled is false', async () => {
      const context = makeContext({
        settings: { local_markdown_export_enabled: false } as any,
      });

      const result = await saveLocalMarkdownStep(context);

      expect(mockChrome.downloads.download).not.toHaveBeenCalled();
      expect(result).toBe(context);
    });

    it('skips when local_markdown_export_enabled is unset', async () => {
      const context = makeContext({ settings: {} as any });

      const result = await saveLocalMarkdownStep(context);

      expect(mockChrome.downloads.download).not.toHaveBeenCalled();
      expect(result).toBe(context);
    });
  });

  describe('有効な場合（バッファ蓄積のみ、ダウンロードなし）', () => {
    it('buffers without calling download', async () => {
      const context = makeContext();

      await saveLocalMarkdownStep(context);

      // バッファが保存されること
      expect(mockChrome.storage.local.set).toHaveBeenCalledTimes(1);
      const setCall = mockChrome.storage.local.set.mock.calls[0]?.[0] as Record<string, Array<{ entryData: unknown }>>;
      const key = Object.keys(setCall)[0]!;
      expect(key).toMatch(/^local_export_\d{4}-\d{2}-\d{2}$/);
      expect(setCall[key]).toHaveLength(1);
      expect(setCall[key]![0]!.entryData).toEqual(context.markdownEntryData);

      // PBI 2026-07-09-03: ステップはダウンロードしない
      expect(mockChrome.downloads.download).not.toHaveBeenCalled();
    });

    it('skips without appending to the buffer when markdownEntryData is missing', async () => {
      const context = makeContext({ markdownEntryData: undefined });

      const result = await saveLocalMarkdownStep(context);

      expect(mockChrome.storage.local.set).not.toHaveBeenCalled();
      expect(result).toBe(context);
    });

    it('appends to the existing entry on the second run', async () => {
      const context1 = makeContext({
        markdown: '- 14:30 [Page 1](https://example.com)\n    - Summary 1',
      });
      const context2 = makeContext({
        markdown: '- 15:00 [Page 2](https://example.com)\n    - Summary 2',
      });

      await saveLocalMarkdownStep(context1);
      await saveLocalMarkdownStep(context2);

      const setCall = mockChrome.storage.local.set.mock.calls[1]?.[0] as Record<string, unknown[]>;
      const key = Object.keys(setCall)[0]!;
      expect(setCall[key]).toHaveLength(2);
    });

    it('returns the context as-is without downloadId/duration', async () => {
      const context = makeContext();

      const result = await saveLocalMarkdownStep(context);

      expect(result).toBe(context);
      expect(result).not.toHaveProperty('localMarkdownDuration');
    });
  });

  describe('エラー処理', () => {
    it('does not throw even when storage.get fails', async () => {
      mockChrome.storage.local.get.mockRejectedValueOnce(new Error('Storage error'));
      const context = makeContext();

      const result = await saveLocalMarkdownStep(context);

      expect(result).toBe(context);
    });
  });

  describe('日付バッファ', () => {
    it('uses today date in YYYY-MM-DD format', async () => {
      const context = makeContext();

      await saveLocalMarkdownStep(context);

      const setCall = mockChrome.storage.local.set.mock.calls[0]?.[0] as Record<string, unknown>;
      const key = Object.keys(setCall)[0]!;
      const dateStr = key.replace('local_export_', '');
      expect(dateStr).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('flushスケジュール', () => {
    it('creates a daily alarm when timing=immediate', async () => {
      const context = makeContext({
        settings: {
          local_markdown_export_enabled: true,
          local_markdown_export_timing: 'immediate',
          local_markdown_export_path: 'Yasumaro',
        } as any,
      });

      await saveLocalMarkdownStep(context);

      expect(mockChrome.alarms.create).toHaveBeenCalledWith(
        'yasumaro-local-md-daily',
        { periodInMinutes: 1440 }
      );
    });

    it('creates a daily alarm when timing=idle', async () => {
      const context = makeContext({
        settings: {
          local_markdown_export_enabled: true,
          local_markdown_export_timing: 'idle',
          local_markdown_export_path: 'Yasumaro',
        } as any,
      });

      await saveLocalMarkdownStep(context);

      expect(mockChrome.alarms.create).toHaveBeenCalledWith(
        'yasumaro-local-md-daily',
        { periodInMinutes: 1440 }
      );
    });

    it('does not append to the buffer when timing=manual (treated as skipped)', async () => {
      const context = makeContext({
        settings: {
          local_markdown_export_enabled: true,
          local_markdown_export_timing: 'manual',
          local_markdown_export_path: 'Yasumaro',
        } as any,
      });

      await saveLocalMarkdownStep(context);

      expect(mockChrome.storage.local.set).not.toHaveBeenCalled();
      expect(mockChrome.alarms.create).not.toHaveBeenCalled();
    });
  });
});

describe('buildDailyMarkdown', () => {
  const entries: MarkdownEntry[] = [
    {
      url: 'https://a.example.com',
      title: 'First',
      visitedAt: 1000,
      entryData: { timestamp: '09:00', title: 'First', url: 'https://a.example.com', summary: 'Summary A', tags: '', domain: 'a.example.com' },
    },
    {
      url: 'https://b.example.com',
      title: 'Second',
      visitedAt: 2000,
      entryData: { timestamp: '10:00', title: 'Second', url: 'https://b.example.com', summary: 'Summary B', tags: '#tag ', domain: 'b.example.com' },
    },
  ];

  it('renders the same output format with the default template (Fix 3: one space without tags, tags value with trailing space when tags exist)', () => {
    const result = buildDailyMarkdown('2026-08-07', entries, DEFAULT_MARKDOWN_TEMPLATE);
    expect(result).toBe(
      '# 2026-08-07\n\n' +
      '- 09:00 [First](https://a.example.com)\n    - Summary A\n\n' +
      '- 10:00 [Second](https://b.example.com)\n    - #tag Summary B'
    );
  });

  it('renders a different output format with a custom template', () => {
    const customTemplate = {
      ...DEFAULT_MARKDOWN_TEMPLATE,
      id: 'custom',
      isDefault: false,
      fileTemplate: '## {{date}} ({{entryCount}})\n{{entries}}',
      entryTemplate: '* {{title}} - {{domain}}',
    };
    const result = buildDailyMarkdown('2026-08-07', entries, customTemplate);
    expect(result).toBe('## 2026-08-07 (2)\n* First - a.example.com\n\n* Second - b.example.com');
  });

  it('renders only valid entries without throwing when legacy entries without entryData are mixed in (final review Fix 1)', () => {
    // Legacy pre-branch shape: { url, title, visitedAt, markdown: string }, no entryData.
    const legacyEntry = {
      url: 'https://legacy.example.com',
      title: 'Legacy Entry',
      visitedAt: 500,
      markdown: '- 08:00 [Legacy Entry](https://legacy.example.com)\n    - Old format summary',
    } as unknown as MarkdownEntry;

    const validEntry: MarkdownEntry = {
      url: 'https://a.example.com',
      title: 'First',
      visitedAt: 1000,
      entryData: { timestamp: '09:00', title: 'First', url: 'https://a.example.com', summary: 'Summary A', tags: '', domain: 'a.example.com' },
    };

    expect(() => buildDailyMarkdown('2026-08-07', [legacyEntry, validEntry], DEFAULT_MARKDOWN_TEMPLATE)).not.toThrow();

    const result = buildDailyMarkdown('2026-08-07', [legacyEntry, validEntry], DEFAULT_MARKDOWN_TEMPLATE);
    expect(result).toBe('# 2026-08-07\n\n- 09:00 [First](https://a.example.com)\n    - Summary A');
    // The legacy entry must not appear in the rendered output.
    expect(result).not.toContain('Legacy Entry');
    expect(result).not.toContain('Old format summary');
  });
});
