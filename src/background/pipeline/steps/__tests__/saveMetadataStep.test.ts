/**
 * saveMetadataStep のテスト
 *
 * 検証対象:
 * - 全メタデータが正しく保存される
 * - best-effort パターン: 一部失敗しても他は保存される
 * - 失敗時に WARN ログが出力される
 * - 条件分岐（maskedCount > 0, content あり, tags あり, etc.）
 * - 全フィールドが保存されるケース
 */

import { vi } from 'vitest';

vi.mock('../../../../utils/logger.js', () => ({
  addLog: vi.fn(),
  logError: vi.fn(),
  LogType: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', DEBUG: 'DEBUG' },
  ErrorCode: { INTERNAL_ERROR: 'INT_001', UNKNOWN_ERROR: 'UNKN_001' },
}));

// Mock savedUrlStore instead of storageUrls since saveMetadataStep now imports from savedUrlStore
vi.mock('../../../../utils/storage/savedUrlStore.js', () => ({
  updateSavedUrlEntry: vi.fn().mockResolvedValue(undefined),
  addUrlTag: vi.fn().mockResolvedValue(undefined),
}));

import { saveMetadataStep } from '../saveMetadataStep.js';
import * as savedUrlStore from '../../../../utils/storage/savedUrlStore.js';
import * as logger from '../../../../utils/logger.js';
import type { RecordingContext } from '../../types.js';

function makeContext(overrides: Partial<RecordingContext> = {}): RecordingContext {
  return {
    data: {
      title: 'Test Page',
      url: 'https://example.com/page',
      content: 'Page content here',
      recordType: 'auto',
      maskedCount: 3,
    },
    settings: {} as any,
    force: false,
    errors: [],
    privacyResult: {
      summary: 'AI summary',
      maskedCount: 2,
      tags: ['tag1', 'tag2'],
      sentTokens: 100,
      receivedTokens: 50,
      originalTokens: 200,
      cleansedTokens: 150,
    } as any,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('saveMetadataStep', () => {
  describe('全メタデータ保存', () => {
    it('全フィールドがある場合、updateSavedUrlEntry が各フィールドで呼ばれる', async () => {
      const context = makeContext({
        data: {
          title: 'Test',
          url: 'https://example.com/page',
          content: 'Page content',
          recordType: 'auto',
          maskedCount: 3,
          pageBytes: 1000,
          candidateBytes: 800,
          originalBytes: 1200,
          cleansedBytes: 900,
          aiSummaryOriginalBytes: 500,
          aiSummaryCleansedBytes: 400,
          aiSummaryCleansedElements: 5,
          aiSummaryCleansedReason: 'hard',
          aiSummaryCleansedReasons: ['reason1'],
          fallbackTriggered: true,
          extractedSentencesBytes: 300,
          extractedSentencesOriginalBytes: 350,
          aiDuration: 100,
          obsidianDuration: 200,
        },
        privacyResult: {
          summary: 'AI summary',
          maskedCount: 2,
          tags: ['tag1'],
          providerName: 'openai',
          modelName: 'gpt-4',
          mode: 'full_pipeline',
          sentTokens: 100,
          receivedTokens: 50,
          originalTokens: 200,
          cleansedTokens: 150,
        } as any,
      });

      await saveMetadataStep(context);

      // Verify updateSavedUrlEntry was called for each field
      const calls = (savedUrlStore.updateSavedUrlEntry as vi.Mock).mock.calls;
      const urls = calls.map((c: unknown[]) => c[0]);
      expect(urls).toEqual(expect.arrayContaining([
        'https://example.com/page',
        'https://example.com/page',
        'https://example.com/page',
      ]));

      // Verify tag functions were called
      expect(savedUrlStore.addUrlTag).toHaveBeenCalledWith('https://example.com/page', 'tag1');
    });
  });

  describe('条件分岐', () => {
    it('maskedCount=0 かつ privacyResult.maskedCount も未定義の場合は updateSavedUrlEntry を呼ばない（maskedCount）', async () => {
      const context = makeContext({
        data: { title: 'Test', url: 'https://example.com', content: '', maskedCount: undefined },
        privacyResult: { summary: '', maskedCount: undefined } as any,
      });

      await saveMetadataStep(context);

      // Verify no call was made with maskedCount field
      const calls = (savedUrlStore.updateSavedUrlEntry as vi.Mock).mock.calls;
      const maskedCalls = calls.filter((c: unknown[]) => {
        const updater = c[1] as (entry: any) => any;
        const result = updater({ url: 'test', timestamp: 0 });
        return 'maskedCount' in result;
      });
      expect(maskedCalls.length).toBe(0);
    });

    it('content が空の場合は updateSavedUrlEntry を呼ばない（content）', async () => {
      const context = makeContext({
        data: { title: 'Test', url: 'https://example.com', content: '' },
      });

      await saveMetadataStep(context);

      const calls = (savedUrlStore.updateSavedUrlEntry as vi.Mock).mock.calls;
      const contentCalls = calls.filter((c: unknown[]) => {
        const updater = c[1] as (entry: any) => any;
        const result = updater({ url: 'test', timestamp: 0 });
        return 'content' in result;
      });
      expect(contentCalls.length).toBe(0);
    });

    it('tags が空配列の場合は addUrlTag を呼ばない', async () => {
      const context = makeContext({
        privacyResult: { summary: '', maskedCount: 0, tags: [] } as any,
      });

      await saveMetadataStep(context);

      expect(savedUrlStore.addUrlTag).not.toHaveBeenCalled();
    });

    it('privacyResult.summary がない場合は updateSavedUrlEntry を呼ばない（aiSummary）', async () => {
      const context = makeContext({
        privacyResult: { summary: undefined, maskedCount: 0 } as any,
      });

      await saveMetadataStep(context);

      const calls = (savedUrlStore.updateSavedUrlEntry as vi.Mock).mock.calls;
      const summaryCalls = calls.filter((c: unknown[]) => {
        const updater = c[1] as (entry: any) => any;
        const result = updater({ url: 'test', timestamp: 0 });
        return 'aiSummary' in result;
      });
      expect(summaryCalls.length).toBe(0);
    });
  });

  describe('best-effort パターン', () => {
    it('一部 updateSavedUrlEntry が失敗しても他は保存される', async () => {
      // Make the first updateSavedUrlEntry call fail
      (savedUrlStore.updateSavedUrlEntry as vi.Mock).mockRejectedValueOnce(new Error('Storage error'));

      const context = makeContext({
        data: { title: 'Test', url: 'https://example.com', content: 'content', maskedCount: 3 },
        privacyResult: { summary: 'summary', maskedCount: 2, tags: ['t1'] } as any,
      });

      // Should not throw
      await expect(saveMetadataStep(context)).resolves.toBe(context);

      // Other calls should still have been made
      expect(savedUrlStore.updateSavedUrlEntry).toHaveBeenCalled();
      expect(savedUrlStore.addUrlTag).toHaveBeenCalled();
    });

    it('失敗した場合 WARN ログが出力される', async () => {
      (savedUrlStore.updateSavedUrlEntry as vi.Mock).mockRejectedValueOnce(new Error('Storage error'));

      const context = makeContext({
        data: { title: 'Test', url: 'https://example.com', content: 'content', maskedCount: 3 },
        privacyResult: { summary: '', maskedCount: 2 } as any,
      });

      await saveMetadataStep(context);

      // WARN ログで「Some metadata failed to save」が出力される
      const warnCalls = (logger.addLog as vi.Mock).mock.calls.filter(
        (call: unknown[]) => typeof call[1] === 'string' && (call[1] as string).includes('Failed to save')
      );
      expect(warnCalls.length).toBeGreaterThan(0);
    });

    it('全て成功した場合は失敗ログが出力されない', async () => {
      const context = makeContext({
        data: { title: 'Test', url: 'https://example.com', content: '', maskedCount: undefined },
        privacyResult: undefined,
      });

      await saveMetadataStep(context);

      const failCalls = (logger.addLog as vi.Mock).mock.calls.filter(
        (call: unknown[]) => typeof call[1] === 'string' && (call[1] as string).includes('Failed to save')
      );
      expect(failCalls.length).toBe(0);
    });
  });

  describe('recordType デフォルト', () => {
    it('recordType が未定義の場合は "auto" で updateSavedUrlEntry が呼ばれる', async () => {
      const context = makeContext({
        data: { title: 'Test', url: 'https://example.com', content: '', recordType: undefined },
      });

      await saveMetadataStep(context);

      // Verify updateSavedUrlEntry was called with a closure that sets recordType to 'auto'
      const calls = (savedUrlStore.updateSavedUrlEntry as vi.Mock).mock.calls;
      const recordTypeCall = calls.find((c: unknown[]) => {
        const updater = c[1] as (entry: any) => any;
        const result = updater({ url: 'https://example.com', timestamp: 0 });
        return result.recordType === 'auto';
      });
      expect(recordTypeCall).toBeDefined();
    });
  });
});
