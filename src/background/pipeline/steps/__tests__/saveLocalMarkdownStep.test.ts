/**
 * saveLocalMarkdownStep のテスト
 *
 * 検証対象:
 * - ローカル Markdown 書き出しが有効な場合、chrome.downloads で書き出す
 * - 無効な場合はスキップ
 * - markdown がない場合はスキップ
 * - 日次バッファが chrome.storage.local に蓄積されること
 * - conflictAction: 'overwrite' で既存ファイルを上書きすること
 */

import { vi } from 'vitest';

// 自動モック
vi.mock('../../../../utils/logger.js');
vi.mock('../../../../utils/storage.js', () => ({
  StorageKeys: {
    LOCAL_MARKDOWN_EXPORT_ENABLED: 'local_markdown_export_enabled',
    LOCAL_MARKDOWN_EXPORT_AUTO_ENABLED: 'local_markdown_export_auto_enabled',
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

    it('local_markdown_export_auto_enabled が false の場合はスキップ', async () => {
      const context = makeContext({
        settings: {
          local_markdown_export_enabled: true,
          local_markdown_export_auto_enabled: false,
        } as any,
      });

      const result = await saveLocalMarkdownStep(context);

      expect(mockChrome.downloads.download).not.toHaveBeenCalled();
      expect(result).toBe(context);
    });
  });

  describe('有効な場合', () => {
    it('chrome.downloads.download が呼ばれる', async () => {
      const context = makeContext();

      await saveLocalMarkdownStep(context);

      expect(mockChrome.downloads.download).toHaveBeenCalledTimes(1);
      expect(mockChrome.downloads.download).toHaveBeenCalledWith(
        expect.objectContaining({
          filename: expect.stringContaining('Yasumaro/'),
          saveAs: false,
          conflictAction: 'overwrite',
        })
      );
    });

    it('日次バッファが chrome.storage.local に蓄積される', async () => {
      const context = makeContext();

      await saveLocalMarkdownStep(context);

      expect(mockChrome.storage.local.set).toHaveBeenCalledTimes(1);
      const setCall = mockChrome.storage.local.set.mock.calls[0][0];
      const key = Object.keys(setCall)[0];
      expect(key).toMatch(/^local_export_\d{4}-\d{2}-\d{2}$/);
      expect(setCall[key]).toHaveLength(1);
      expect(setCall[key][0]).toBe(context.markdown);
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

    it('カスタムパスが使用される', async () => {
      const context = makeContext({
        settings: {
          local_markdown_export_enabled: true,
          local_markdown_export_auto_enabled: true,
          local_markdown_export_path: 'MyNotes',
        } as any,
      });

      await saveLocalMarkdownStep(context);

      expect(mockChrome.downloads.download).toHaveBeenCalledWith(
        expect.objectContaining({
          filename: expect.stringContaining('MyNotes/'),
        })
      );
    });

    it('パスが未設定の場合はデフォルトの Yasumaro が使用される', async () => {
      const context = makeContext({
        settings: { local_markdown_export_enabled: true, local_markdown_export_auto_enabled: true } as any,
      });

      await saveLocalMarkdownStep(context);

      expect(mockChrome.downloads.download).toHaveBeenCalledWith(
        expect.objectContaining({
          filename: expect.stringContaining('Yasumaro/'),
        })
      );
    });

    it('data: URL が正しく使用される', async () => {
      const context = makeContext();

      await saveLocalMarkdownStep(context);

      const downloadCall = mockChrome.downloads.download.mock.calls[0][0];
      expect(downloadCall.url).toMatch(/^data:text\/markdown;base64,/);
    });

    it('localMarkdownDuration がコンテキストに追加される', async () => {
      const context = makeContext();

      const result = await saveLocalMarkdownStep(context);

      expect(result).toHaveProperty('localMarkdownDuration');
      expect(typeof result.localMarkdownDuration).toBe('number');
    });
  });

  describe('エラー処理', () => {
    it('downloads.download が失敗してもエラーを throw しない (BEST_EFFORT)', async () => {
      mockChrome.downloads.download.mockRejectedValueOnce(new Error('Download failed'));
      const context = makeContext();

      const result = await saveLocalMarkdownStep(context);

      // BEST_EFFORT: エラーを throw せずコンテキストを返す
      expect(result).toBe(context);
    });

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

    it('完全な日次 Markdown が正しく生成される', async () => {
      const context = makeContext();

      await saveLocalMarkdownStep(context);

      const downloadCall = mockChrome.downloads.download.mock.calls[0][0];
      // data: URL が使用されていることを確認
      expect(downloadCall.url).toMatch(/^data:text\/markdown;base64,/);
      // ローカルタイムゾーンの日付が使用されることを確認
      const now = new Date();
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      expect(downloadCall.filename).toBe(`Yasumaro/${today}.md`);
    });
  });
});
