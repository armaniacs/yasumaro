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
import type { MockedFunction } from 'vitest';

vi.mock('../../../../utils/logger.js', () => ({
  addLog: vi.fn(),
  logError: vi.fn(),
  LogType: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', DEBUG: 'DEBUG' },
  ErrorCode: { INTERNAL_ERROR: 'INT_001', UNKNOWN_ERROR: 'UNKN_001' },
}));
vi.mock('../../../../utils/storage/savedUrlRepository.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    getSavedUrlsWithTimestamps: vi.fn(),
    MAX_URL_SET_SIZE: 10000,
    URL_WARNING_THRESHOLD: 8000,

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;

import { checkDuplicateStep, DuplicateError } from '../checkDuplicateStep.js';
import * as storage from '../../../../utils/storage/types.js';
import * as storageSavedUrls from '../../../../utils/storage/savedUrlRepository.js';
import * as logger from '../../../../utils/logger.js';
import type { RecordingContext, StepDeps, UrlStore } from '../../types.js';

const mockGetSavedUrls = storageSavedUrls.getSavedUrlsWithTimestamps as MockedFunction<typeof storageSavedUrls.getSavedUrlsWithTimestamps>;

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
    it('throws DuplicateError(reason=same_day) when the same URL was already recorded today', async () => {
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

    it('passes URLs from the previous day without treating them as duplicates', async () => {
      const yesterday = new Date();
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);

      const urlMap = new Map<string, number>();
      urlMap.set('https://example.com/page1', yesterday.getTime());

      mockGetSavedUrls.mockResolvedValue(urlMap);

      const context = makeContext();
      await expect(checkDuplicateStep(context)).resolves.toBe(context);
    });

    it('passes same-day duplicates when skipDuplicateCheck=true', async () => {
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
    it('throws URL_SET_LIMIT_EXCEEDED when the URL set reaches MAX_URL_SET_SIZE', async () => {
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
    it('logs a WARN when the URL set exceeds the warning threshold', async () => {
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
    it('passes new URLs normally', async () => {
      const context = makeContext();
      await expect(checkDuplicateStep(context)).resolves.toBe(context);
    });

    it('passes normally with an empty URL set', async () => {
      mockGetSavedUrls.mockResolvedValue(new Map());
      const context = makeContext();
      await expect(checkDuplicateStep(context)).resolves.toBe(context);
    });
  });

  describe('deps.urlStore による注入 (InMemoryUrlStore)', () => {
    it('does not call getSavedUrlsWithTimestamps via chrome.storage when deps.urlStore is provided', async () => {
      const urlStore = new InMemoryUrlStore(new Map([['https://example.com/page1', Date.now()]]));
      const deps = { urlStore } as unknown as StepDeps;
      const context = makeContext();

      await expect(checkDuplicateStep(context, deps)).rejects.toThrow(DuplicateError);
      expect(mockGetSavedUrls).not.toHaveBeenCalled();
    });

    it('passes new URLs normally when InMemoryUrlStore is injected', async () => {
      const urlStore = new InMemoryUrlStore();
      const deps = { urlStore } as unknown as StepDeps;
      const context = makeContext();

      await expect(checkDuplicateStep(context, deps)).resolves.toBe(context);
      expect(mockGetSavedUrls).not.toHaveBeenCalled();
    });

    it('falls back to getSavedUrlsWithTimestamps when deps is omitted', async () => {
      mockGetSavedUrls.mockResolvedValue(new Map());
      const context = makeContext();

      await expect(checkDuplicateStep(context)).resolves.toBe(context);
      expect(mockGetSavedUrls).toHaveBeenCalledTimes(1);
    });
  });
});
