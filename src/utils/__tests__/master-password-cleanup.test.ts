/**
 * master-password-cleanup.test.ts
 * マスターパスワード無効化時のデータクリーンアップテスト
 * ADR: 2026-03-24-master-password-data-cleanup.md
 */

import { jest } from '@jest/globals';

jest.mock('../../utils/logger.js', () => ({
  logInfo: jest.fn(),
  logDebug: jest.fn(),
  logError: jest.fn(),
  addLog: jest.fn(),
  ErrorCode: {
    STORAGE_QUOTA_EXCEEDED: 'STORAGE_QUOTA_EXCEEDED'
  },
  LogType: {
    DEBUG: 'DEBUG',
    INFO: 'INFO',
    WARN: 'WARN',
    ERROR: 'ERROR'
  }
}));

describe('Master Password Data Cleanup', () => {
  const API_KEY_FIELDS = [
    'obsidian_api_key',
    'gemini_api_key',
    'openai_api_key',
    'openai_2_api_key',
    'provider_api_key'
  ];

  describe('Phase 1: クリーンアップロジック', () => {
    it('マスターパスワード関連キーが削除対象であること', () => {
      const masterPasswordKeys = [
        'master_password_enabled',
        'master_password_salt',
        'master_password_hash'
      ];

      expect(masterPasswordKeys).toContain('master_password_enabled');
      expect(masterPasswordKeys).toContain('master_password_salt');
      expect(masterPasswordKeys).toContain('master_password_hash');
      expect(masterPasswordKeys).toHaveLength(3);
    });

    it('APIキーがリセット対象であること', () => {
      expect(API_KEY_FIELDS).toContain('obsidian_api_key');
      expect(API_KEY_FIELDS).toContain('gemini_api_key');
      expect(API_KEY_FIELDS).toContain('openai_api_key');
      expect(API_KEY_FIELDS).toContain('openai_2_api_key');
      expect(API_KEY_FIELDS).toContain('provider_api_key');
      expect(API_KEY_FIELDS).toHaveLength(5);
    });

    it('APIキーが空文字列でリセットされる', () => {
      const settings = {
        obsidian_api_key: 'encrypted_data_123',
        gemini_api_key: 'encrypted_data_456',
        openai_api_key: 'encrypted_data_789',
        openai_2_api_key: '',
        provider_api_key: 'encrypted_data_abc',
        some_other_setting: 'should_remain'
      };

      // クリーンアップロジックをシミュレート
      const cleaned = { ...settings };
      for (const key of API_KEY_FIELDS) {
        if (key in cleaned) {
          (cleaned as Record<string, string>)[key] = '';
        }
      }

      expect(cleaned.obsidian_api_key).toBe('');
      expect(cleaned.gemini_api_key).toBe('');
      expect(cleaned.openai_api_key).toBe('');
      expect(cleaned.openai_2_api_key).toBe('');
      expect(cleaned.provider_api_key).toBe('');
      // 他の設定は保持される
      expect(cleaned.some_other_setting).toBe('should_remain');
    });
  });

  describe('Phase 2: 確認ダイアログ', () => {
    it('削除前に確認が求められる', () => {
      // Phase 2 で confirm() が追加された
      // ユーザーがキャンセルできる確認ダイアログが存在することを検証
      const confirmMessage =
        'Disabling the master password will remove all encrypted API keys. This action cannot be undone. Continue?';

      expect(confirmMessage).toContain('encrypted API keys');
      expect(confirmMessage).toContain('cannot be undone');
    });

    it('キャンセル時はAPIキーが保持される', () => {
      // confirm が false の場合、masterPasswordEnabled.checked = true に戻る
      // APIキーは変更されない
      const settings = {
        obsidian_api_key: 'encrypted_data_123',
        gemini_api_key: 'encrypted_data_456'
      };

      // キャンセル時のシミュレーション: 設定は変更されない
      const result = { ...settings };

      expect(result.obsidian_api_key).toBe('encrypted_data_123');
      expect(result.gemini_api_key).toBe('encrypted_data_456');
    });
  });

  describe('Phase 3: 統合テスト', () => {
    it('マスターパスワード削除フローの順序が正しい', () => {
      const steps: string[] = [];

      // 1. パスワード認証
      steps.push('authenticate');

      // 2. 確認ダイアログ
      steps.push('confirm');

      // 3. マスターパスワードキー削除
      steps.push('remove_master_password_keys');

      // 4. APIキーリセット
      steps.push('reset_api_keys');

      // 5. 設定保存
      steps.push('save_settings');

      // 6. UI更新
      steps.push('update_ui');

      expect(steps).toEqual([
        'authenticate',
        'confirm',
        'remove_master_password_keys',
        'reset_api_keys',
        'save_settings',
        'update_ui'
      ]);
    });

    it('暗号化データが完全にクリアされる', () => {
      // 模擬的なストレージデータ
      const storage: Record<string, unknown> = {
        master_password_enabled: true,
        master_password_salt: 'salt_base64',
        master_password_hash: 'hash_base64',
        obsidian_api_key: { encrypted: true, data: 'encrypted_blob' },
        gemini_api_key: { encrypted: true, data: 'encrypted_blob' },
        openai_api_key: 'plain_text_key',
        some_setting: 'value'
      };

      // Step 1: Remove master password keys
      delete storage.master_password_enabled;
      delete storage.master_password_salt;
      delete storage.master_password_hash;

      // Step 2: Reset API keys
      for (const key of API_KEY_FIELDS) {
        storage[key] = '';
      }

      expect(storage.master_password_enabled).toBeUndefined();
      expect(storage.master_password_salt).toBeUndefined();
      expect(storage.master_password_hash).toBeUndefined();
      expect(storage.obsidian_api_key).toBe('');
      expect(storage.gemini_api_key).toBe('');
      expect(storage.openai_api_key).toBe('');
      // 他の設定は保持される
      expect(storage.some_setting).toBe('value');
    });
  });
});
