/**
 * obsidianClient-body-timeout.test.ts
 * レスポンスボディ読み込み（response.text()）のタイムアウトテスト
 * PBI-11: ヘッダのみ受信後にボディが送られてこないケースでもハングしない
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

describe('ObsidianClient: レスポンスボディ読み込みタイムアウト', () => {
  let client: ObsidianClient;
  let mockFetch: vi.Mock;

  beforeEach(() => {
    client = new ObsidianClient();
    vi.clearAllMocks();

    // @ts-expect-error - vi.fn() type narrowing issue
    storage.getSettings.mockResolvedValue({
      OBSIDIAN_API_KEY: 'test_key',
      OBSIDIAN_PROTOCOL: 'http',
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

    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('_fetchExistingContent - ボディ読み込みタイムアウト', () => {
    it('ボディが返ってこない場合にタイムアウトエラーをスローすること', async () => {
      vi.useFakeTimers();
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => new Promise(() => {}) // ボディが永遠に返らない
      });

      const promise = client._fetchExistingContent(
        'http://127.0.0.1:27123/vault/test.md',
        { 'Authorization': 'Bearer test_key' }
      );
      // アサーションのハンドラが付くまでの間、unhandled rejectionにしない
      promise.catch(() => {});

      // FETCH_TIMEOUT_MS（15000ms）を超えて進める
      await vi.advanceTimersByTimeAsync(15001);

      await expect(promise).rejects.toThrow('timed out');
      vi.useRealTimers();
    });

    it('タイムアウトエラーのnameがAbortErrorであること（_handleErrorで検出可能）', async () => {
      vi.useFakeTimers();
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => new Promise(() => {})
      });

      const promise = client._fetchExistingContent(
        'http://127.0.0.1:27123/vault/test.md',
        { 'Authorization': 'Bearer test_key' }
      );
      promise.catch(() => {});

      await vi.advanceTimersByTimeAsync(15001);

      const err = await promise.catch((e: Error) => e);
      expect(err.name).toBe('AbortError');
      vi.useRealTimers();
    });
  });

  describe('appendToDailyNote - タイムアウト時のMutex解放', () => {
    it('ボディ読み込みタイムアウト後もMutexが解放されること', async () => {
      vi.useFakeTimers();
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => new Promise(() => {})
      });

      const mutex = client._globalWriteMutex;
      const promise = client.appendToDailyNote('Test content');
      promise.catch(() => {});

      // Mutexが取得済みであることを確認
      expect(mutex.isLocked()).toBe(true);

      await vi.advanceTimersByTimeAsync(15001);

      await expect(promise).rejects.toThrow('timed out');
      expect(mutex.isLocked()).toBe(false);
      vi.useRealTimers();
    });
  });

  describe('ボディが正常に読み込める場合', () => {
    it('タイムアウトが発生せずコンテンツを返すこと', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('Existing content')
      });

      const result = await client._fetchExistingContent(
        'http://127.0.0.1:27123/vault/test.md',
        { 'Authorization': 'Bearer test_key' }
      );

      expect(result).toBe('Existing content');
    });
  });

  describe('_handleError - タイムアウト時のログ出力', () => {
    it('AbortError時はWARNログを出力してタイムアウトエラーを返すこと', () => {
      const err = new Error('The operation was aborted.');
      err.name = 'AbortError';

      const result = client._handleError(err, 'https://127.0.0.1:27123/');

      expect(result.message).toContain('timed out');
      expect(addLog).toHaveBeenCalledWith(
        LogType.WARN,
        expect.stringContaining('timed out'),
        expect.objectContaining({ error: 'The operation was aborted.' })
      );
    });

    it('timed out を含むエラーメッセージでもWARNログを出力すること', () => {
      const result = client._handleError(
        new Error('Body read timed out after 15000ms'),
        'https://127.0.0.1:27123/'
      );

      expect(result.message).toContain('timed out');
      expect(addLog).toHaveBeenCalledWith(
        LogType.WARN,
        expect.stringContaining('timed out'),
        expect.objectContaining({ error: 'Body read timed out after 15000ms' })
      );
    });

    it('タイムアウト以外のエラーは従来どおりERRORログを出力する', () => {
      const result = client._handleError(
        new Error('Some other error'),
        'https://127.0.0.1:27123/'
      );

      expect(result.message).toContain('Failed to connect');
      expect(addLog).toHaveBeenCalledWith(
        LogType.ERROR,
        expect.stringContaining('Some other error'),
        expect.any(Object)
      );
    });
  });
});
