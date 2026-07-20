/**
 * robustness-fetch-timeout.test.ts
 * Fetchタイムアウト機能のテスト
 * ブルーチーム報告 P0: fetchにタイムアウトを追加
 */

import { ObsidianClient } from '../obsidianClient.js';
import * as storage from '../../utils/storage.js';
import { addLog, LogType } from '../../utils/logger.js';

vi.mock('../../utils/storage.js');
vi.mock('../../utils/logger.js', () => ({
  addLog: vi.fn(),
  LogType: {
    DEBUG: 'DEBUG',
    INFO: 'INFO',
    WARN: 'WARN',
    ERROR: 'ERROR'
  }
}));

describe('ObsidianClient: Fetchタイムアウト（P0）', () => {
  let obsidianClient: ObsidianClient;
  let mockFetch: vi.Mock;

  beforeEach(() => {
    obsidianClient = new ObsidianClient();
    vi.clearAllMocks();

    // storageのデフォルトモック
    // @ts-expect-error - vi.fn() type narrowing issue
    storage.getSettings.mockResolvedValue({
      OBSIDIAN_API_KEY: 'test_key',
      OBSIDIAN_PROTOCOL: 'https',
      OBSIDIAN_PORT: '27123',
      OBSIDIAN_DAILY_PATH: ''
    });
    (storage as any).StorageKeys = {
      OBSIDIAN_PROTOCOL: 'OBSIDIAN_PROTOCOL',
      OBSIDIAN_PORT: 'OBSIDIAN_PORT',
      OBSIDIAN_HOST: 'OBSIDIAN_HOST',
      OBSIDIAN_API_KEY: 'OBSIDIAN_API_KEY',
      OBSIDIAN_DAILY_PATH: 'OBSIDIAN_DAILY_PATH'
    };

    // fetchのモック
    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('_fetchExistingContent - タイムアウト', () => {
    it('正常応答の場合はタイムアウトが発生しないこと', async () => {
      // @ts-expect-error - vi.fn() type narrowing issue
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

      // AbortController の signal が渡されていること
      expect(mockFetch).toHaveBeenCalledWith(
        'https://127.0.0.1:27123/vault/test.md',
        expect.objectContaining({
          method: 'GET',
          headers: expect.any(Object),
          signal: expect.any(AbortSignal)
        })
      );
    });

    it('404の場合は空文字列を返すこと', async () => {
      // @ts-expect-error - vi.fn() type narrowing issue
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

    it('AbortErrorでタイムアウトエラーをスローすること', async () => {
      // @ts-expect-error - vi.fn() type narrowing issue
      mockFetch.mockRejectedValue(new DOMException('The operation was aborted.', 'AbortError'));

      await expect(
        obsidianClient._fetchExistingContent(
          'https://127.0.0.1:27123/vault/test.md',
          { 'Authorization': 'Bearer test_key' }
        )
      ).rejects.toThrow('timed out');
    });

    it('AbortControllerのsignalがfetchに渡される', async () => {
      // @ts-expect-error - vi.fn() type narrowing issue
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('content')
      });

      await obsidianClient._fetchExistingContent(
        'https://127.0.0.1:27123/vault/test.md',
        { 'Authorization': 'Bearer test_key' }
      );

      const fetchCallArgs = mockFetch.mock.calls[0];
      expect(fetchCallArgs[1]).toHaveProperty('signal');
      expect(fetchCallArgs[1].signal).toBeInstanceOf(AbortSignal);
    });
  });

  describe('_writeContent - タイムアウト', () => {
    it('正常応答の場合はタイムアウトが発生しないこと', async () => {
      // @ts-expect-error - vi.fn() type narrowing issue
      mockFetch.mockResolvedValue({
        ok: true
      });

      await obsidianClient._writeContent(
        'https://127.0.0.1:27123/vault/test.md',
        { 'Authorization': 'Bearer test_key' },
        'Test content'
      );

      expect(mockFetch).toHaveBeenCalledTimes(1);

      // AbortController の signal が渡されていること
      expect(mockFetch).toHaveBeenCalledWith(
        'https://127.0.0.1:27123/vault/test.md',
        expect.objectContaining({
          method: 'PUT',
          headers: expect.any(Object),
          body: 'Test content',
          signal: expect.any(AbortSignal)
        })
      );
    });

    it('エラー応答の場合はエラーをスローすること', async () => {
      // @ts-expect-error - vi.fn() type narrowing issue
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

    it('AbortErrorでタイムアウトエラーをスローすること', async () => {
      // @ts-expect-error - vi.fn() type narrowing issue
      mockFetch.mockRejectedValue(new DOMException('The operation was aborted.', 'AbortError'));

      await expect(
        obsidianClient._writeContent(
          'https://127.0.0.1:27123/vault/test.md',
          { 'Authorization': 'Bearer test_key' },
          'Test content'
        )
      ).rejects.toThrow('timed out');
    });
  });

  describe('testConnection - タイムアウト', () => {
    it('正常応答の場合は成功を返すこと', async () => {
      // @ts-expect-error - vi.fn() type narrowing issue
      mockFetch.mockResolvedValue({
        ok: true
      });

      const result = await obsidianClient.testConnection();

      expect(result.success).toBe(true);
      expect(result.message).toContain('Success');
    });

    it('エラー応答の場合は失敗を返すこと', async () => {
      // @ts-expect-error - vi.fn() type narrowing issue
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error'
      });

      const result = await obsidianClient.testConnection();

      expect(result.success).toBe(false);
      expect(result.message).toContain('Connection failed');
    });

    it('タイムアウト時はタイムアウトメッセージを返すこと', async () => {
      // @ts-expect-error - vi.fn() type narrowing issue
      mockFetch.mockRejectedValue(new DOMException('The operation was aborted.', 'AbortError'));

      const result = await obsidianClient.testConnection();

      expect(result.success).toBe(false);
      expect(result.message).toContain('timeout');
    });

    it('ネットワークエラー時は適切なメッセージを返すこと', async () => {
      // @ts-expect-error - vi.fn() type narrowing issue
      mockFetch.mockRejectedValue(new Error('Failed to fetch'));

      const result = await obsidianClient.testConnection();

      expect(result.success).toBe(false);
      expect(result.message).toContain('Cannot connect');
    });
  });

  describe('ネットワークエラー処理', () => {
    it('ネットワークエラーが適切に伝播される', async () => {
      // @ts-expect-error - vi.fn() type narrowing issue
      mockFetch.mockRejectedValue(new Error('Network error'));

      await expect(
        obsidianClient._fetchExistingContent(
          'https://127.0.0.1:27123/vault/test.md',
          { 'Authorization': 'Bearer test_key' }
        )
      ).rejects.toThrow('Network error');
    });
  });
});
