/**
 * checkDuplicateStep のテスト
 *
 * 検証対象:
 * - 同日重複URL検出（DuplicateError + reason='same_day'）
 * - skipDuplicateCheck フラグによる重複チェックスキップ
 * - URL セットサイズ上限超過エラー（URL_SET_LIMIT_EXCEEDED）
 * - URL セット警告閾値ログ
 * - 正常通過ケース
 * - InMemoryUrlStore を deps.urlStore に注入した場合の同挙動
 */

import { vi } from 'vitest';;

vi.mock('../../../../utils/logger.js', () => ({
  addLog: vi.fn(),
  logError: vi.fn(),
  LogType: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', DEBUG: 'DEBUG' },
  ErrorCode: { INTERNAL_ERROR: 'INT_001', UNKNOWN_ERROR: 'UNKN_001' },
}));
vi.mock('../../../../utils/storage.js', () => ({
  getSavedUrlsWithTimestamps: vi.fn(),
  MAX_URL_SET_SIZE: 10000,
  URL_WARNING_THRESHOLD: 8000,
}));

import { checkDuplicateStep, DuplicateError } from '../checkDuplicateStep.js';
import * as storage from '../../../../utils/storage.js';
import * as logger from '../../../../utils/logger.js';
import type { RecordingContext, StepDeps, UrlStore } from '../../types.js';

const mockGetSavedUrls = storage.getSavedUrlsWithTimestamps as vi.MockedFunction<typeof storage.getSavedUrlsWithTimestamps>;

/** In-memory UrlStore for tests — no chrome.storage mocking required. */
class InMemoryUrlStore implements UrlStore {
  constructor(private readonly urls = new Map<string, number>()) {}
  async getSavedUrlsWithTimestamps(): Promise<Map<string, number>> {
    return this.urls;
  }
}

function makeContext(overrides: Partial<RecordingContext> = {}): RecordingContext {
  return {
    data: {
      title: 'Test Page',
      url: 'https://example.com/page1',
      content: 'Some content',
    },
    settings: {} as any,
    force: false,
    errors: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSavedUrls.mockResolvedValue(new Map());
});

describe('checkDuplicateStep', () => {
  describe('重複検出', () => {
    it('同日に同じURLが記録済みの場合 DuplicateError(reason=same_day) を throw する', async () => {
      const now = Date.now();
      const urlMap = new Map<string, number>();
      urlMap.set('https://example.com/page1', now);

      mockGetSavedUrls.mockResolvedValue(urlMap);

      const context = makeContext();

      await expect(checkDuplicateStep(context)).rejects.toThrow(DuplicateError);

      try {
        await checkDuplicateStep(context);
      } catch (e) {
        expect(e).toBeInstanceOf(DuplicateError);
        expect((e as DuplicateError).reason).toBe('same_day');
      }
    });

    it('前日のURLは重複とみなさず通過する', async () => {
      const yesterday = new Date();
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);

      const urlMap = new Map<string, number>();
      urlMap.set('https://example.com/page1', yesterday.getTime());

      mockGetSavedUrls.mockResolvedValue(urlMap);

      const context = makeContext();
      await expect(checkDuplicateStep(context)).resolves.toBe(context);
    });

    it('skipDuplicateCheck=true の場合は同日重複でも通過する', async () => {
      const urlMap = new Map<string, number>();
      urlMap.set('https://example.com/page1', Date.now());

      mockGetSavedUrls.mockResolvedValue(urlMap);

      const context = makeContext({
        data: {
          title: 'Test',
          url: 'https://example.com/page1',
          content: 'content',
          skipDuplicateCheck: true,
        },
      });

      await expect(checkDuplicateStep(context)).resolves.toBe(context);
    });
  });

  describe('URL セットサイズ上限', () => {
    it('URL セットが MAX_URL_SET_SIZE に達している場合 URL_SET_LIMIT_EXCEEDED を throw する', async () => {
      const urlMap = new Map<string, number>();
      // MAX_URL_SET_SIZE = 10000 の URL を追加
      for (let i = 0; i < 10000; i++) {
        urlMap.set(`https://example.com/page${i}`, Date.now() - i * 1000);
      }
      mockGetSavedUrls.mockResolvedValue(urlMap);

      const context = makeContext({
        data: {
          title: 'Test',
          url: 'https://example.com/new-page',
          content: 'content',
        },
      });

      await expect(checkDuplicateStep(context)).rejects.toThrow('URL_SET_LIMIT_EXCEEDED');
    });
  });

  describe('警告閾値', () => {
    it('URL セットが警告閾値を超えた場合 WARN ログを出力する', async () => {
      const urlMap = new Map<string, number>();
      // URL_WARNING_THRESHOLD = 8000 の URL を追加
      for (let i = 0; i < 8000; i++) {
        urlMap.set(`https://example.com/page${i}`, Date.now() - i * 1000);
      }
      mockGetSavedUrls.mockResolvedValue(urlMap);

      const context = makeContext({
        data: {
          title: 'Test',
          url: 'https://example.com/new-page',
          content: 'content',
        },
      });

      await expect(checkDuplicateStep(context)).resolves.toBe(context);
      expect(logger.addLog).toHaveBeenCalledWith(
        'WARN',
        expect.stringContaining('approaching limit'),
        expect.any(Object)
      );
    });
  });

  describe('正常通過', () => {
    it('新規URLは正常に通過する', async () => {
      const context = makeContext();
      await expect(checkDuplicateStep(context)).resolves.toBe(context);
    });

    it('空のURLセットでも正常に通過する', async () => {
      mockGetSavedUrls.mockResolvedValue(new Map());
      const context = makeContext();
      await expect(checkDuplicateStep(context)).resolves.toBe(context);
    });
  });

  describe('deps.urlStore による注入 (InMemoryUrlStore)', () => {
    it('deps.urlStore が渡されると chrome.storage 経由の getSavedUrlsWithTimestamps を呼ばない', async () => {
      const urlStore = new InMemoryUrlStore(new Map([['https://example.com/page1', Date.now()]]));
      const deps = { urlStore } as StepDeps;
      const context = makeContext();

      await expect(checkDuplicateStep(context, deps)).rejects.toThrow(DuplicateError);
      expect(mockGetSavedUrls).not.toHaveBeenCalled();
    });

    it('InMemoryUrlStore 注入時も新規URLは正常に通過する', async () => {
      const urlStore = new InMemoryUrlStore();
      const deps = { urlStore } as StepDeps;
      const context = makeContext();

      await expect(checkDuplicateStep(context, deps)).resolves.toBe(context);
      expect(mockGetSavedUrls).not.toHaveBeenCalled();
    });

    it('deps が省略された場合は既存どおり getSavedUrlsWithTimestamps にフォールバックする', async () => {
      mockGetSavedUrls.mockResolvedValue(new Map());
      const context = makeContext();

      await expect(checkDuplicateStep(context)).resolves.toBe(context);
      expect(mockGetSavedUrls).toHaveBeenCalledTimes(1);
    });
  });
});
