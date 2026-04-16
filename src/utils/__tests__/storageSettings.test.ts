/**
 * storageSettings.test.ts
 * storageSettings.ts の単体テスト
 */

import { webcrypto as crypto } from '@peculiar/webcrypto';
Object.defineProperty(global, 'crypto', {
    value: crypto
});

// chrome API モック
const mockStorage: Record<string, any> = {};
const mockChrome = {
    storage: {
        local: {
            get: vi.fn(async (keys: string | string[] | null) => {
                if (keys === null) return { ...mockStorage };
                if (typeof keys === 'string') return { [keys]: mockStorage[keys] };
                const result: Record<string, any> = {};
                for (const key of keys) {
                    if (key in mockStorage) result[key] = mockStorage[key];
                }
                return result;
            }),
            set: vi.fn(async (data: Record<string, any>) => {
                Object.assign(mockStorage, data);
            }),
            remove: vi.fn(async (keys: string[]) => {
                for (const key of keys) delete mockStorage[key];
            })
        }
    }
};
(global as any).chrome = mockChrome;

// crypto モック
vi.mock('../crypto.js', () => ({
    encryptApiKey: vi.fn(async (value: string, _key: CryptoKey) => ({ ciphertext: 'enc_' + value, iv: 'iv' })),
    decryptApiKey: vi.fn(async (data: any, _key: CryptoKey) => {
        if (typeof data === 'object' && data.ciphertext) {
            return data.ciphertext.replace('enc_', '');
        }
        return data;
    }),
    isEncrypted: vi.fn((value: any) => {
        return value && typeof value === 'object' && 'ciphertext' in value;
    })
}));

// optimisticLock モック
vi.mock('../optimisticLock.js', () => ({
    withOptimisticLock: vi.fn(async (_key: string, fn: (current: any) => any) => {
        const result = fn(mockStorage['settings'] || {});
        Object.assign(mockStorage, { settings: result });
        return result;
    })
}));

// storage モック
vi.mock('../storage.js', () => ({
    DEFAULT_SETTINGS: {
        ai_provider: 'gemini',
        obsidian_protocol: 'http',
        obsidian_port: '27123',
        min_visit_duration: 10,
        min_scroll_depth: 25,
        domain_filter_mode: 'whitelist'
    },
    Settings: {}
}));

import {
    API_KEY_FIELDS,
    SETTINGS_MIGRATED_KEY,
    migrateToSingleSettingsObject,
    getSettings,
    saveSettings,
    clearSettingsCache,
    DEFAULT_SETTINGS
} from '../storageSettings.js';

import * as cryptoModule from '../crypto.js';
import * as optimisticLockModule from '../optimisticLock.js';

const { encryptApiKey, decryptApiKey } = vi.mocked(cryptoModule);
const { withOptimisticLock } = vi.mocked(optimisticLockModule);

describe('storageSettings', () => {

    beforeEach(() => {
        Object.keys(mockStorage).forEach(key => delete mockStorage[key]);
        clearSettingsCache();
        vi.clearAllMocks();
    });

    describe('定数', () => {
        test('API_KEY_FIELDS が4つのフィールドを含む', () => {
            expect(API_KEY_FIELDS).toHaveLength(4);
            expect(API_KEY_FIELDS).toContain('obsidian_api_key');
            expect(API_KEY_FIELDS).toContain('gemini_api_key');
            expect(API_KEY_FIELDS).toContain('openai_api_key');
            expect(API_KEY_FIELDS).toContain('openai_2_api_key');
        });

        test('SETTINGS_MIGRATED_KEY が正しい値', () => {
            expect(SETTINGS_MIGRATED_KEY).toBe('settings_migrated');
        });

        test('DEFAULT_SETTINGS がエクスポートされている', () => {
            expect(DEFAULT_SETTINGS).toBeDefined();
            expect(DEFAULT_SETTINGS.ai_provider).toBe('gemini');
        });
    });

    describe('migrateToSingleSettingsObject', () => {
        test('既に移行済みの場合は false を返す', async () => {
            mockStorage[SETTINGS_MIGRATED_KEY] = true;
            const result = await migrateToSingleSettingsObject([]);
            expect(result).toBe(false);
        });

        test('初回移行時に true を返す', async () => {
            mockStorage['obsidian_port'] = '27123';
            mockStorage['ai_provider'] = 'gemini';
            mockStorage[SETTINGS_MIGRATED_KEY] = undefined;

            const result = await migrateToSingleSettingsObject(['obsidian_port', 'ai_provider']);
            expect(result).toBe(true);
            expect(mockStorage[SETTINGS_MIGRATED_KEY]).toBe(true);
        });

        test('ストレージが空の場合はデフォルト設定で初期化する', async () => {
            const result = await migrateToSingleSettingsObject([]);
            expect(result).toBe(true);
        });
    });

    describe('getSettings', () => {
        const mockGetEncryptionKey = vi.fn(async () => 'mock_key' as unknown as CryptoKey);
        const mockRunMigration = vi.fn(async () => false);

        test('キャッシュが有効な場合はキャッシュを返す', async () => {
            mockStorage['settings'] = { ai_provider: 'gemini' };
            mockStorage[SETTINGS_MIGRATED_KEY] = true;

            await getSettings(mockGetEncryptionKey, mockRunMigration, ['ai_provider'], 'obsidian_api_key');
            const result = await getSettings(mockGetEncryptionKey, mockRunMigration, ['ai_provider'], 'obsidian_api_key');

            expect(result.ai_provider).toBe('gemini');
        });

        test('移行済み設定を取得する', async () => {
            mockStorage['settings'] = { ai_provider: 'openai', obsidian_port: '27123' };
            mockStorage[SETTINGS_MIGRATED_KEY] = true;

            const result = await getSettings(mockGetEncryptionKey, mockRunMigration, ['ai_provider', 'obsidian_port'], 'obsidian_api_key');

            expect(result.ai_provider).toBe('openai');
            expect(result.obsidian_port).toBe('27123');
        });

        test('暗号化されたAPIキーを復号する', async () => {
            const encValue = { ciphertext: 'enc_secret', iv: 'iv' };
            mockStorage['settings'] = { ai_provider: 'gemini', obsidian_api_key: encValue };
            mockStorage[SETTINGS_MIGRATED_KEY] = true;

            const result = await getSettings(mockGetEncryptionKey, mockRunMigration, ['ai_provider', 'obsidian_api_key'], 'obsidian_api_key');

            expect(result.obsidian_api_key).toBe('secret');
        });

        test('復号失敗時は空文字にフォールバックする', async () => {
            decryptApiKey.mockRejectedValueOnce(new Error('Decryption failed'));

            const encValue = { ciphertext: 'bad_enc', iv: 'iv' };
            mockStorage['settings'] = { ai_provider: 'gemini', obsidian_api_key: encValue };
            mockStorage[SETTINGS_MIGRATED_KEY] = true;

            const result = await getSettings(
                mockGetEncryptionKey, mockRunMigration,
                ['ai_provider', 'obsidian_api_key'], 'obsidian_api_key'
            );

            expect(result.obsidian_api_key).toBe('');
        });

        test('暗号化されていないAPIキーはそのまま返す', async () => {
            mockStorage['settings'] = { ai_provider: 'gemini', obsidian_api_key: 'plain_key' };
            mockStorage[SETTINGS_MIGRATED_KEY] = true;

            const result = await getSettings(
                mockGetEncryptionKey, mockRunMigration,
                ['ai_provider', 'obsidian_api_key'], 'obsidian_api_key'
            );

            expect(result.obsidian_api_key).toBe('plain_key');
        });

        test('旧方式: マイグレーションが必要な場合', async () => {
            mockStorage['ai_provider'] = 'gemini';
            mockRunMigration.mockResolvedValueOnce(true);

            const result = await getSettings(mockGetEncryptionKey, mockRunMigration, ['ai_provider'], 'obsidian_api_key');

            expect(mockRunMigration).toHaveBeenCalled();
            expect(result.ai_provider).toBe('gemini');
        });
    });

    describe('saveSettings', () => {
        const mockGetEncryptionKey = vi.fn(async () => 'mock_key' as unknown as CryptoKey);

        test('APIキーを暗号化して保存する', async () => {
            const settings = { ai_provider: 'gemini', obsidian_api_key: 'my_secret_key' };

            await saveSettings(settings, mockGetEncryptionKey);

            expect(encryptApiKey).toHaveBeenCalledWith('my_secret_key', 'mock_key');
        });

        test('空のAPIキーは暗号化しない', async () => {
            const settings = { ai_provider: 'gemini', obsidian_api_key: '' };

            await saveSettings(settings, mockGetEncryptionKey);

            expect(encryptApiKey).not.toHaveBeenCalled();
        });

        test('APIキー以外のフィールドはそのまま保存される', async () => {
            const settings = { ai_provider: 'openai', obsidian_port: '27123' };

            await saveSettings(settings, mockGetEncryptionKey);

            // withOptimisticLock が呼ばれることを確認
            expect(withOptimisticLock).toHaveBeenCalled();
        });

        test('キャッシュがクリアされる', async () => {
            const settings = { ai_provider: 'gemini' };

            await saveSettings(settings, mockGetEncryptionKey);

            // saveSettings 実行後、withOptimisticLock が呼ばれることを確認
            expect(withOptimisticLock).toHaveBeenCalled();
        });

        test('allowedUrls 更新オプションが有効な場合', async () => {
            const settings = { ai_provider: 'gemini' };
            const mockBuildUrls = vi.fn(() => new Set(['https://example.com']));
            const mockComputeHash = vi.fn(() => 'hash123');

            mockStorage['settings'] = { ai_provider: 'gemini' };

            await saveSettings(
                settings, mockGetEncryptionKey, true,
                mockBuildUrls, mockComputeHash,
                'allowed_urls', 'allowed_urls_hash'
            );

            expect(mockBuildUrls).toHaveBeenCalled();
            expect(mockComputeHash).toHaveBeenCalled();
        });
    });

    describe('clearSettingsCache', () => {
        test('例外を投げずに実行する', () => {
            expect(() => clearSettingsCache()).not.toThrow();
        });

        test('キャッシュをクリア後に再取得が発生する', async () => {
            mockStorage['settings'] = { ai_provider: 'gemini' };
            mockStorage[SETTINGS_MIGRATED_KEY] = true;

            const mockGetKey = vi.fn(async () => 'key' as unknown as CryptoKey);
            const mockMigration = vi.fn(async () => false);

            // 最初の取得
            await getSettings(mockGetKey, mockMigration, ['ai_provider'], 'obsidian_api_key');

            // キャッシュクリア
            clearSettingsCache();

            // 再取得 (新しいストレージアクセスが発生)
            mockStorage['settings'] = { ai_provider: 'openai' };
            const result = await getSettings(mockGetKey, mockMigration, ['ai_provider'], 'obsidian_api_key');

            expect(result.ai_provider).toBe('openai');
        });
    });
});
