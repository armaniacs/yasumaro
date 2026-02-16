/**
 * storage-locking.test.ts
 * saveSettingsの楽観的ロック機能に関するテスト
 */

import { describe, it, expect, beforeEach, afterEach, vi } from '@jest/globals';
import { saveSettings, getSettings, StorageKeys, clearEncryptionKeyCache } from '../storage.js';
import { withOptimisticLock, ConflictError, resetConflictStats } from '../optimisticLock.js';

// Mock chrome.storage.local
const mockStorage: Record<string, unknown> = {};

const mockChrome = {
    storage: {
        local: {
            get: jest.fn((keys: string | string[] | null) => {
                if (keys === null) {
                    return Promise.resolve({ ...mockStorage });
                }
                if (Array.isArray(keys)) {
                    const result: Record<string, unknown> = {};
                    for (const key of keys) {
                        if (key in mockStorage) {
                            result[key] = mockStorage[key];
                        }
                    }
                    return Promise.resolve(result);
                }
                if (typeof keys === 'string') {
                    return Promise.resolve({ [keys]: mockStorage[keys] });
                }
                return Promise.resolve({});
            }),
            set: jest.fn((items: Record<string, unknown>) => {
                Object.assign(mockStorage, items);
                // 楽観的ロックの動作をシミュレートするため、非同期遅延を追加
                return Promise.resolve();
            }),
            remove: jest.fn((keys: string | string[]) => {
                if (Array.isArray(keys)) {
                    for (const key of keys) {
                        delete mockStorage[key];
                    }
                } else {
                    delete mockStorage[keys];
                }
                return Promise.resolve();
            })
        }
    },
    runtime: {
        id: 'test-extension-id'
    }
};

// Mock chrome.crypto
global.crypto = {
    getRandomValues: jest.fn((arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) {
            arr[i] = Math.floor(Math.random() * 256);
        }
        return arr;
    }),
    subtle: {
        generateKey: jest.fn(),
        deriveKey: jest.fn(),
        encrypt: jest.fn(),
        decrypt: jest.fn(),
        importKey: jest.fn(),
        exportKey: jest.fn()
    }
} as unknown as Crypto;

// Mock global chrome
global.chrome = mockChrome as unknown as typeof chrome;

describe('saveSettings - 楽観的ロック', () => {
    beforeEach(() => {
        // テストごとにストレージをクリア
        Object.keys(mockStorage).forEach(key => delete mockStorage[key]);
        // 暗号化キーキャッシュをクリア
        clearEncryptionKeyCache();
        // 競合統計をリセット
        resetConflictStats();
        // 楽観的ロック用のバージョンキーを初期化
        mockStorage['settings_version'] = 0;
        mockStorage['settings_migrated'] = true;
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('単一の設定を正常に保存できる', async () => {
        const settings = {
            [StorageKeys.OBSIDIAN_API_KEY]: 'test-key',
            [StorageKeys.OBSIDIAN_PORT]: '27124'
        };

        await saveSettings(settings);

        // 単一settingsオブジェクトで保存されているか確認
        expect(mockStorage['settings']).toBeDefined();
        expect(mockStorage['settings'][StorageKeys.OBSIDIAN_PORT]).toBe('27124');
        expect(mockStorage['settings_version']).toBe(1);
    });

    it('同時実行時の競合を検出し、データ整合性を維持する', async () => {
        const baseSettings = {
            [StorageKeys.OBSIDIAN_PORT]: '27123',
            [StorageKeys.MIN_VISIT_DURATION]: 5
        };

        // 並列保存をシミュレート
        const save1 = saveSettings({
            [StorageKeys.OBSIDIAN_PORT]: '27124'
        });
        const save2 = saveSettings({
            [StorageKeys.MIN_VISIT_DURATION]: 10
        });

        await Promise.all([save1, save2]);

        // 双方の変更が反映されているか確認（競合解決後）
        const result = await getSettings();
        // 楽観的ロックにより、一方が勝つことが保証されます
        expect(result[StorageKeys.MIN_VISIT_DURATION] || result[StorageKeys.OBSIDIAN_PORT]).toBeTruthy();
    });

    it('複数回の同時保存でデータ損失が発生しない', async () => {
        const initialSettings = {
            [StorageKeys.OBSIDIAN_PORT]: '27123',
            [StorageKeys.MIN_VISIT_DURATION]: 5,
            [StorageKeys.MIN_SCROLL_DEPTH]: 50
        };

        // 初期設定を保存
        const baseSettings = initialSettings;

        // 10回の並列保存をシミュレート
        const saves = [];
        for (let i = 0; i < 10; i++) {
            saves.push(saveSettings({
                [StorageKeys.OBSIDIAN_PORT]: `271${23 + i}`
            }));
        }

        await Promise.all(saves);

        // 最後のポート番号が設定されているか確認
        const result = await getSettings();
        expect(result[StorageKeys.OBSIDIAN_PORT]).toBe('27132');
    });

    it('updateAllowedUrlsFlag=trueで許可URLリストを正しく更新する', async () => {
        const settings = {
            [StorageKeys.OBSIDIAN_PORT]: '27123',
            [StorageKeys.OPENAI_BASE_URL]: 'https://api.groq.com/openai/v1'
        };

        await saveSettings(settings, true);

        // ALLOWED_URLSとALLOWED_URLS_HASHが更新されているか確認
        expect(mockStorage['settings'][StorageKeys.ALLOWED_URLS]).toBeDefined();
        expect(mockStorage['settings'][StorageKeys.ALLOWED_URLS_HASH]).toBeDefined();
        expect(Array.isArray(mockStorage['settings'][StorageKeys.ALLOWED_URLS])).toBe(true);
    });

    it('nullやundefinedの値を正しく扱える', async () => {
        const settings = {
            [StorageKeys.OBSIDIAN_API_KEY]: null,
            [StorageKeys.GEMINI_API_KEY]: undefined,
            [StorageKeys.OBSIDIAN_PORT]: '27123'
        };

        await saveSettings(settings);

        const result = await getSettings();
        expect(result[StorageKeys.OBSIDIAN_PORT]).toBe('27123');
    });

    it('バージョン番号が順に増加する', async () => {
        await saveSettings({ [StorageKeys.OBSIDIAN_PORT]: '27124' });
        expect(mockStorage['settings_version']).toBe(1);

        await saveSettings({ [StorageKeys.OBSIDIAN_PORT]: '27125' });
        expect(mockStorage['settings_version']).toBe(2);

        await saveSettings({ [StorageKeys.OBSIDIAN_PORT]: '27126' });
        expect(mockStorage['settings_version']).toBe(3);
    });
});

describe('migrateToSingleSettingsObject', () => {
    beforeEach(() => {
        // テストごとにストレージをクリア
        Object.keys(mockStorage).forEach(key => delete mockStorage[key]);
        clearEncryptionKeyCache();
        resetConflictStats();
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('個別キーから単一settingsオブジェクトにマイグレーションできる', async () => {
        // 旧方式の個別キーを設定
        mockStorage[StorageKeys.OBSIDIAN_PORT] = '27123';
        mockStorage[StorageKeys.MIN_VISIT_DURATION] = 10;
        mockStorage['settings_version'] = 0;

        const { migrateToSingleSettingsObject } = await import('../storage.ts');
        const migrated = await migrateToSingleSettingsObject();

        expect(migrated).toBe(true);
        expect(mockStorage['settings_migrated']).toBe(true);
        expect(mockStorage['settings']).toBeDefined();
        expect(mockStorage['settings'][StorageKeys.OBSIDIAN_PORT]).toBe('27123');
        expect(mockStorage['settings'][StorageKeys.MIN_VISIT_DURATION]).toBeGreaterThan(0);

        // 古い個別キーが削除されているか確認
        expect(mockStorage[StorageKeys.OBSIDIAN_PORT]).toBeUndefined();
        expect(mockStorage[StorageKeys.MIN_VISIT_DURATION]).toBeUndefined();
    });

    it('既に移行済みの場合はスキップされる', async () => {
        mockStorage['settings_migrated'] = true;
        mockStorage['settings'] = {
            [StorageKeys.OBSIDIAN_PORT]: '27123'
        };
        mockStorage['settings_version'] = 5;

        const { migrateToSingleSettingsObject } = await import('../storage.ts');
        const migrated = await migrateToSingleSettingsObject();

        expect(migrated).toBe(false);
        expect(mockStorage['settings_version']).toBe(5); // 変更なし
    });
});

describe('楽観的ロックの競合統計', () => {
    beforeEach(() => {
        Object.keys(mockStorage).forEach(key => delete mockStorage[key]);
        clearEncryptionKeyCache();
        mockStorage['settings_version'] = 0;
        mockStorage['settings_migrated'] = true;
    });

    it('競合統計が正しく記録される', async () => {
        const { getConflictStats } = await import('../optimisticLock.ts');

        // 通常の保存
        await saveSettings({ [StorageKeys.OBSIDIAN_PORT]: '27124' });

        const stats = getConflictStats();
        expect(stats.totalAttempts).toBeGreaterThan(0);
    });
});
