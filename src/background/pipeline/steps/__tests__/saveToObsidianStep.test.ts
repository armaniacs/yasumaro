/**
 * saveToObsidianStep のテスト
 *
 * 検証対象:
 * - StepDeps 通过で obsidian クライアントが注入されること
 * - markdown がない場合は Obsidian に保存しない
 * - 保存成功時はコンテキストに obsidianDuration を追加して返す
 * - 保存失敗時はエラーを throw してリトライを促す
 */

import { vi } from 'vitest';

vi.mock('../../utils/logger.js');
vi.mock('../../../notificationHelper.js', () => ({
  NotificationHelper: { notifySuccess: vi.fn(), notifyError: vi.fn() },
}));

import { saveToObsidianStep } from '../saveToObsidianStep.js';
import type { RecordingContext, StepDeps } from '../../types.js';
import { StorageKeys } from '../../../utils/storage/types.js';

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

function makeDeps(overrides: Partial<StepDeps> = {}): StepDeps {
  return {
    obsidian: {
      appendToDailyNote: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    } as any,
    aiService: {
      generateSummary: vi.fn(),
      getSupportedModes: vi.fn(),
    } as any,
    ...overrides,
  };
}

describe('saveToObsidianStep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('DI: StepDeps 通过の注入', () => {
    it('注入された obsidian クライアントの appendToDailyNote が呼ばれる', async () => {
      const deps = makeDeps();
      const context = makeContext();

      await saveToObsidianStep(context, deps);

      expect(deps.obsidian.appendToDailyNote).toHaveBeenCalledWith(context.markdown, context.traceId);
    });

    it('deps を省略するとスキップする（obsidian が undefined の場合）', async () => {
      const context = makeContext();

      const result = await saveToObsidianStep(context);

      // No deps, no API key check passes → should skip
      expect(result).toBe(context);
    });
  });

  describe('markdown なしの場合', () => {
    it('markdown が undefined の場合は Obsidian に保存せずコンテキストを返す', async () => {
      const deps = makeDeps();
      const context = makeContext({ markdown: undefined });

      const result = await saveToObsidianStep(context, deps);

      expect(deps.obsidian.appendToDailyNote).not.toHaveBeenCalled();
      expect(result).toBe(context);
    });

    it('markdown が空文字の場合は Obsidian に保存せずコンテキストを返す', async () => {
      const deps = makeDeps();
      const context = makeContext({ markdown: '' });

      const result = await saveToObsidianStep(context, deps);

      expect(deps.obsidian.appendToDailyNote).not.toHaveBeenCalled();
      expect(result).toBe(context);
    });
  });

  describe('Obsidian 未設定の場合', () => {
    it('Obsidian API key が空の場合はスキップしコンテキストを返す', async () => {
      const context = makeContext({ settings: { obsidian_api_key: '' } as any });

      const result = await saveToObsidianStep(context);

      expect(result).toBe(context);
    });

    it('Obsidian API key が短すぎる場合はスキップする', async () => {
      const context = makeContext({ settings: { obsidian_api_key: 'short' } as any });

      const result = await saveToObsidianStep(context);

      expect(result).toBe(context);
    });

    it('settings に obsidian_api_key がない場合はスキップする', async () => {
      const context = makeContext({ settings: {} as any });

      const result = await saveToObsidianStep(context);

      expect(result).toBe(context);
    });

    it('deps.obsidian が注入された場合は設定チェックをスキップし保存する', async () => {
      const deps = makeDeps();
      // settings with no API key → should still save because deps.obsidian is injected
      const context = makeContext({ settings: {} as any });

      const result = await saveToObsidianStep(context, deps);

      expect(deps.obsidian.appendToDailyNote).toHaveBeenCalledWith(context.markdown, context.traceId);
      expect(result).toEqual(expect.objectContaining(context));
      expect(result).toHaveProperty('obsidianDuration');
    });
  });

  describe('保存成功時', () => {
    it('markdown が設定されていれば Obsidian に保存し、obsidianDuration 付きのコンテキストを返す', async () => {
      const deps = makeDeps();
      const context = makeContext();

      const result = await saveToObsidianStep(context, deps);

      expect(deps.obsidian.appendToDailyNote).toHaveBeenCalledWith(context.markdown, context.traceId);
      expect(result).toEqual(expect.objectContaining(context));
      expect(result).toHaveProperty('obsidianDuration');
      expect(typeof result.obsidianDuration).toBe('number');
    });
  });

  describe('保存失敗時', () => {
    it('Obsidian 保存で例外発生時はエラーを throw する', async () => {
      const deps = makeDeps();
      (deps.obsidian.appendToDailyNote as any).mockRejectedValueOnce(new Error('Connection refused'));
      const context = makeContext();

      await expect(saveToObsidianStep(context, deps)).rejects.toThrow('Connection refused');
    });
  });
});
