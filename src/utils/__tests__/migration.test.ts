/**
 * migration.test.ts
 * テスト: 旧形式のuBlockルールから新形式へのマイグレーション機能
 * 【テスト対象】: src/utils/migration.ts
 */

import { test, expect, jest, beforeEach } from '@jest/globals.js';
import { migrateToLightweightFormat, migrateUblockSettings } from '../migration.js';

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
            set: jest.fn()
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
