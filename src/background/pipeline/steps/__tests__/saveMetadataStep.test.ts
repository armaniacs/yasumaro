/**
 * saveMetadataStep のテスト
 *
 * 検証対象:
 * - 全メタデータが一つの patch に集約され、saveSavedUrlEntryMetadata が
 *   一回だけ呼ばれる（field ごとの storage 書き込みがないこと）
 * - mergeTags: true でタグ累積挙動が維持されること
 * - legacy dual-write 無効時は chrome.storage 書き込みをスキップすること
 * - 失敗時に metadata patch が queue へ保持されること
 */

import { vi } from 'vitest';

vi.mock('../../../../utils/logger.js', () => ({
  addLog: vi.fn(),
  logError: vi.fn(),
  LogType: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', DEBUG: 'DEBUG' },
  ErrorCode: { INTERNAL_ERROR: 'INT_001', UNKNOWN_ERROR: 'UNKN_001' },
}));

vi.mock('../../../../utils/storage/savedUrlStore.js', () => ({
  saveSavedUrlEntryMetadata: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../pendingChromeStorageQueue.js', () => ({
  enqueuePendingWrite: vi.fn().mockResolvedValue(undefined),
}));

import { saveMetadataStep } from '../saveMetadataStep.js';
import * as savedUrlStore from '../../../../utils/storage/savedUrlStore.js';
import * as pendingQueue from '../../../pendingChromeStorageQueue.js';
import * as logger from '../../../../utils/logger.js';
import { StorageKeys } from '../../../../utils/storage/types.js';
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
  describe('一括metadata保存', () => {
    it('全フィールドがある場合、saveSavedUrlEntryMetadata が一回だけ呼ばれる', async () => {
      const context = makeContext({
        aiDuration: 100,
        obsidianDuration: 200,
        extractedSentencesBytes: 300,
        extractedSentencesOriginalBytes: 350,
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

      expect(savedUrlStore.saveSavedUrlEntryMetadata).toHaveBeenCalledTimes(1);
      const [url, patch, options] = (savedUrlStore.saveSavedUrlEntryMetadata as vi.Mock).mock.calls[0] as [
        string, Record<string, unknown>, Record<string, unknown>,
      ];
      expect(url).toBe('https://example.com/page');
      expect(options.mergeTags).toBe(true);
      expect(patch).toEqual(expect.objectContaining({
        recordType: 'auto',
        maskedCount: 3,
        content: 'Page content',
        tags: ['tag1'],
        aiSummary: 'AI summary',
        originalTokens: 200,
        cleansedTokens: 150,
        sentTokens: 100,
        receivedTokens: 50,
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
        aiProvider: 'openai',
        aiModel: 'gpt-4',
        privacyMode: 'full_pipeline',
        extractedSentencesBytes: 300,
        extractedSentencesOriginalBytes: 350,
        aiDuration: 100,
        obsidianDuration: 200,
      }));
    });
  });

  describe('条件分岐', () => {
    it('maskedCount=0 かつ privacyResult.maskedCount も未定義の場合は patch に含めない', async () => {
      const context = makeContext({
        data: { title: 'Test', url: 'https://example.com', content: '', maskedCount: undefined },
        privacyResult: { summary: '', maskedCount: undefined } as any,
      });

      await saveMetadataStep(context);

      const [, patch] = (savedUrlStore.saveSavedUrlEntryMetadata as vi.Mock).mock.calls[0] as [string, Record<string, unknown>];
      expect('maskedCount' in patch).toBe(false);
    });

    it('content が空の場合は patch に含めない', async () => {
      const context = makeContext({
        data: { title: 'Test', url: 'https://example.com', content: '' },
      });

      await saveMetadataStep(context);

      const [, patch] = (savedUrlStore.saveSavedUrlEntryMetadata as vi.Mock).mock.calls[0] as [string, Record<string, unknown>];
      expect('content' in patch).toBe(false);
    });

    it('tags が空配列の場合は patch に含めない', async () => {
      const context = makeContext({
        privacyResult: { summary: '', maskedCount: 0, tags: [] } as any,
      });

      await saveMetadataStep(context);

      const [, patch] = (savedUrlStore.saveSavedUrlEntryMetadata as vi.Mock).mock.calls[0] as [string, Record<string, unknown>];
      expect('tags' in patch).toBe(false);
    });

    it('privacyResult.summary がない場合は patch に含めない（aiSummary）', async () => {
      const context = makeContext({
        privacyResult: { summary: undefined, maskedCount: 0 } as any,
      });

      await saveMetadataStep(context);

      const [, patch] = (savedUrlStore.saveSavedUrlEntryMetadata as vi.Mock).mock.calls[0] as [string, Record<string, unknown>];
      expect('aiSummary' in patch).toBe(false);
    });

    it('recordType が未定義の場合は "auto" で保存する', async () => {
      const context = makeContext({
        data: { title: 'Test', url: 'https://example.com', content: '', recordType: undefined },
      });

      await saveMetadataStep(context);

      const [, patch] = (savedUrlStore.saveSavedUrlEntryMetadata as vi.Mock).mock.calls[0] as [string, Record<string, unknown>];
      expect(patch.recordType).toBe('auto');
    });
  });

  describe('legacy dual-write gate', () => {
    it('legacy_dual_write_enabled が false の場合は保存をスキップする', async () => {
      const context = makeContext({
        settings: { [StorageKeys.LEGACY_DUAL_WRITE_ENABLED]: false },
      });

      await saveMetadataStep(context);

      expect(savedUrlStore.saveSavedUrlEntryMetadata).not.toHaveBeenCalled();
      expect(pendingQueue.enqueuePendingWrite).not.toHaveBeenCalled();
    });

    it('legacy_dual_write_enabled が未設定の場合は保存を実行する', async () => {
      const context = makeContext({ settings: {} });

      await saveMetadataStep(context);

      expect(savedUrlStore.saveSavedUrlEntryMetadata).toHaveBeenCalledTimes(1);
    });
  });

  describe('失敗時の queue 保持', () => {
    it('保存失敗時に metadata patch payload が queue へ保持される', async () => {
      (savedUrlStore.saveSavedUrlEntryMetadata as vi.Mock).mockRejectedValueOnce(new Error('Storage error'));

      const context = makeContext({
        data: { title: 'Test', url: 'https://example.com', content: 'content', maskedCount: 3 },
        privacyResult: { summary: 'summary', maskedCount: 2, tags: ['t1'] } as any,
      });

      await saveMetadataStep(context);

      expect(pendingQueue.enqueuePendingWrite).toHaveBeenCalledTimes(1);
      const payload = (pendingQueue.enqueuePendingWrite as vi.Mock).mock.calls[0][0] as Record<string, unknown>;
      expect(payload.type).toBe('metadataPatch');
      expect(payload.key).toBe('savedUrlsWithTimestamps');
      expect(payload.url).toBe('https://example.com');
      expect(payload.refreshTimestamp).toBe(false);
      expect(payload.timestamp).toEqual(expect.any(Number));
      expect(payload.mergeTags).toBe(true);
      expect(payload.patch).toEqual(expect.objectContaining({
        recordType: 'auto',
        maskedCount: 3,
        content: 'content',
        tags: ['t1'],
        aiSummary: 'summary',
        fallbackTriggered: false,
      }));
    });

    it('失敗時に WARN ログが出力される', async () => {
      (savedUrlStore.saveSavedUrlEntryMetadata as vi.Mock).mockRejectedValueOnce(new Error('Storage error'));

      const context = makeContext({
        data: { title: 'Test', url: 'https://example.com', content: 'content', maskedCount: 3 },
        privacyResult: { summary: '', maskedCount: 2 } as any,
      });

      await saveMetadataStep(context);

      const warnCalls = (logger.addLog as vi.Mock).mock.calls.filter(
        (call: unknown[]) => typeof call[1] === 'string' && (call[1] as string).includes('Failed to save')
      );
      expect(warnCalls.length).toBeGreaterThan(0);
    });

    it('全て成功した場合は WARN ログが出力されない', async () => {
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
});
