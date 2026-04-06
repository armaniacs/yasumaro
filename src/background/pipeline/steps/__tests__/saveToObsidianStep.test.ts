/**
 * saveToObsidianStep のテスト
 *
 * 検証対象:
 * - obsidian パラメータが DI 注入（テスト時オーバーライド）として機能すること
 * - markdown がない場合は Obsidian に保存しない
 * - 保存成功時はコンテキストをそのまま返す
 * - 保存失敗時はエラーを throw してリトライを促す
 */

import { jest } from '@jest/globals';

jest.mock('../../../../utils/logger.js');
jest.mock('../../../obsidianClient.js');
jest.mock('../../../notificationHelper.js', () => ({
  NotificationHelper: { notifySuccess: jest.fn() },
}));

import { saveToObsidianStep } from '../saveToObsidianStep.js';
import type { RecordingContext } from '../../types.js';

function makeContext(overrides: Partial<RecordingContext> = {}): RecordingContext {
  return {
    data: {
      title: 'Test Page',
      url: 'https://example.com',
      content: 'Some content',
    },
    settings: {} as any,
    force: false,
    errors: [],
    markdown: '## Test Page\n\nSome content',
    ...overrides,
  };
}

describe('saveToObsidianStep', () => {
  describe('DI: obsidian パラメータの注入', () => {
    it('注入された obsidian クライアントの appendToDailyNote が呼ばれる', async () => {
      const mockObsidian = {
        appendToDailyNote: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      };
      const context = makeContext();

      await saveToObsidianStep(context, mockObsidian as any);

      expect(mockObsidian.appendToDailyNote).toHaveBeenCalledWith(context.markdown);
    });

    it('obsidian を省略すると ObsidianClient を内部生成してフォールバックする', async () => {
      const { ObsidianClient } = await import('../../../obsidianClient.js');
      const mockAppend = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
      (ObsidianClient as jest.MockedClass<typeof ObsidianClient>).mockImplementation(
        () => ({ appendToDailyNote: mockAppend }) as any
      );
      const context = makeContext();

      await saveToObsidianStep(context);

      expect(mockAppend).toHaveBeenCalledWith(context.markdown);
    });
  });

  describe('markdown なしの場合', () => {
    it('markdown が undefined の場合は Obsidian に保存せずコンテキストを返す', async () => {
      const mockObsidian = {
        appendToDailyNote: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      };
      const context = makeContext({ markdown: undefined });

      const result = await saveToObsidianStep(context, mockObsidian as any);

      expect(mockObsidian.appendToDailyNote).not.toHaveBeenCalled();
      expect(result).toBe(context);
    });

    it('markdown が空文字の場合は Obsidian に保存せずコンテキストを返す', async () => {
      const mockObsidian = {
        appendToDailyNote: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      };
      const context = makeContext({ markdown: '' });

      const result = await saveToObsidianStep(context, mockObsidian as any);

      expect(mockObsidian.appendToDailyNote).not.toHaveBeenCalled();
      expect(result).toBe(context);
    });
  });

  describe('保存成功', () => {
    it('保存成功時は同じコンテキストを返す', async () => {
      const mockObsidian = {
        appendToDailyNote: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      };
      const context = makeContext();

      const result = await saveToObsidianStep(context, mockObsidian as any);

      expect(result).toMatchObject(context);
      expect(result.obsidianDuration).toBeDefined();
      expect(typeof result.obsidianDuration).toBe('number');
    });
  });

  describe('保存失敗', () => {
    it('appendToDailyNote が例外を throw した場合は再 throw する', async () => {
      const mockObsidian = {
        appendToDailyNote: jest.fn<() => Promise<void>>().mockRejectedValue(
          new Error('Obsidian connection failed')
        ),
      };
      const context = makeContext();

      await expect(saveToObsidianStep(context, mockObsidian as any)).rejects.toThrow(
        'Obsidian connection failed'
      );
    });
  });
});
