/**
 * robustness-port-validation.test.js
 * ポート番号の検証テスト
 * ブルーチーム報告 P1: ポート番号の範囲検証がない
 */

import { ObsidianClient } from '../obsidianClient.js';
import * as storage from '../../utils/storage.js';
import { addLog, LogType } from '../../utils/logger.js';

jest.mock('../../utils/storage.js');
jest.mock('../../utils/logger.js', () => ({
  addLog: jest.fn(),
  LogType: {
    DEBUG: 'DEBUG',
    INFO: 'INFO',
    WARN: 'WARN',
    ERROR: 'ERROR'
  }
}));

describe('ObsidianClient: ポート番号の検証（P1）', () => {
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

    // fetchのデフォルトモック
    global.fetch = jest.fn()
      .mockResolvedValue({
        ok: true
      });
  });

  afterEach(() => {
    global.fetch.mockRestore();
  });

  describe('現在の実装の確認', () => {
    it('有効なポート番号（1-65535）の場合は正常に動作すること', async () => {
      const validPorts = ['1', '80', '443', '27123', '8080', '65535'];

      for (const port of validPorts) {
        storage.getSettings.mockResolvedValue({
          OBSIDIAN_API_KEY: 'test_key',
          OBSIDIAN_PROTOCOL: 'https',
          OBSIDIAN_PORT: port,
          OBSIDIAN_DAILY_PATH: ''
        });

        const config = await obsidianClient._getConfig();
        expect(config.baseUrl).toContain(`:${port}`);
      }
    });

    it('現在の実装ではポート番号の範囲検証があること', async () => {
      // 注: 実装後は無効なポート番号を指定するとエラーがスローされる

      const invalidPorts = ['0', '65536', '99999', 'abc', '-1'];

      for (const port of invalidPorts) {
        storage.getSettings.mockResolvedValue({
          OBSIDIAN_API_KEY: 'test_key',
          OBSIDIAN_PROTOCOL: 'https',
          OBSIDIAN_PORT: port,
          OBSIDIAN_DAILY_PATH: ''
        });

        // 実装後はエラーがスローされる
        await expect(obsidianClient._getConfig()).rejects.toThrow();
      }
    });
  });

  describe('無効なポート番号のエッジケース', () => {
    it('ポート番号が0の場合はエラーをスローすべき', async () => {
      // ポート番号0は予約されているため、使用すべきでない
      storage.getSettings.mockResolvedValue({
        OBSIDIAN_API_KEY: 'test_key',
        OBSIDIAN_PROTOCOL: 'https',
        OBSIDIAN_PORT: '0',
        OBSIDIAN_DAILY_PATH: ''
      });

      await expect(obsidianClient._getConfig()).rejects.toThrow();
    });

    it('ポート番号が65535より大きい場合はエラーをスローすべき', async () => {
      // ポート番号の最大値は65535
      storage.getSettings.mockResolvedValue({
        OBSIDIAN_API_KEY: 'test_key',
        OBSIDIAN_PROTOCOL: 'https',
        OBSIDIAN_PORT: '65536',
        OBSIDIAN_DAILY_PATH: ''
      });

      await expect(obsidianClient._getConfig()).rejects.toThrow();
    });

    it('ポート番号が負の値の場合はエラーをスローすべき', async () => {
      storage.getSettings.mockResolvedValue({
        OBSIDIAN_API_KEY: 'test_key',
        OBSIDIAN_PROTOCOL: 'https',
        OBSIDIAN_PORT: '-1',
        OBSIDIAN_DAILY_PATH: ''
      });

      await expect(obsidianClient._getConfig()).rejects.toThrow();
    });

    it('ポート番号が非数値の場合はエラーをスローすべき', async () => {
      storage.getSettings.mockResolvedValue({
        OBSIDIAN_API_KEY: 'test_key',
        OBSIDIAN_PROTOCOL: 'https',
        OBSIDIAN_PORT: 'abc',
        OBSIDIAN_DAILY_PATH: ''
      });

      await expect(obsidianClient._getConfig()).rejects.toThrow();
    });

    it('ポート番号が小数の場合はエラーをスローすべき', async () => {
      storage.getSettings.mockResolvedValue({
        OBSIDIAN_API_KEY: 'test_key',
        OBSIDIAN_PROTOCOL: 'https',
        OBSIDIAN_PORT: '27123.5',
        OBSIDIAN_DAILY_PATH: ''
      });

      await expect(obsidianClient._getConfig()).rejects.toThrow();
    });
  });

  describe('予約されたポート番号', () => {
    it('ポート番号が未指定の場合はデフォルト値（27123）を使用すべき', async () => {
      storage.getSettings.mockResolvedValue({
        OBSIDIAN_API_KEY: 'test_key',
        OBSIDIAN_PROTOCOL: 'https',
        OBSIDIAN_PORT: undefined,
        OBSIDIAN_DAILY_PATH: ''
      });

      const config = await obsidianClient._getConfig();
      expect(config.baseUrl).toContain(':27123');
    });

    it('ポート番号が空文字列の場合はデフォルト値（27123）を使用すべき', async () => {
      storage.getSettings.mockResolvedValue({
        OBSIDIAN_API_KEY: 'test_key',
        OBSIDIAN_PROTOCOL: 'https',
        OBSIDIAN_PORT: '',
        OBSIDIAN_DAILY_PATH: ''
      });

      const config = await obsidianClient._getConfig();
      expect(config.baseUrl).toContain(':27123');
    });
  });

  describe('エラーメッセージ', () => {
    it('無効なポート番号の場合に適切なエラーメッセージを表示すべき', async () => {
      storage.getSettings.mockResolvedValue({
        OBSIDIAN_API_KEY: 'test_key',
        OBSIDIAN_PROTOCOL: 'https',
        OBSIDIAN_PORT: '0',
        OBSIDIAN_DAILY_PATH: ''
      });

      await expect(obsidianClient._getConfig()).rejects.toThrow(
        'Invalid port number. Port must be between 1 and 65535.'
      );
    });

    it('ポート番号が非数値の場合に適切なエラーメッセージを表示すべき', async () => {
      storage.getSettings.mockResolvedValue({
        OBSIDIAN_API_KEY: 'test_key',
        OBSIDIAN_PROTOCOL: 'https',
        OBSIDIAN_PORT: 'abc',
        OBSIDIAN_DAILY_PATH: ''
      });

      await expect(obsidianClient._getConfig()).rejects.toThrow(
        'Invalid port number. Port must be a valid number.'
      );
    });
  });

  describe('推奨される検証実装', () => {
    it('ポート番号が1-65535の範囲内であることを検証すべき', () => {
      const isValidPort = (port) => {
        const portNum = parseInt(port, 10);
        return !isNaN(portNum) && portNum >= 1 && portNum <= 65535;
      };
      expect(isValidPort('1')).toBe(true);
      expect(isValidPort('65535')).toBe(true);
      expect(isValidPort('0')).toBe(false);
      expect(isValidPort('65536')).toBe(false);
    });

    it('ポート番号が整数であることを検証すべき', () => {
      const isIntegerPort = (port) => {
        const portNum = Number(port);
        return Number.isInteger(portNum);
      };
      expect(isIntegerPort('8080')).toBe(true);
      expect(isIntegerPort('27123.5')).toBe(false);
      expect(isIntegerPort('8080.0')).toBe(true);
    });

    it('設定時だけでなく使用時にも検証すべき', async () => {
      // 設定時と使用時の両方で検証を行うべき
      // _validatePortメソッドが呼び出されることを確認
      storage.getSettings.mockResolvedValue({
        OBSIDIAN_API_KEY: 'test_key',
        OBSIDIAN_PROTOCOL: 'https',
        OBSIDIAN_PORT: '999',
        OBSIDIAN_DAILY_PATH: ''
      });

      const validateSpy = jest.spyOn(obsidianClient, '_validatePort');
      await obsidianClient._getConfig();
      expect(validateSpy).toHaveBeenCalledWith('999');
      validateSpy.mockRestore();
    });
  });
});

/**
 * 実装推奨事項:
 *
 * 1. ポート番号の範囲検証を追加
 *    - 有効範囲: 1-65535
 *    - 整数であることを確認
 *
 * 2. エラーハンドリングの強化
 *    - 無効なポート番号の場合に適切なエラーメッセージを表示
 *    - addLogを使用して警告ログを出力
 *
 * 3. デフォルト値の使用
 *    - ポート番号が未指定または空の場合はデフォルト値（27123）を使用
 *
 * 4. 設定時の検証
 *    - 設定保存時にポート番号を検証
 *    - 無効なポート番号の場合はエラーを表示して保存を拒否
 *
 * 5. 推奨ポートの案内
 *    - プライベートポート範囲（49152-65535）の使用を推奨
 *    - ユーザーに適切なポート番号を案内
 */