/**
 * obsidianClient-secure-fetch.test.ts
 * Obsidian Local REST API のプロトコル設定に関するテスト
 * HTTP/HTTPS の選択が通信時に尊重されることを検証
 */

import { ObsidianClient } from '../obsidianClient.js';
import * as storage from '../../utils/storage.js';

vi.mock('../../utils/storage.js');

describe('ObsidianClient: Obsidian REST API プロトコル設定', () => {
  let obsidianClient: ObsidianClient;

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
      OBSIDIAN_API_KEY: 'OBSIDIAN_API_KEY',
      OBSIDIAN_DAILY_PATH: 'OBSIDIAN_DAILY_PATH'
    };
  });

  describe('_fetchExistingContent - プロトコル設定', () => {
    beforeEach(() => {
      global.fetch = vi.fn();
    });

    afterEach(() => {
      (global.fetch as vi.Mock).mockRestore();
    });

    it('HTTPS接続が許可されること', async () => {
      // @ts-expect-error - vi.fn() type narrowing issue
      storage.getSettings.mockResolvedValue({
        OBSIDIAN_API_KEY: 'test_key',
        OBSIDIAN_PROTOCOL: 'https',
        OBSIDIAN_PORT: '27123',
        OBSIDIAN_DAILY_PATH: ''
      });

      // @ts-expect-error - vi.fn() type narrowing issue
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

    it('HTTP URLがHTTPのまま使用されること', async () => {
      // @ts-expect-error - vi.fn() type narrowing issue
      storage.getSettings.mockResolvedValue({
        OBSIDIAN_API_KEY: 'test_key',
        OBSIDIAN_PROTOCOL: 'http',
        OBSIDIAN_PORT: '27123',
        OBSIDIAN_DAILY_PATH: ''
      });

      // @ts-expect-error - vi.fn() type narrowing issue
      global.fetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('Existing content')
      });

      const result = await obsidianClient._fetchExistingContent('http://127.0.0.1:27123/vault/test.md', {
        'Authorization': 'Bearer test_key'
      });

      expect(result).toBe('Existing content');

      expect(global.fetch).toHaveBeenCalledWith(
        'http://127.0.0.1:27123/vault/test.md',
        expect.objectContaining({
          method: 'GET',
          headers: expect.any(Object)
        })
      );
    });

    it('urlパラメータがnullの場合のエラーハンドリング', async () => {
      // @ts-expect-error - vi.fn() type narrowing issue
      global.fetch.mockRejectedValue(new Error('Invalid URL'));

      await expect(obsidianClient._fetchExistingContent(null as any, {}))
        .rejects.toThrow();
    });
  });

  describe('_writeContent - プロトコル設定', () => {
    beforeEach(() => {
      global.fetch = vi.fn();
    });

    afterEach(() => {
      (global.fetch as vi.Mock).mockRestore();
    });

    it('HTTPS接続で書き込みが成功すること', async () => {
      // @ts-expect-error - vi.fn() type narrowing issue
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

    it('HTTP URLで_writeContentが呼ばれた場合はHTTPのまま使用される', async () => {
      // @ts-expect-error - vi.fn() type narrowing issue
      global.fetch.mockResolvedValue({
        ok: true
      });

      await obsidianClient._writeContent('http://127.0.0.1:27123/vault/test.md', {
        'Authorization': 'Bearer test_key'
      }, 'Test content');

      expect(global.fetch).toHaveBeenCalledWith(
        'http://127.0.0.1:27123/vault/test.md',
        expect.objectContaining({
          method: 'PUT',
          headers: expect.any(Object),
          body: 'Test content'
        })
      );
    });
  });

  describe('testConnection - プロトコル設定', () => {
    beforeEach(() => {
      global.fetch = vi.fn();
    });

    afterEach(() => {
      (global.fetch as vi.Mock).mockRestore();
    });

    it('HTTPS接続テストが成功すること', async () => {
      // @ts-expect-error - vi.fn() type narrowing issue
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
    it('設定にhttpが含まれている場合はHTTPでfetchされる', async () => {
      // @ts-expect-error - vi.fn() type narrowing issue
      storage.getSettings.mockResolvedValue({
        OBSIDIAN_API_KEY: 'test_key',
        OBSIDIAN_PROTOCOL: 'http',
        OBSIDIAN_PORT: '27123',
        OBSIDIAN_DAILY_PATH: ''
      });

      global.fetch = vi.fn();
      // @ts-expect-error - vi.fn() type narrowing issue
      global.fetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('content')
      });

      await obsidianClient._fetchExistingContent(
        'http://127.0.0.1:27123/vault/test.md',
        { 'Authorization': 'Bearer test_key' }
      );

      expect(global.fetch).toHaveBeenCalledWith(
        'http://127.0.0.1:27123/vault/test.md',
        expect.any(Object)
      );

      (global.fetch as vi.Mock).mockRestore();
    });

    it('無効なプロトコル設定は拒否される', async () => {
      // @ts-expect-error - vi.fn() type narrowing issue
      storage.getSettings.mockResolvedValue({
        OBSIDIAN_API_KEY: 'test_key',
        OBSIDIAN_PROTOCOL: 'ftp',
        OBSIDIAN_PORT: '27123',
        OBSIDIAN_DAILY_PATH: ''
      });

      const result = await obsidianClient.testConnection();

      expect(result.success).toBe(false);
      expect(result.message).toContain('Protocol must be "http" or "https"');
    });
  });
});
