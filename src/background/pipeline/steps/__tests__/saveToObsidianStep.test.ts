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
import { StorageKeys } from '../../../../utils/storage/types.js';

type ExplicitUndefined<T> = { [K in keyof T]?: T[K] | undefined };

function makeContext(overrides: ExplicitUndefined<RecordingContext> = {}): RecordingContext {
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
  } as RecordingContext;
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
    it('calls appendToDailyNote on the injected obsidian client', async () => {
      const deps = makeDeps();
      const context = makeContext();

      await saveToObsidianStep(context, deps);

      expect(deps.obsidian.appendToDailyNote).toHaveBeenCalledWith(context.markdown, context.traceId);
    });

    it('skips when deps is omitted (obsidian is undefined)', async () => {
      const context = makeContext();

      const result = await saveToObsidianStep(context);

      // No deps, no API key check passes → should skip
      expect(result).toBe(context);
    });
  });

  describe('markdown なしの場合', () => {
    it('returns the context without saving to Obsidian when markdown is undefined', async () => {
      const deps = makeDeps();
      const context = makeContext({ markdown: undefined });

      const result = await saveToObsidianStep(context, deps);

      expect(deps.obsidian.appendToDailyNote).not.toHaveBeenCalled();
      expect(result).toBe(context);
    });

    it('returns the context without saving to Obsidian when markdown is empty', async () => {
      const deps = makeDeps();
      const context = makeContext({ markdown: '' });

      const result = await saveToObsidianStep(context, deps);

      expect(deps.obsidian.appendToDailyNote).not.toHaveBeenCalled();
      expect(result).toBe(context);
    });
  });

  describe('Obsidian 未設定の場合', () => {
    it('skips and returns the context when the Obsidian API key is empty', async () => {
      const context = makeContext({ settings: { obsidian_api_key: '' } as any });

      const result = await saveToObsidianStep(context);

      expect(result).toBe(context);
    });

    it('skips when the Obsidian API key is too short', async () => {
      const context = makeContext({ settings: { obsidian_api_key: 'short' } as any });

      const result = await saveToObsidianStep(context);

      expect(result).toBe(context);
    });

    it('skips when settings lacks obsidian_api_key', async () => {
      const context = makeContext({ settings: {} as any });

      const result = await saveToObsidianStep(context);

      expect(result).toBe(context);
    });

    it('skips the settings check and saves when deps.obsidian is injected', async () => {
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
    it('saves to Obsidian and returns the context with obsidianDuration when markdown is set', async () => {
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
    it('throws when saving to Obsidian raises an exception', async () => {
      const deps = makeDeps();
      (deps.obsidian.appendToDailyNote as any).mockRejectedValueOnce(new Error('Connection refused'));
      const context = makeContext();

      await expect(saveToObsidianStep(context, deps)).rejects.toThrow('Connection refused');
    });
  });
});
