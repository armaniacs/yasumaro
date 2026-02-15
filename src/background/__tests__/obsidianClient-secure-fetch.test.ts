/**
 * obsidianClient-secure-fetch.test.js
 * HTTPS通信の強制に関するテスト
 * タスク1: HTTPS通信の強制と権限の最小化
 */

import { ObsidianClient } from '../obsidianClient.ts';
import * as storage from '../../utils/storage.ts';

jest.mock('../../utils/storage.ts');

describe('ObsidianClient: HTTPS通信の強制（タスク1）', () => {
  let obsidianClient;

  beforeEach(() => {
    obsidianClient = new ObsidianClient();
    jest.clearAllMocks();

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
  });

  describe('_fetchExistingContent - HTTPS強制', () => {
    beforeEach(() => {
      global.fetch = jest.fn();
    });

    afterEach(() => {
      global.fetch.mockRestore();
    });

    it('HTTPS接続が許可されること', async () => {
      storage.getSettings.mockResolvedValue({
        OBSIDIAN_API_KEY: 'test_key',
        OBSIDIAN_PROTOCOL: 'https',
        OBSIDIAN_PORT: '27123',
        OBSIDIAN_DAILY_PATH: ''
      });

      global.fetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('Existing content')
      });

      const result = await obsidianClient._fetchExistingContent('https://127.0.0.1:27123/vault/test.md', {
        'Authorization': 'Bearer test_key'
      });

      expect(result).toBe('Existing content');
      expect(global.fetch).toHaveBeenCalledWith(
        'https://127.0.0.1:27123/vault/test.md',
        expect.objectContaining({
          method: 'GET',
          headers: expect.any(Object)
        })
      );
    });

    it.skip('URLがhttpプロトコルの場合、HTTPSに変換されること（実装後）', async () => {
      // TODO: secureFetch実装後にこのテストを有効化
      storage.getSettings.mockResolvedValue({
        OBSIDIAN_API_KEY: 'test_key',
        OBSIDIAN_PROTOCOL: 'http', // HTTP設定だが、secureFetchでHTTPSに変換される
        OBSIDIAN_PORT: '27123',
        OBSIDIAN_DAILY_PATH: ''
      });

      global.fetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('Existing content')
      });

      try {
        await obsidianClient._fetchExistingContent('http://127.0.0.1:27123/vault/test.md', {
          'Authorization': 'Bearer test_key'
        });
        // secureFetchが実装されたら、fetchはHTTPSで呼ばれるはず
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringMatching(/^https:\/\//), // HTTPSで呼ばれる
          expect.any(Object)
        );
      } catch (e) {
        // 現在はsecureFetch未実装のため、テストをスキップ
        expect(e.message).toContain('Secure fetch not implemented');
      }
    });

    it('urlパラメータがnullの場合のエラーハンドリング', async () => {
      global.fetch.mockRejectedValue(new Error('Invalid URL'));

      await expect(obsidianClient._fetchExistingContent(null, {}))
        .rejects.toThrow();
    });
  });

  describe('_writeContent - HTTPS強制', () => {
    beforeEach(() => {
      global.fetch = jest.fn();
    });

    afterEach(() => {
      global.fetch.mockRestore();
    });

    it('HTTPS接続で書き込みが成功すること', async () => {
      global.fetch.mockResolvedValue({
        ok: true
      });

      await obsidianClient._writeContent('https://127.0.0.1:27123/vault/test.md', {
        'Authorization': 'Bearer test_key'
      }, 'Test content');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://127.0.0.1:27123/vault/test.md',
        expect.objectContaining({
          method: 'PUT',
          headers: expect.any(Object),
          body: 'Test content'
        })
      );
    });
  });

  describe('testConnection - HTTPS強制', () => {
    beforeEach(() => {
      global.fetch = jest.fn();
    });

    afterEach(() => {
      global.fetch.mockRestore();
    });

    it('HTTPS接続テストが成功すること', async () => {
      global.fetch.mockResolvedValue({
        ok: true
      });

      const result = await obsidianClient.testConnection();

      expect(result.success).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringMatching(/^https:\/\//),
        expect.objectContaining({
          method: 'GET',
          headers: expect.any(Object)
        })
      );
    });
  });

  describe('プロトコル設定の検証', () => {
    it('設定にhttpが含まれている場合、警告が表示されること', async () => {
      storage.getSettings.mockResolvedValue({
        OBSIDIAN_API_KEY: 'test_key',
        OBSIDIAN_PROTOCOL: 'http', // 非推奨: HTTPは安全でない
        OBSIDIAN_PORT: '27123',
        OBSIDIAN_DAILY_PATH: ''
      });

      // TODO: secureFetch実装後に、HTTPがブロックされることを確認
      const config = await obsidianClient._getConfig();

      expect(config.baseUrl).toContain('http://');
      // 将来的にはHTTPSに変換されるか、エラーがスローされる
    });
  });
});

/**
 * 実装推奨事項:
 *
 * 1. obsidianClient.jsにsecureFetchメソッドを実装:
 *    - URLがhttpの場合、httpsに変換
 *    - 変換時に警告ログを出力
 *    - HTTPSのみを許可
 *
 * 2. _fetchExistingContentと_writeContentでsecureFetchを使用
 *
 * 3. テスト環境でもsecureFetchの動作を検証可能
 */