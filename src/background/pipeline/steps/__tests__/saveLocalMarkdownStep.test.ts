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
vi.mock('../../../../utils/storage.js', () => ({
  StorageKeys: {
    LOCAL_MARKDOWN_EXPORT_ENABLED: 'local_markdown_export_enabled',
    LOCAL_MARKDOWN_EXPORT_AUTO_ENABLED: 'local_markdown_export_auto_enabled',
    LOCAL_MARKDOWN_EXPORT_TIMING: 'local_markdown_export_timing',
    LOCAL_MARKDOWN_EXPORT_PATH: 'local_markdown_export_path',
  },
}));

import { saveLocalMarkdownStep } from '../saveLocalMarkdownStep.js';
import type { RecordingContext } from '../../types.js';

// chrome.storage.local のモック
const mockStorage: Record<string, unknown> = {};
const mockChrome = {
  storage: {
    local: {
      get: vi.fn().mockImplementation(async (key: string) => ({ [key]: mockStorage[key] })),
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

function makeContext(overrides: Partial<RecordingContext> = {}): RecordingContext {
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
    ...overrides,
  };
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
    it('markdown が undefined の場合はスキップ', async () => {
      const context = makeContext({ markdown: undefined });

      const result = await saveLocalMarkdownStep(context);

      expect(mockChrome.downloads.download).not.toHaveBeenCalled();
      expect(result).toBe(context);
    });

    it('markdown が空文字の場合はスキップ', async () => {
      const context = makeContext({ markdown: '' });

      const result = await saveLocalMarkdownStep(context);

      expect(mockChrome.downloads.download).not.toHaveBeenCalled();
      expect(result).toBe(context);
    });

    it('local_markdown_export_enabled が false の場合はスキップ', async () => {
      const context = makeContext({
        settings: { local_markdown_export_enabled: false } as any,
      });

      const result = await saveLocalMarkdownStep(context);

      expect(mockChrome.downloads.download).not.toHaveBeenCalled();
      expect(result).toBe(context);
    });

    it('local_markdown_export_enabled が未設定の場合はスキップ', async () => {
      const context = makeContext({ settings: {} as any });

      const result = await saveLocalMarkdownStep(context);

      expect(mockChrome.downloads.download).not.toHaveBeenCalled();
      expect(result).toBe(context);
    });
  });

  describe('有効な場合（バッファ蓄積のみ、ダウンロードなし）', () => {
    it('バッファに蓄積され、ダウンロードは呼ばれない', async () => {
      const context = makeContext();

      await saveLocalMarkdownStep(context);

      // バッファが保存されること
      expect(mockChrome.storage.local.set).toHaveBeenCalledTimes(1);
      const setCall = mockChrome.storage.local.set.mock.calls[0][0];
      const key = Object.keys(setCall)[0];
      expect(key).toMatch(/^local_export_\d{4}-\d{2}-\d{2}$/);
      expect(setCall[key]).toHaveLength(1);
      expect(setCall[key][0].markdown).toBe(context.markdown);

      // PBI 2026-07-09-03: ステップはダウンロードしない
      expect(mockChrome.downloads.download).not.toHaveBeenCalled();
    });

    it('2回目の実行で既存エントリに追加される', async () => {
      const context1 = makeContext({
        markdown: '- 14:30 [Page 1](https://example.com)\n    - Summary 1',
      });
      const context2 = makeContext({
        markdown: '- 15:00 [Page 2](https://example.com)\n    - Summary 2',
      });

      await saveLocalMarkdownStep(context1);
      await saveLocalMarkdownStep(context2);

      const setCall = mockChrome.storage.local.set.mock.calls[1][0];
      const key = Object.keys(setCall)[0];
      expect(setCall[key]).toHaveLength(2);
    });

    it('コンテキストをそのまま返す（downloadId/duration なし）', async () => {
      const context = makeContext();

      const result = await saveLocalMarkdownStep(context);

      expect(result).toBe(context);
      expect(result).not.toHaveProperty('localMarkdownDuration');
    });
  });

  describe('エラー処理', () => {
    it('storage.get が失敗してもエラーを throw しない', async () => {
      mockChrome.storage.local.get.mockRejectedValueOnce(new Error('Storage error'));
      const context = makeContext();

      const result = await saveLocalMarkdownStep(context);

      expect(result).toBe(context);
    });
  });

  describe('日付バッファ', () => {
    it('今日の日付が YYYY-MM-DD 形式で使用される', async () => {
      const context = makeContext();

      await saveLocalMarkdownStep(context);

      const setCall = mockChrome.storage.local.set.mock.calls[0][0];
      const key = Object.keys(setCall)[0];
      const dateStr = key.replace('local_export_', '');
      expect(dateStr).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('flushスケジュール', () => {
    it('timing=immediate の場合、日次アラームを作成する', async () => {
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

    it('timing=idle の場合も日次アラームを作成する', async () => {
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

    it('timing=manual の場合はバッファに追記されない（スキップ扱い）', async () => {
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
