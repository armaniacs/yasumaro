/**
 * saveMetadataStep のテスト
 *
 * 検証対象:
 * - 全メタデータが正しく保存される
 * - best-effort パターン: 一部失敗しても他は保存される
 * - 失敗時に WARN ログが出力される
 * - 条件分岐（maskedCount > 0, content あり, tags あり, etc.）
 * - 全 setter が呼ばれるケース
 */

import { jest } from '@jest/globals';

jest.mock('../../../../utils/logger.js', () => ({
  addLog: jest.fn(),
  logError: jest.fn(),
  LogType: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', DEBUG: 'DEBUG' },
  ErrorCode: { INTERNAL_ERROR: 'INT_001', UNKNOWN_ERROR: 'UNKN_001' },
}));
jest.mock('../../../../utils/storageUrls.js', () => ({
  setSavedUrlsWithTimestamps: jest.fn().mockResolvedValue(undefined),
  setUrlRecordType: jest.fn().mockResolvedValue(undefined),
  setUrlMaskedCount: jest.fn().mockResolvedValue(undefined),
  setUrlTags: jest.fn().mockResolvedValue(undefined),
  setUrlContent: jest.fn().mockResolvedValue(undefined),
  setUrlAiSummary: jest.fn().mockResolvedValue(undefined),
  setUrlSentTokens: jest.fn().mockResolvedValue(undefined),
  setUrlReceivedTokens: jest.fn().mockResolvedValue(undefined),
  setUrlOriginalTokens: jest.fn().mockResolvedValue(undefined),
  setUrlCleansedTokens: jest.fn().mockResolvedValue(undefined),
  setUrlPageBytes: jest.fn().mockResolvedValue(undefined),
  setUrlCandidateBytes: jest.fn().mockResolvedValue(undefined),
  setUrlOriginalBytes: jest.fn().mockResolvedValue(undefined),
  setUrlCleansedBytes: jest.fn().mockResolvedValue(undefined),
  setUrlAiSummaryOriginalBytes: jest.fn().mockResolvedValue(undefined),
  setUrlAiSummaryCleansedBytes: jest.fn().mockResolvedValue(undefined),
  setUrlAiSummaryCleansedElements: jest.fn().mockResolvedValue(undefined),
  setUrlAiSummaryCleansedReason: jest.fn().mockResolvedValue(undefined),
  getSavedUrlsWithTimestamps: jest.fn().mockResolvedValue(new Map()),
}));

import { saveMetadataStep } from '../saveMetadataStep.js';
import * as storageUrls from '../../../../utils/storageUrls.js';
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
  jest.clearAllMocks();
});

describe('saveMetadataStep', () => {
  describe('全メタデータ保存', () => {
    it('全フィールドがある場合、全 setter が呼ばれる', async () => {
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
        },
        privacyResult: {
          summary: 'AI summary',
          maskedCount: 2,
          tags: ['tag1'],
          sentTokens: 100,
          receivedTokens: 50,
          originalTokens: 200,
          cleansedTokens: 150,
        } as any,
      });

      await saveMetadataStep(context);

      expect(storageUrls.setSavedUrlsWithTimestamps).toHaveBeenCalled();
      expect(storageUrls.setUrlRecordType).toHaveBeenCalledWith('https://example.com/page', 'auto');
      expect(storageUrls.setUrlMaskedCount).toHaveBeenCalledWith('https://example.com/page', 3);
      expect(storageUrls.setUrlContent).toHaveBeenCalledWith('https://example.com/page', 'Page content');
      expect(storageUrls.setUrlTags).toHaveBeenCalledWith('https://example.com/page', ['tag1']);
      expect(storageUrls.setUrlAiSummary).toHaveBeenCalledWith('https://example.com/page', 'AI summary');
      expect(storageUrls.setUrlSentTokens).toHaveBeenCalledWith('https://example.com/page', 100);
      expect(storageUrls.setUrlReceivedTokens).toHaveBeenCalledWith('https://example.com/page', 50);
      expect(storageUrls.setUrlOriginalTokens).toHaveBeenCalledWith('https://example.com/page', 200);
      expect(storageUrls.setUrlCleansedTokens).toHaveBeenCalledWith('https://example.com/page', 150);
      expect(storageUrls.setUrlPageBytes).toHaveBeenCalledWith('https://example.com/page', 1000);
      expect(storageUrls.setUrlCandidateBytes).toHaveBeenCalledWith('https://example.com/page', 800);
      expect(storageUrls.setUrlOriginalBytes).toHaveBeenCalledWith('https://example.com/page', 1200);
      expect(storageUrls.setUrlCleansedBytes).toHaveBeenCalledWith('https://example.com/page', 900);
      expect(storageUrls.setUrlAiSummaryOriginalBytes).toHaveBeenCalledWith('https://example.com/page', 500);
      expect(storageUrls.setUrlAiSummaryCleansedBytes).toHaveBeenCalledWith('https://example.com/page', 400);
      expect(storageUrls.setUrlAiSummaryCleansedElements).toHaveBeenCalledWith('https://example.com/page', 5);
      expect(storageUrls.setUrlAiSummaryCleansedReason).toHaveBeenCalledWith('https://example.com/page', 'hard');
    });
  });

  describe('条件分岐', () => {
    it('maskedCount=0 かつ privacyResult.maskedCount も未定義の場合は setUrlMaskedCount を呼ばない', async () => {
      const context = makeContext({
        data: { title: 'Test', url: 'https://example.com', content: '', maskedCount: undefined },
        privacyResult: { summary: '', maskedCount: undefined } as any,
      });

      await saveMetadataStep(context);

      expect(storageUrls.setUrlMaskedCount).not.toHaveBeenCalled();
    });

    it('content が空の場合は setUrlContent を呼ばない', async () => {
      const context = makeContext({
        data: { title: 'Test', url: 'https://example.com', content: '' },
      });

      await saveMetadataStep(context);

      expect(storageUrls.setUrlContent).not.toHaveBeenCalled();
    });

    it('tags が空配列の場合は setUrlTags を呼ばない', async () => {
      const context = makeContext({
        privacyResult: { summary: '', maskedCount: 0, tags: [] } as any,
      });

      await saveMetadataStep(context);

      expect(storageUrls.setUrlTags).not.toHaveBeenCalled();
    });

    it('privacyResult.summary がない場合は setUrlAiSummary を呼ばない', async () => {
      const context = makeContext({
        privacyResult: { summary: undefined, maskedCount: 0 } as any,
      });

      await saveMetadataStep(context);

      expect(storageUrls.setUrlAiSummary).not.toHaveBeenCalled();
    });

    it('sentTokens が undefined の場合は setUrlSentTokens を呼ばない', async () => {
      const context = makeContext({
        privacyResult: { summary: '', maskedCount: 0, sentTokens: undefined } as any,
      });

      await saveMetadataStep(context);

      expect(storageUrls.setUrlSentTokens).not.toHaveBeenCalled();
    });
  });

  describe('best-effort パターン', () => {
    it('一部 setter が失敗しても他は保存される', async () => {
      // setUrlMaskedCount を失敗させる
      (storageUrls.setUrlMaskedCount as jest.Mock).mockRejectedValueOnce(new Error('Storage error'));

      const context = makeContext({
        data: { title: 'Test', url: 'https://example.com', content: 'content', maskedCount: 3 },
        privacyResult: { summary: 'summary', maskedCount: 2, tags: ['t1'] } as any,
      });

      // throw しない
      await expect(saveMetadataStep(context)).resolves.toBe(context);

      // 他は正常に呼ばれる
      expect(storageUrls.setUrlContent).toHaveBeenCalled();
      expect(storageUrls.setUrlTags).toHaveBeenCalled();
      expect(storageUrls.setUrlAiSummary).toHaveBeenCalled();
    });

    it('失敗した場合 WARN ログが出力される', async () => {
      (storageUrls.setUrlMaskedCount as jest.Mock).mockRejectedValueOnce(new Error('Storage error'));

      const context = makeContext({
        data: { title: 'Test', url: 'https://example.com', content: 'content', maskedCount: 3 },
        privacyResult: { summary: '', maskedCount: 2 } as any,
      });

      await saveMetadataStep(context);

      // WARN ログで「Some metadata failed to save」が出力される
      const warnCalls = (logger.addLog as jest.Mock).mock.calls.filter(
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

      const failCalls = (logger.addLog as jest.Mock).mock.calls.filter(
        (call: unknown[]) => typeof call[1] === 'string' && (call[1] as string).includes('Failed to save')
      );
      expect(failCalls.length).toBe(0);
    });
  });

  describe('recordType デフォルト', () => {
    it('recordType が未定義の場合は "auto" が使われる', async () => {
      const context = makeContext({
        data: { title: 'Test', url: 'https://example.com', content: '', recordType: undefined },
      });

      await saveMetadataStep(context);

      expect(storageUrls.setUrlRecordType).toHaveBeenCalledWith('https://example.com', 'auto');
    });
  });
});
