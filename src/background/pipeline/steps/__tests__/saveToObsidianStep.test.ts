/**
 * saveToObsidianStep のテスト
 *
 * 検証対象:
 * - obsidian パラメータが DI 注入（テスト時オーバーライド）として機能すること
 * - markdown がない場合は Obsidian に保存しない
 * - 保存成功時はコンテキストに obsidianDuration を追加して返す
 * - 保存失敗時はエラーを throw してリトライを促す
 */

import { vi } from 'vitest';

// 自動モック: すべての export が vi.fn() になる
vi.mock('../../utils/logger.js');
vi.mock('../../../obsidianClient.js');
vi.mock('../../../utils/storage.js', () => ({
  StorageKeys: {
    OBSIDIAN_API_KEY: 'obsidian_api_key',
  },
}));
vi.mock('../../../notificationHelper.js', () => ({
  NotificationHelper: { notifySuccess: vi.fn(), notifyError: vi.fn() },
}));

import { saveToObsidianStep } from '../saveToObsidianStep.js';
import type { RecordingContext } from '../../types.js';
import { ObsidianClient } from '../../../obsidianClient.js';
import { StorageKeys } from '../../../utils/storage.js';

function makeContext(overrides: Partial<RecordingContext> = {}): RecordingContext {
  return {
    data: {
      title: 'Test Page',
      url: 'https://example.com',
      content: 'Some content',
    },
    settings: { obsidian_api_key: 'valid-api-key-with-at-least-16-chars' } as any,
    force: false,
    errors: [],
    markdown: '## Test Page\n\nSome content',
    ...overrides,
  };
}

describe('saveToObsidianStep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // ObsidianClient モックのデフォルト実装 (function 宣言で new 可能)
    (ObsidianClient as any).mockImplementation(function() {
      return {
        appendToDailyNote: vi.fn().mockResolvedValue(undefined)
      };
    });
  });

  describe('DI: obsidian パラメータの注入', () => {
    it('注入された obsidian クライアントの appendToDailyNote が呼ばれる', async () => {
      const mockObsidian = {
        appendToDailyNote: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      };
      const context = makeContext();

      await saveToObsidianStep(context, mockObsidian as any);

      expect(mockObsidian.appendToDailyNote).toHaveBeenCalledWith(context.markdown);
    });

    it('obsidian を省略すると ObsidianClient を内部生成してフォールバックする', async () => {
      const context = makeContext();

      const result = await saveToObsidianStep(context);

      // ObsidianClient の constructor が呼ばれたことを確認
      expect(ObsidianClient).toHaveBeenCalledTimes(1);
      // appendToDailyNote が呼ばれたことを確認
      const instance = (ObsidianClient as any).mock.results[0].value;
      expect(instance.appendToDailyNote).toHaveBeenCalledWith(context.markdown);
    });
  });

  describe('markdown なしの場合', () => {
    it('markdown が undefined の場合は Obsidian に保存せずコンテキストを返す', async () => {
      const mockObsidian = {
        appendToDailyNote: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      };
      const context = makeContext({ markdown: undefined });

      const result = await saveToObsidianStep(context, mockObsidian as any);

      expect(mockObsidian.appendToDailyNote).not.toHaveBeenCalled();
      expect(result).toBe(context);
    });

    it('markdown が空文字の場合は Obsidian に保存せずコンテキストを返す', async () => {
      const mockObsidian = {
        appendToDailyNote: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      };
      const context = makeContext({ markdown: '' });

      const result = await saveToObsidianStep(context, mockObsidian as any);

      expect(mockObsidian.appendToDailyNote).not.toHaveBeenCalled();
      expect(result).toBe(context);
    });
  });

  describe('Obsidian 未設定の場合', () => {
    it('Obsidian API key が空の場合はスキップしコンテキストを返す', async () => {
      const context = makeContext({ settings: { obsidian_api_key: '' } as any });

      const result = await saveToObsidianStep(context); // no obsidian param → checks settings

      // appendToDailyNote should not be called (skipped by settings check)
      expect(ObsidianClient).not.toHaveBeenCalled();
      expect(result).toBe(context);
    });

    it('Obsidian API key が短すぎる場合はスキップする', async () => {
      const context = makeContext({ settings: { obsidian_api_key: 'short' } as any });

      const result = await saveToObsidianStep(context); // no obsidian param → checks settings

      expect(ObsidianClient).not.toHaveBeenCalled();
      expect(result).toBe(context);
    });

    it('settings に obsidian_api_key がない場合はスキップする', async () => {
      const context = makeContext({ settings: {} as any });

      const result = await saveToObsidianStep(context); // no obsidian param → checks settings

      expect(ObsidianClient).not.toHaveBeenCalled();
      expect(result).toBe(context);
    });

    it('obsidian パラメーターが注入された場合は設定チェックをスキップし保存する', async () => {
      const mockObsidian = {
        appendToDailyNote: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      };
      // settings with no API key → should still save because obsidian is injected
      const context = makeContext({ settings: {} as any });

      const result = await saveToObsidianStep(context, mockObsidian as any);

      expect(mockObsidian.appendToDailyNote).toHaveBeenCalledWith(context.markdown);
      expect(result).toEqual(expect.objectContaining(context));
      expect(result).toHaveProperty('obsidianDuration');
    });
  });

  describe('保存成功時', () => {
    it('markdown が設定されていれば Obsidian に保存し、obsidianDuration 付きのコンテキストを返す', async () => {
      const mockObsidian = {
        appendToDailyNote: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      };
      const context = makeContext();

      const result = await saveToObsidianStep(context, mockObsidian as any);

      expect(mockObsidian.appendToDailyNote).toHaveBeenCalledWith(context.markdown);
      expect(result).toEqual(expect.objectContaining(context));
      expect(result).toHaveProperty('obsidianDuration');
      expect(typeof result.obsidianDuration).toBe('number');
    });
  });

  describe('保存失敗時', () => {
    it('Obsidian 保存で例外発生時はエラーを throw する', async () => {
      const mockObsidian = {
        appendToDailyNote: vi.fn<() => Promise<void>>().mockRejectedValue(new Error('Obsidian connection failed')),
      };
      const context = makeContext();

      await expect(saveToObsidianStep(context, mockObsidian as any)).rejects.toThrow(
        'Obsidian connection failed'
      );
    });
  });
});
