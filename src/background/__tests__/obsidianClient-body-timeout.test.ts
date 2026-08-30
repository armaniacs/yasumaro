/**
 * obsidianClient-body-timeout.test.ts
 * レスポンスボディ読み込み（response.text()）のタイムアウトテスト
 * PBI-11: ヘッダのみ受信後にボディが送られてこないケースでもハングしない
 */

import { ObsidianClient } from '../obsidianClient.js';
import * as storage from '../../utils/storage/types.js';
import * as storageSettings from '../../utils/storage/settingsStore.js';
import { addLog, LogType } from '../../utils/logger.js';

/** Response body that resolves with the given text (as one chunk). */
function bodyOf(text: string): { getReader: () => { read: () => Promise<{ done: boolean; value?: Uint8Array }>; cancel: () => Promise<void> } } {
  let sent = false;
  return {
    getReader: () => ({
      read: () => {
        if (sent) return Promise.resolve({ done: true, value: undefined });
        sent = true;
        return Promise.resolve({ done: false, value: new TextEncoder().encode(text) });
      },
      cancel: () => Promise.resolve(),
    }),
  };
}

/** Response body whose read() never resolves. */
function bodyNever(): { getReader: () => { read: () => Promise<never>; cancel: () => Promise<void> } } {
  return {
    getReader: () => ({
      read: () => new Promise<never>(() => {}),
      cancel: () => Promise.resolve(),
    }),
  };
}

vi.mock('../../utils/storage/types.js');
vi.mock('../../utils/storage/defaults.js');
vi.mock('../../utils/storage/encryptionSession.js');
vi.mock('../../utils/storage/settingsStore.js');
vi.mock('../../utils/storage/savedUrlRepository.js');
vi.mock('../../utils/storage/domainFilterCache.js');
vi.mock('../../utils/storage/quota.js');
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
    storageSettings.getSettings.mockResolvedValue({
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
        body: bodyNever()
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
        body: bodyNever()
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
        body: bodyNever()
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
        body: bodyOf("Existing content")
      });

      const result = await client._fetchExistingContent(
        'http://127.0.0.1:27123/vault/test.md',
        { 'Authorization': 'Bearer test_key' }
      );

      expect(result).toBe('Existing content');
    });
  });

  describe('_fetchExistingContent - バイト上限', () => {
    it('Content-Length なしで 10MB を超える chunked 応答は打ち切られエラー分類に乗ること', async () => {
      const chunk = new Uint8Array(1024 * 1024); // 1MB
      let count = 0;
      mockFetch.mockResolvedValue({
        ok: true,
        headers: { get: () => null },
        body: {
          getReader: () => ({
            read: () => {
              count += 1;
              return Promise.resolve({ done: false, value: chunk });
            },
            cancel: () => Promise.resolve(),
          }),
        },
      });

      const err = await client._fetchExistingContent(
        'http://127.0.0.1:27123/vault/test.md',
        { 'Authorization': 'Bearer test_key' },
      ).catch((e: Error) => e);

      expect(err).toBeInstanceOf(Error);
      expect(count).toBeLessThan(20); // aborted well before buffering everything
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
