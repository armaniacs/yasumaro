/**
 * robustness-port-validation.test.js
 * ポート番号の検証テスト
 * ブルーチーム報告 P1: ポート番号の範囲検証がない
 */

import { ObsidianClient } from '../obsidianClient.js';
import * as storage from '../../utils/storage/types.js';
import { addLog, LogType } from '../../utils/logger.js';
import * as validator from '../../utils/obsidianConfigValidator.js';

const mockGetSettings = vi.hoisted(() => vi.fn());

vi.mock('../../utils/storage/types.js');
vi.mock('../../utils/storage/defaults.js');
vi.mock('../../utils/storage/encryptionSession.js');
vi.mock('../../utils/storage/SettingsRepository.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const getManyFromAll = async (keys: readonly string[]) => {
    const all = await mockGetSettings();
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = (all as Record<string, unknown>)?.[k];
    return out;
  };
  return {
    ...actual,
    settingsRepository: {
      ...(actual.settingsRepository as Record<string, unknown>),
      getAll: mockGetSettings,
      get: vi.fn(async (key: string) => (await mockGetSettings())?.[key]),
      getMany: getManyFromAll,
      clearCache: vi.fn(),
      set: vi.fn(),
      setAll: vi.fn(),
    },
    SettingsRepository: class {
      getAll = mockGetSettings;
      get = vi.fn(async (key: string) => (await mockGetSettings())?.[key]);
      getMany = getManyFromAll;
      clearCache = vi.fn();
      set = vi.fn();
      setAll = vi.fn();
    },
  };
});
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

describe('ObsidianClient: ポート番号の検証（P1）', () => {
  let obsidianClient: ObsidianClient;

  beforeEach(() => {
    obsidianClient = new ObsidianClient();
    vi.clearAllMocks();

    // storageのデフォルトモック
  
    mockGetSettings.mockResolvedValue({
      OBSIDIAN_API_KEY: 'test_key',
      OBSIDIAN_PROTOCOL: 'https',
      OBSIDIAN_PORT: '27123',
      OBSIDIAN_DAILY_PATH: ''
    });
    (storage as { StorageKeys: Record<string, string> }).StorageKeys = {
      OBSIDIAN_PROTOCOL: 'OBSIDIAN_PROTOCOL',
      OBSIDIAN_PORT: 'OBSIDIAN_PORT',
      OBSIDIAN_API_KEY: 'OBSIDIAN_API_KEY',
      OBSIDIAN_DAILY_PATH: 'OBSIDIAN_DAILY_PATH'
    };

    // fetchのデフォルトモック
    global.fetch = vi.fn()
  
      .mockResolvedValue({
        ok: true
      });
  });

  afterEach(() => {
    vi.mocked(global.fetch).mockRestore();
  });

  describe('現在の実装の確認', () => {
    it('works normally with valid port numbers (1-65535)', async () => {
      const validPorts = ['1', '80', '443', '27123', '8080', '65535'];

      for (const port of validPorts) {
  
        mockGetSettings.mockResolvedValue({
          OBSIDIAN_API_KEY: 'test_key',
          OBSIDIAN_PROTOCOL: 'https',
          OBSIDIAN_PORT: port,
          OBSIDIAN_DAILY_PATH: ''
        });

        const config = await obsidianClient._getConfig();
        expect(config.baseUrl).toContain(`:${port}`);
      }
    });

    it('validates the port number range in the current implementation', async () => {
      // 注: 実装後は無効なポート番号を指定するとエラーがスローされる

      const invalidPorts = ['0', '65536', '99999', 'abc', '-1'];

      for (const port of invalidPorts) {
  
        mockGetSettings.mockResolvedValue({
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
    it('throws when the port number is 0', async () => {
      // ポート番号0は予約されているため、使用すべきでない
  
      mockGetSettings.mockResolvedValue({
        OBSIDIAN_API_KEY: 'test_key',
        OBSIDIAN_PROTOCOL: 'https',
        OBSIDIAN_PORT: '0',
        OBSIDIAN_DAILY_PATH: ''
      });

      await expect(obsidianClient._getConfig()).rejects.toThrow();
    });

    it('throws when the port number exceeds 65535', async () => {
      // ポート番号の最大値は65535
  
      mockGetSettings.mockResolvedValue({
        OBSIDIAN_API_KEY: 'test_key',
        OBSIDIAN_PROTOCOL: 'https',
        OBSIDIAN_PORT: '65536',
        OBSIDIAN_DAILY_PATH: ''
      });

      await expect(obsidianClient._getConfig()).rejects.toThrow();
    });

    it('throws when the port number is negative', async () => {
  
      mockGetSettings.mockResolvedValue({
        OBSIDIAN_API_KEY: 'test_key',
        OBSIDIAN_PROTOCOL: 'https',
        OBSIDIAN_PORT: '-1',
        OBSIDIAN_DAILY_PATH: ''
      });

      await expect(obsidianClient._getConfig()).rejects.toThrow();
    });

    it('throws when the port number is non-numeric', async () => {
  
      mockGetSettings.mockResolvedValue({
        OBSIDIAN_API_KEY: 'test_key',
        OBSIDIAN_PROTOCOL: 'https',
        OBSIDIAN_PORT: 'abc',
        OBSIDIAN_DAILY_PATH: ''
      });

      await expect(obsidianClient._getConfig()).rejects.toThrow();
    });

    it('throws when the port number is fractional', async () => {
  
      mockGetSettings.mockResolvedValue({
        OBSIDIAN_API_KEY: 'test_key',
        OBSIDIAN_PROTOCOL: 'https',
        OBSIDIAN_PORT: '27123.5',
        OBSIDIAN_DAILY_PATH: ''
      });

      await expect(obsidianClient._getConfig()).rejects.toThrow();
    });
  });

  describe('予約されたポート番号', () => {
    it('uses the default value (27124) when the port number is unspecified', async () => {
  
      mockGetSettings.mockResolvedValue({
        OBSIDIAN_API_KEY: 'test_key',
        OBSIDIAN_PROTOCOL: 'https',
        OBSIDIAN_PORT: undefined,
        OBSIDIAN_DAILY_PATH: ''
      });

      const config = await obsidianClient._getConfig();
      expect(config.baseUrl).toContain(':27124');
    });

    it('uses the default value (27124) when the port number is an empty string', async () => {
  
      mockGetSettings.mockResolvedValue({
        OBSIDIAN_API_KEY: 'test_key',
        OBSIDIAN_PROTOCOL: 'https',
        OBSIDIAN_PORT: '',
        OBSIDIAN_DAILY_PATH: ''
      });

      const config = await obsidianClient._getConfig();
      expect(config.baseUrl).toContain(':27124');
    });
  });

  describe('エラーメッセージ', () => {
    it('shows an appropriate error message for invalid port numbers', async () => {
  
      mockGetSettings.mockResolvedValue({
        OBSIDIAN_API_KEY: 'test_key',
        OBSIDIAN_PROTOCOL: 'https',
        OBSIDIAN_PORT: '0',
        OBSIDIAN_DAILY_PATH: ''
      });

      await expect(obsidianClient._getConfig()).rejects.toThrow(
        'Invalid port number. Port must be between 1 and 65535.'
      );
    });

    it('shows an appropriate error message for non-numeric port numbers', async () => {
  
      mockGetSettings.mockResolvedValue({
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
    it('validates that the port number is within 1-65535', () => {
      const isValidPort = (port: string) => {
        const portNum = parseInt(port, 10);
        return !isNaN(portNum) && portNum >= 1 && portNum <= 65535;
      };
      expect(isValidPort('1')).toBe(true);
      expect(isValidPort('65535')).toBe(true);
      expect(isValidPort('0')).toBe(false);
      expect(isValidPort('65536')).toBe(false);
    });

    it('validates that the port number is an integer', () => {
      const isIntegerPort = (port: string) => {
        const portNum = Number(port);
        return Number.isInteger(portNum);
      };
      expect(isIntegerPort('8080')).toBe(true);
      expect(isIntegerPort('27123.5')).toBe(false);
      expect(isIntegerPort('8080.0')).toBe(true);
    });

    it('validates both at configuration time and at use time', async () => {
      // 設定時と使用時の両方で検証を行うべき
      // validateObsidianPort関数が呼び出されることを確認
  
      mockGetSettings.mockResolvedValue({
        OBSIDIAN_API_KEY: 'test_key',
        OBSIDIAN_PROTOCOL: 'https',
        OBSIDIAN_PORT: '999',
        OBSIDIAN_DAILY_PATH: ''
      });

      const validateSpy = vi.spyOn(validator, 'validateObsidianPort');
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
 *    - ポート番号が未指定または空の場合はデフォルト値（27124）を使用
 *
 * 4. 設定時の検証
 *    - 設定保存時にポート番号を検証
 *    - 無効なポート番号の場合はエラーを表示して保存を拒否
 *
 * 5. 推奨ポートの案内
 *    - プライベートポート範囲（49152-65535）の使用を推奨
 *    - ユーザーに適切なポート番号を案内
 */