/**
 * migration.test.ts
 * テスト: 旧形式のuBlockルールから新形式へのマイグレーション機能
 * 【テスト対象】: src/utils/migration.ts
 */

import { test, expect, jest, beforeEach } from '@jest/globals';
import { migrateToLightweightFormat, migrateUblockSettings, computeChecksum } from '../migration.js';

describe('migration', () => {
  // 【テスト前準備】: 各テスト実行前にChrome APIのモックをクリア
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetAllMocks();
  });

  describe('migrateToLightweightFormat', () => {
    test('旧形式から新形式にマイグレーション', () => {
      // 【テスト目的】: migrateToLightweightFormat関数の基本動作を確認
      // 【テスト内容】: 旧形式のルールセットを新形式（ドメイン配列のみ）に変換する処理をテスト
      // 【期待される動作】: blockRules/exceptionRulesの配列からdomainのみを抽出してblockDomains/exceptionDomains配列を生成する

      const oldRules = {
        blockRules: [
          { domain: 'example.com', options: {} },
          { domain: 'test.com', options: { thirdParty: true } }
        ],
        exceptionRules: [
          { domain: 'whitelist.com', options: {} }
        ],
        metadata: {
          importedAt: 1000000,
          ruleCount: 3
        }
      };

      const result = migrateToLightweightFormat(oldRules);

      expect(result).toEqual({
        blockDomains: ['example.com', 'test.com'],
        exceptionDomains: ['whitelist.com'],
        metadata: expect.objectContaining({
          importedAt: 1000000,
          ruleCount: 3
        })
      });
    });

    test('既に新形式の場合はそのまま返す', () => {
      // 【テスト目的】: 新形式に対する検出と早期リターン機能の確認
      // 【テスト内容】: すでにblockDomains/exceptionDomainsを持つルールセットが変更されないことをテスト
      // 【期待される動作】: 新形式のルールセットはそのまま返される（新たなオブジェクト作成はされない）

      const newRules = {
        blockDomains: ['example.com', 'test.com'],
        exceptionDomains: ['whitelist.com'],
        metadata: { importedAt: 1000000, ruleCount: 2 }
      };

      const result = migrateToLightweightFormat(newRules);

      expect(result).toBe(newRules);
    });

    test('空のルールセットをハンドル', () => {
      // 【テスト目的】: 空データに対する堅牢性の確認
      // 【テスト内容】: 空の配列を含むルールセットのマイグレーションをテスト
      // 【期待される動作】: 空の配列に対してエラーが発生せず、適切なデフォルトmetadataが付与される

      const emptyOldRules = {
        blockRules: [],
        exceptionRules: [],
        metadata: {}
      };

      const result = migrateToLightweightFormat(emptyOldRules);

      expect(result).toEqual({
        blockDomains: [],
        exceptionDomains: [],
        metadata: expect.objectContaining({
          ruleCount: 0,
          migrated: true
        })
      });
    });

    test('blockRulesまたはexceptionRulesが存在しない場合の処理', () => {
      // 【テスト目的】: プロパティ欠落に対する堅牢性の確認
      // 【テスト内容】: blockRulesまたはexceptionRulesがundefinedのケースをテスト
      // 【期待される動作】: デフォルトの空配列が使用され、空の結果が返される

      const partialOldRules = {
        metadata: {
          importedAt: 1000000
        }
      };

      const result = migrateToLightweightFormat(partialOldRules);

      expect(result).toEqual({
        blockDomains: [],
        exceptionDomains: [],
        metadata: expect.objectContaining({
          importedAt: 1000000,
          ruleCount: 0,
          migrated: true
        })
      });
    });

    test('metadataがない場合はデフォルト値を生成', () => {
      // 【テスト目的】: デフォルト値生成機能の確認
      // 【テスト内容】: metadataが欠落している場合の自動生成処理をテスト
      // 【期待される動作】: importedAtに現在時刻、ruleCountにルール数、migratedフラグがtrueで生成される

      const oldRulesWithoutMetadata = {
        blockRules: [
          { domain: 'example.com' },
          { domain: 'test.com' }
        ],
        exceptionRules: [
          { domain: 'whitelist.com' }
        ]
      };

      const result = migrateToLightweightFormat(oldRulesWithoutMetadata);

      expect(result).toEqual({
        blockDomains: ['example.com', 'test.com'],
        exceptionDomains: ['whitelist.com'],
        metadata: expect.objectContaining({
          importedAt: expect.any(Number),
          ruleCount: 3,
          migrated: true
        })
      });
    });

    test('ワイルドカードを含むドメインも正しく抽出', () => {
      // 【テスト目的】: ワイルドカードを含むドメインの抽出を確認
      // 【テスト内容】: *.example.comなどのワイルドカードパターンも正しく変換されることをテスト
      // 【期待される動作】: ドメイン文字列としてそのまま抽出される

      const oldRulesWithWildcard = {
        blockRules: [
          { domain: 'example.com' },
          { domain: '*.test.com' }
        ],
        exceptionRules: [
          { domain: '*.whitelist.com' }
        ],
        metadata: {
          importedAt: 1000000,
          ruleCount: 3
        }
      };

      const result = migrateToLightweightFormat(oldRulesWithWildcard);

      expect(result.blockDomains).toContain('example.com');
      expect(result.blockDomains).toContain('*.test.com');
      expect(result.exceptionDomains).toContain('*.whitelist.com');
    });
  });

  describe('migrateUblockSettings', () => {
    beforeAll(() => {
      // Set up chrome mock
      global.chrome = {
        storage: {
          local: {
            get: jest.fn(),
            set: jest.fn(),
            remove: jest.fn()
          }
        },
        runtime: {
          lastError: null
        }
      };
    });

    test('旧形式のルール exists場合にマイグレーションを実行', async () => {
      // 【テスト目的】: chrome.storageから旧形式ルールの読み取りとマイグレーション実行を確認
      // 【テスト内容】: 保存された旧形式ルールを取得し、新形式に変換して保存する処理をテスト
      // 【期待される動作】: StorageKeys.UBLOCK_RULES経由で旧形式を取得し、新形式で保存する

      const { StorageKeys } = await import('../storage');

      const oldUblockRules = {
        blockRules: [
          { domain: 'example.com' },
          { domain: 'test.com' }
        ],
        exceptionRules: [
          { domain: 'whitelist.com' }
        ],
        metadata: {
          importedAt: 1000000,
          ruleCount: 3
        }
      };

    // @ts-expect-error - jest.fn() type narrowing issue
  
      global.chrome.storage.local.get.mockResolvedValue({
        [StorageKeys.UBLOCK_RULES]: oldUblockRules
      });
    // @ts-expect-error - jest.fn() type narrowing issue
  
      global.chrome.storage.local.set.mockResolvedValue(undefined);

      const result = await migrateUblockSettings();

      expect(result).toBe(true);
      expect(global.chrome.storage.local.get).toHaveBeenCalledWith([StorageKeys.UBLOCK_RULES]);
      expect(global.chrome.storage.local.set).toHaveBeenCalledWith({
        [StorageKeys.UBLOCK_RULES]: expect.objectContaining({
          blockDomains: ['example.com', 'test.com'],
          exceptionDomains: ['whitelist.com']
        })
      });
    });

    test('既に新形式の場合はマイグレーションを実行しない', async () => {
      // 【テスト目的】: 新形式ルールの検出とスキップ動作を確認
      // 【テスト内容】: すでに新形式のルールが保存されている場合はマイグレーションをスキップする処理をテスト
      // 【期待される動作】: ルールが新形式の場合、getのみ実行され、setされずにfalseが返される

      const { StorageKeys } = await import('../storage');

      const newUblockRules = {
        blockDomains: ['example.com'],
        exceptionDomains: ['whitelist.com'],
        metadata: { importedAt: 1000000, ruleCount: 2 }
      };

    // @ts-expect-error - jest.fn() type narrowing issue
  
      global.chrome.storage.local.get.mockResolvedValue({
        [StorageKeys.UBLOCK_RULES]: newUblockRules
      });

      const result = await migrateUblockSettings();

      expect(result).toBe(false);
      expect(global.chrome.storage.local.get).toHaveBeenCalledWith([StorageKeys.UBLOCK_RULES]);
      expect(global.chrome.storage.local.set).not.toHaveBeenCalled();
    });

    test('ルールデータがない場合はマイグレーションを実行しない', async () => {
      // 【テスト目的】: ルール未保存時の動作を確認
      // 【テスト内容】: ストレージにuBlockルールが保存されていないケースをテスト
      // 【期待される動作】: getが実行され、setされずにfalseが返される

      const { StorageKeys } = await import('../storage');

    // @ts-expect-error - jest.fn() type narrowing issue
  
      global.chrome.storage.local.get.mockResolvedValue({
        [StorageKeys.UBLOCK_RULES]: undefined
      });

      const result = await migrateUblockSettings();

      expect(result).toBe(false);
      expect(global.chrome.storage.local.get).toHaveBeenCalledWith([StorageKeys.UBLOCK_RULES]);
      expect(global.chrome.storage.local.set).not.toHaveBeenCalled();
    });
  });
});

describe('migration rollback integrity', () => {
  it('restoreFromMigrationBackup throws when backup not found', async () => {
    // モック: バックアップなし
    (global as any).chrome.storage.local.get.mockResolvedValue({});
    (global as any).chrome.storage.local.set.mockResolvedValue(undefined);

    const { restoreFromMigrationBackup } = await import('../migration');
    await expect(restoreFromMigrationBackup('test_key')).rejects.toThrow();
  });

  it('restoreFromMigrationBackup validates checksum', async () => {
    // 正しいバックアップデータ
    const validData = { blockRules: ['example.com'], exceptionRules: [] };
    const { computeChecksum } = await import('../migration');
    const checksum = computeChecksum(validData);

    (global as any).chrome.storage.local.get.mockResolvedValue({
      migration_backup: {
        timestamp: Date.now(),
        originalData: validData,
        checksum
      }
    });

    const { restoreFromMigrationBackup } = await import('../migration');
    const result = await restoreFromMigrationBackup('test_key');
    expect(result).toBe(true);
  });

  it('restoreFromMigrationBackup throws on checksum mismatch', async () => {
    const validData = { blockRules: ['example.com'], exceptionRules: [] };
    const invalidChecksum = 'invalid-123';

    (global as any).chrome.storage.local.get.mockResolvedValue({
      migration_backup: {
        timestamp: Date.now(),
        originalData: validData,
        checksum: invalidChecksum
      }
    });

    const { restoreFromMigrationBackup } = await import('../migration');
    await expect(restoreFromMigrationBackup('test_key')).rejects.toThrow('data integrity check failed');
  });
});

describe('cleanupOldBackups (via migrateUblockSettings)', () => {
  test('古いバックアップを削除する', async () => {
    // 【テスト目的】: 保持期間を超えたバックアップがクリーンアップされることを確認
    // 【テスト内容】: 8日前のバックアップが存在する状態でmigrateUblockSettingsを実行
    // 【期待される動作】: cleanupOldBackupsがremoveを呼び、その後マイグレーションが実行される

    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;

    const oldRules = {
      blockRules: [{ domain: 'example.com' }],
      exceptionRules: [],
      metadata: { importedAt: 1000000 }
    };

    // get の呼び出しをキーに応じて分岐
    (global as any).chrome.storage.local.get.mockImplementation((keys: string[]) => {
      if (keys.includes('migration_backup')) {
        return Promise.resolve({
          migration_backup: {
            timestamp: eightDaysAgo,
            originalData: oldRules,
            checksum: 'old-checksum'
          }
        });
      }
      return Promise.resolve({ ublock_rules: oldRules });
    });
    (global as any).chrome.storage.local.set.mockResolvedValue(undefined);
    (global as any).chrome.storage.local.remove.mockResolvedValue(undefined);

    const result = await migrateUblockSettings();

    expect(result).toBe(true);
    // 古いバックアップのremoveが呼ばれること
    expect((global as any).chrome.storage.local.remove).toHaveBeenCalledWith(['migration_backup']);
  });
});

describe('migrateUblockSettings error handling', () => {
  test('マイグレーション失敗時にロールバックを実行して元のエラーを再スロー', async () => {
    // 【テスト目的】: マイグレーション中のエラー時にロールバックが実行されることを確認
    // 【テスト内容】: storage.setが2回目の呼び出し（マイグレーション保存時）で失敗
    // 【期待される動作】: restoreFromMigrationBackupが呼ばれ、元のエラーが再スローされる

    const oldRules = {
      blockRules: [{ domain: 'example.com' }],
      exceptionRules: [],
      metadata: { importedAt: 1000000 }
    };

    // get呼び出し順序:
    // 1. cleanupOldBackups: get(['migration_backup']) → バックアップなし
    // 2. migrateUblockSettings: get(['ublock_rules']) → oldRules
    // 3. createMigrationBackup: get(['ublock_rules']) → oldRules
    // 4. restoreFromMigrationBackup: get(['migration_backup']) → バックアップあり
    let getCallCount = 0;
    (global as any).chrome.storage.local.get.mockImplementation((keys: string[]) => {
      getCallCount++;
      if (getCallCount === 1) {
        return Promise.resolve({});
      }
      if (getCallCount <= 3) {
        return Promise.resolve({ ublock_rules: oldRules });
      }
      // restoreFromMigrationBackup用: バックアップデータを返す
      return Promise.resolve({
        migration_backup: {
          timestamp: Date.now(),
          originalData: oldRules,
          checksum: computeChecksum(oldRules)
        }
      });
    });

    let setCallCount = 0;
    (global as any).chrome.storage.local.set.mockImplementation(() => {
      setCallCount++;
      if (setCallCount >= 2) {
        return Promise.reject(new Error('Storage write failed'));
      }
      return Promise.resolve();
    });
    (global as any).chrome.storage.local.remove.mockResolvedValue(undefined);

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(migrateUblockSettings()).rejects.toThrow('Storage write failed');

    // ロールバックが試行されたことを確認
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Migration failed'),
      expect.any(Error)
    );

    consoleSpy.mockRestore();
  });

  test('マイグレーション失敗かつロールバックも失敗した場合に複合エラーをスロー', async () => {
    // 【テスト目的】: マイグレーションとロールバック両方が失敗した場合の動作を確認
    // 【テスト内容】: storage.setが失敗し、restoreFromMigrationBackupもバックアップ不在で失敗
    // 【期待される動作】: 両方のエラーを含む新しいエラーがスローされる

    const oldRules = {
      blockRules: [{ domain: 'example.com' }],
      exceptionRules: [],
      metadata: { importedAt: 1000000 }
    };

    let getCallCount = 0;
    (global as any).chrome.storage.local.get.mockImplementation(() => {
      getCallCount++;
      // 1回目: cleanupOldBackups用 (バックアップなし)
      // 2回目: ublock_rules取得用
      // 3回目: restoreFromMigrationBackup用 (バックアップなし)
      if (getCallCount === 1 || getCallCount === 3) {
        return Promise.resolve({});
      }
      return Promise.resolve({ ublock_rules: oldRules });
    });
    (global as any).chrome.storage.local.set.mockRejectedValue(new Error('Storage write failed'));
    (global as any).chrome.storage.local.remove.mockResolvedValue(undefined);

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(migrateUblockSettings()).rejects.toThrow(
      'Migration failed and rollback also failed'
    );

    consoleSpy.mockRestore();
  });
});

describe('initializeTrancoVersion', () => {
  test('非推奨警告を出力してTrustDb.initializeを委譲呼び出し', async () => {
    // 【テスト目的】: 非推奨関数がTrustDbに委譲することを確認
    // 【テスト内容】: initializeTrancoVersionがgetTrustDb().initialize()を呼び出す
    // 【期待される動作】: 警告ログ出力後、TrustDbのinitializeメソッドが実行される

    const mockInitialize = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);

    jest.mock('../trustDb/trustDb.js', () => ({
      getTrustDb: () => ({ initialize: mockInitialize })
    }), { virtual: true });

    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const { initializeTrancoVersion } = await import('../migration');
    await initializeTrancoVersion();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('deprecated')
    );
    expect(mockInitialize).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});
