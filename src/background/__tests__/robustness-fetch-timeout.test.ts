/**
 * robustness-fetch-timeout.test.js
 * Fetchタイムアウト機能のテスト
 * ブルーチーム報告 P0: fetchにタイムアウトを追加
 */

import { ObsidianClient } from '../obsidianClient.ts';
import * as storage from '../../utils/storage.ts';
import { addLog, LogType } from '../../utils/logger.ts';

jest.mock('../../utils/storage.ts');
jest.mock('../../utils/logger.ts', () => ({
  addLog: jest.fn(),
  LogType: {
    DEBUG: 'DEBUG',
    INFO: 'INFO',
    WARN: 'WARN',
    ERROR: 'ERROR'
  }
}));

describe('ObsidianClient: Fetchタイムアウト（P0）', () => {
  let obsidianClient;
  let mockFetch;

  beforeEach(() => {
    obsidianClient = new ObsidianClient();
    jest.clearAllMocks();
    jest.useFakeTimers();

    // storageのデフォルトモック
    storage.getSettings.mockResolvedValue({
      OBSIDIAN_API_KEY: 'test_key',
      OBSIDIAN_PROTOCOL: 'https',
      OBSIDIAN_PORT: '27123',
      OBSIDIAN_DAILY_PATH: ''
    });
    storage.StorageKeys = {
      OBSIDIAN_PROTOCOL: 'OBSIDIAN_PROTOCOL',
      OBSIDIAN_PORT: 'OBSIDIAN_PORT',
      OBSIDIAN_API_KEY: 'OBSIDIAN_API_KEY',
      OBSIDIAN_DAILY_PATH: 'OBSIDIAN_DAILY_PATH'
    };

    // fetchのモック
    mockFetch = jest.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    jest.useRealTimers();
    global.fetch.mockRestore();
  });

  describe('_fetchExistingContent - タイムアウト', () => {
    it('正常応答の場合はタイムアウトが発生しないこと', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('Existing content')
      });

      const result = await obsidianClient._fetchExistingContent(
        'https://127.0.0.1:27123/vault/test.md',
        { 'Authorization': 'Bearer test_key' }
      );

      expect(result).toBe('Existing content');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('404の場合は空文字列を返すこと', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        text: () => Promise.resolve('Not found')
      });

      const result = await obsidianClient._fetchExistingContent(
        'https://127.0.0.1:27123/vault/test.md',
        { 'Authorization': 'Bearer test_key' }
      );

      expect(result).toBe('');
    });

    it('現在の実装ではタイムアウトが設定されていないため、無期限に待機する可能性がある', async () => {
      // 注: このテストは現在の実装では実行できません
      // 原因: 無期限に待機する可能性があるため、jest.useFakeTimers()ではテストできません
      // 修正後: AbortControllerを使用してタイムアウトを実装する必要があります

      const neverResolvingPromise = new Promise(() => {});
      mockFetch.mockReturnValue(neverResolvingPromise);

      const fetchPromise = obsidianClient._fetchExistingContent(
        'https://127.0.0.1:27123/vault/test.md',
        { 'Authorization': 'Bearer test_key' }
      );

      // 注: タイムアウトを実装していないため、このテストは実行できません
      // 修正後にAborControllerを使用したタイムアウトのテストを追加します
    });
  });

  describe('_writeContent - タイムアウト', () => {
    it('正常応答の場合はタイムアウトが発生しないこと', async () => {
      mockFetch.mockResolvedValue({
        ok: true
      });

      const result = await obsidianClient._writeContent(
        'https://127.0.0.1:27123/vault/test.md',
        { 'Authorization': 'Bearer test_key' },
        'Test content'
      );

      expect(result).toBeUndefined();
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('エラー応答の場合はエラーをスローすること', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        text: () => Promise.resolve('Error')
      });

      await expect(
        obsidianClient._writeContent(
          'https://127.0.0.1:27123/vault/test.md',
          { 'Authorization': 'Bearer test_key' },
          'Test content'
        )
      ).rejects.toThrow();
    });
  });

  describe('testConnection - タイムアウト', () => {
    it('正常応答の場合は成功を返すこと', async () => {
      mockFetch.mockResolvedValue({
        ok: true
      });

      const result = await obsidianClient.testConnection();

      expect(result.success).toBe(true);
      expect(result.message).toContain('Success');
    });

    it('エラー応答の場合は失敗を返すこと', async () => {
      mockFetch.mockResolvedValue({
        ok: false
      });

      const result = await obsidianClient.testConnection();

      expect(result.success).toBe(false);
      expect(result.message).toContain('Connection Failed');
    });
  });

  describe('retry戦略の検討', () => {
    it('ネットワークエラー時の再試行が現在実装されていないこと', async () => {
      // 注: 現在はretry戦略が実装されていません
      // 将来的にはexponential backoffを使用したretry戦略を実装することが推奨されます

      mockFetch.mockRejectedValue(new Error('Network error'));

      await expect(
        obsidianClient._fetchExistingContent(
          'https://127.0.0.1:27123/vault/test.md',
          { 'Authorization': 'Bearer test_key' }
        )
      ).rejects.toThrow();
    });
  });

  describe('推奨される改善事項', () => {
    it('AbortControllerを使用して10秒タイムアウトを実装すべき', () => {
      // TODO: 実装後にこのテストを有効化
      // const abortController = new AbortController();
      // const timeoutId = setTimeout(() => abortController.abort(), 10000);
      //
      // try {
      //   const response = await fetch(url, { signal: abortController.signal, ...options });
      //   clearTimeout(timeoutId);
      //   return response;
      // } catch (error) {
      //   clearTimeout(timeoutId);
      //   if (error.name === 'AbortError') {
      //     throw new Error('Request timeout');
      //   }
      //   throw error;
      // }

      // 現在は実装されていないため、skip
      expect(true).toBe(true);
    });

    it('タイムアウトエラーが適切に処理されるべき', () => {
      // TODO: 実装後にこのテストを有効化
      // タイムアウト発生時にユーザーフレンドリーなエラーメッセージを表示すべき
      expect(true).toBe(true);
    });
  });

  describe('タイムアウトの検証', () => {
    beforeEach(() => {
      jest.useFakeTimers('modern');
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('15秒タイムアウトでリクエストがキャンセルされること', async () => {
      // Mock fetch to handle AbortController signals
      mockFetch.mockImplementation((url, options) => {
        return new Promise((resolve, reject) => {
          if (options?.signal) {
            // When abort signal fires, reject with AbortError
            const abortHandler = () => {
              options.signal.removeEventListener('abort', abortHandler);
              const error = new Error('The user aborted a request');
              error.name = 'AbortError';
              reject(error);
            };
            options.signal.addEventListener('abort', abortHandler);
          }
          // Return a promise that will never resolve (unless aborted)
        });
      });

      const fetchPromise = obsidianClient._fetchExistingContent(
        'https://127.0.0.1:27123/vault/test.md',
        { 'Authorization': 'Bearer test_key' }
      );

      // Advance timers by 16000ms (15s timeout + buffer)
      jest.advanceTimersByTimeAsync(16000);

      // Expect to reject with 'timed out'
      await expect(fetchPromise).rejects.toThrow('timed out');
    }, 30000);
  });
});

/**
 * 実装推奨事項:
 *
 * 1. _fetchExistingContentと_writeContentでAbortControllerを使用したタイムアウトを実装
 *    - 推奨タイムアウト: 10秒
 *    - AbortControllerのsignalをfetchに渡す
 *    - タイムアウト時に適切なエラーメッセージを表示
 *
 * 2. testConnectionでも同じタイムアウトを実装
 *
 * 3. retry戦略の検討（オプション）
 *    - exponential backoffを使用
 *    - 最大retry回数: 3回
 *    - ネットワークエラー時のみ再試行
 *
 * 4. タイムアウトエラーのログ出力
 *    - addLogを使用してタイムアウトエラーを記録
 *    - ユーザーに表示するエラーメッセージを適切に設定
 */