/**
 * storage-security.test.ts
 * 【セキュリティ修正】マスターパスワード機能のテスト
 * 【テスト対象】: src/utils/storage.ts のマスターパスワード関連関数
 */

// モックをインポート前に定義する必要がある
(global as any).crypto = {
    subtle: {},
    getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) {
            arr[i] = Math.floor(Math.random() * 256);
        }
        return arr;
    }
};

// Web Crypto APIのモック設定
const storageData: Record<string, any> = { settings_migrated: true };

// chromeのモック（インポート前に設定）
(global as any).chrome = {
    storage: {
        local: {
            get: jest.fn((keys, callback) => {
                const result: Record<string, any> = {};
                if (keys === null) {
                    Object.assign(result, storageData);
                } else if (Array.isArray(keys)) {
                    keys.forEach((key: string) => {
                        if (key in storageData) {
                            result[key] = storageData[key];
                        }
                    });
                } else if (typeof keys === 'string') {
                    if (keys in storageData) {
                        result[keys] = storageData[keys];
                    }
                }
                if (callback) {
                    callback(result);
                }
                return Promise.resolve(result);
            }),
            set: jest.fn((data: Record<string, any>, callback) => {
                Object.assign(storageData, data);
                if (callback) {
                    callback();
                }
                return Promise.resolve();
            }),
            remove: jest.fn((keys: string | string[], callback) => {
                if (Array.isArray(keys)) {
                    keys.forEach((key: string) => {
                        delete storageData[key];
                    });
                } else {
                    delete storageData[keys];
                }
                if (callback) {
                    callback();
                }
                return Promise.resolve();
            }),
            clear: jest.fn((callback) => {
                for (const key in storageData) {
                    delete storageData[key];
                }
                if (callback) {
                    callback();
                }
                return Promise.resolve();
            })
        },
        runtime: {
            id: 'test-extension-id',
            getURL: jest.fn(() => 'chrome-extension://test-extension-id/'),
            reconnect: jest.fn()
        }
    }
};

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { Crypto } from '@peculiar/webcrypto';
import {
    setMasterPassword,
    unlockWithPassword,
    lockSession,
    isMasterPasswordEnabled,
    isEncryptionLocked,
    changeMasterPassword,
    removeMasterPassword,
    clearEncryptionKeyCache,
    getOrCreateEncryptionKey
} from '../storage.js';
import { encryptApiKey, decryptApiKey, isEncrypted } from '../crypto.js';

// Web Crypto APIのモック設定
const webcrypto = new Crypto();

describe('Master Password Security', () => {
    beforeEach(async () => {
        // chromeモックを再設定（必要に応じて）
        (global as any).chrome = {
            storage: {
                local: {
                    get: jest.fn((keys, callback) => {
                        const result: Record<string, any> = {};
                        if (keys === null) {
                            Object.assign(result, storageData);
                        } else if (Array.isArray(keys)) {
                            keys.forEach((key: string) => {
                                if (key in storageData) {
                                    result[key] = storageData[key];
                                }
                            });
                        } else if (typeof keys === 'string') {
                            if (keys in storageData) {
                                result[keys] = storageData[keys];
                            }
                        }
                        if (callback) {
                            callback(result);
                        }
                        return Promise.resolve(result);
                    }),
                    set: jest.fn((data: Record<string, any>, callback) => {
                        Object.assign(storageData, data);
                        if (callback) {
                            callback();
                        }
                        return Promise.resolve();
                    }),
                    remove: jest.fn((keys: string | string[], callback) => {
                        if (Array.isArray(keys)) {
                            keys.forEach((key: string) => {
                                delete storageData[key];
                            });
                        } else {
                            delete storageData[keys];
                        }
                        if (callback) {
                            callback();
                        }
                        return Promise.resolve();
                    }),
                    clear: jest.fn((callback) => {
                        for (const key in storageData) {
                            delete storageData[key];
                        }
                        if (callback) {
                            callback();
                        }
                        return Promise.resolve();
                    })
                },
            },
            runtime: {
                id: 'test-extension-id',
                getURL: jest.fn(() => 'chrome-extension://test-extension-id/'),
                reconnect: jest.fn()
            }
        };

        // global.cryptoの設定
        global.crypto = webcrypto;
        clearEncryptionKeyCache();
        // テストごとにストレージをクリア
        for (const key in storageData) {
            delete storageData[key];
        }
        storageData.settings_migrated = true;
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('setMasterPassword', () => {
        test('マスターパスワードを設定できる', async () => {
            const password = 'test-password-123';
            const result = await setMasterPassword(password);

            expect(result).toBe(true);

            const data = await chrome.storage.local.get([
                'master_password_enabled',
                'master_password_salt',
                'master_password_hash',
                'is_locked'
            ]);

            expect(data.master_password_enabled).toBe(true);
            expect(data.master_password_salt).toBeTruthy();
            expect(data.master_password_hash).toBeTruthy();
            expect(data.is_locked).toBe(true);
        });

        test('短すぎるパスワードは設定できない', async () => {
            await expect(setMasterPassword('short')).rejects.toThrow('Password must be at least 8 characters');
        });

        test('空文字列のパスワードは設定できない', async () => {
            await expect(setMasterPassword('')).rejects.toThrow('Password must be at least 8 characters');
        });

        test('同じパスワードで異なるハッシュが生成される（ランダムソルト）', async () => {
            await setMasterPassword('password123');
            const hash1 = (await chrome.storage.local.get('master_password_hash')).master_password_hash;

            clearEncryptionKeyCache();
            for (const key in storageData) {
                delete storageData[key];
            }
            storageData.settings_migrated = true;
            await setMasterPassword('password123');
            const hash2 = (await chrome.storage.local.get('master_password_hash')).master_password_hash;

            expect(hash1).not.toBe(hash2);
        });
    });

    describe('isMasterPasswordEnabled', () => {
        test('マスターパスワード未設定時はfalseを返す', async () => {
            const enabled = await isMasterPasswordEnabled();
            expect(enabled).toBe(false);
        });

        test('マスターパスワード設定後はtrueを返す', async () => {
            await setMasterPassword('password123');
            const enabled = await isMasterPasswordEnabled();
            expect(enabled).toBe(true);
        });
    });

    describe('isEncryptionLocked', () => {
        test('マスターパスワード未設定時はfalse', async () => {
            const locked = await isEncryptionLocked();
            expect(locked).toBe(false);
        });

        test('マスターパスワード設定後はtrue（ロック状態）', async () => {
            await setMasterPassword('password123');
            const locked = await isEncryptionLocked();
            expect(locked).toBe(true);
        });
    });

    describe('unlockWithPassword', () => {
        test('正しいパスワードでアンロックできる', async () => {
            const password = 'test-password-123';
            await setMasterPassword(password);

            const unlocked = await unlockWithPassword(password);
            expect(unlocked).toBe(true);

            const locked = await isEncryptionLocked();
            expect(locked).toBe(false);
        });

        test('間違ったパスワードではアンロックできない', async () => {
            await setMasterPassword('correct-password');

            const unlocked = await unlockWithPassword('wrong-password');
            expect(unlocked).toBe(false);

            const locked = await isEncryptionLocked();
            expect(locked).toBe(true);
        });

        test('マスターパスワード未設定時はエラー', async () => {
            await expect(unlockWithPassword('password')).rejects.toThrow('Master password not enabled');
        });
    });

    describe('lockSession', () => {
        test('セッションをロックできる', async () => {
            const password = 'test-password-123';
            await setMasterPassword(password);
            await unlockWithPassword(password);

            let locked = await isEncryptionLocked();
            expect(locked).toBe(false);

            lockSession();

            locked = await isEncryptionLocked();
            expect(locked).toBe(true);
        });
    });

    describe('changeMasterPassword', () => {
        test('正しい旧パスワードで変更できる', async () => {
            const oldPassword = 'old-password-123';
            const newPassword = 'new-password-456';
            await setMasterPassword(oldPassword);

            const changed = await changeMasterPassword(oldPassword, newPassword);
            expect(changed).toBe(true);

            // 新しいパスワードでアンロック可能
            const unlocked = await unlockWithPassword(newPassword);
            expect(unlocked).toBe(true);
        });

        test('間違った旧パスワードでは変更できない', async () => {
            await setMasterPassword('correct-password');

            const changed = await changeMasterPassword('wrong-password', 'new-password');
            expect(changed).toBe(false);
        });
    });

    describe('getOrCreateEncryptionKey', () => {
        test('マスターパスワード設定済み時はロックエラーをスロー', async () => {
            await setMasterPassword('password123');

            await expect(getOrCreateEncryptionKey()).rejects.toThrow('ENCRYPTION_LOCKED: Master password required');
        });

        test('アンロック後にキーを取得できる', async () => {
            const password = 'test-password-123';
            await setMasterPassword(password);
            await unlockWithPassword(password);

            const key = await getOrCreateEncryptionKey();
            expect(key).toBeDefined();
            expect(key.type).toBe('secret');
        });
    });

    describe('API Key Encryption with Master Password', () => {
        test('マスターパスワードでAPIキーを暗号化・復号化できる', async () => {
            const password = 'test-password-123';
            const apiKey = 'sk-1234567890abcdef';

            await setMasterPassword(password);
            await unlockWithPassword(password);

            const key = await getOrCreateEncryptionKey();
            const encrypted = await encryptApiKey(apiKey, key);

            expect(isEncrypted(encrypted)).toBe(true);

            const decrypted = await decryptApiKey(encrypted, key);
            expect(decrypted).toBe(apiKey);
        });

        test('異なるパスワードで導出したキーでは復号化できない', async () => {
            const apiKey = 'sk-1234567890abcdef';

            await setMasterPassword('password1');
            await unlockWithPassword('password1');
            const key1 = await getOrCreateEncryptionKey();
            const encrypted = await encryptApiKey(apiKey, key1);

            // 新しいパスワードに変更して別のキーを取得
            clearEncryptionKeyCache();
            await changeMasterPassword('password1', 'password2');
            await unlockWithPassword('password2');
            const key2 = await getOrCreateEncryptionKey();

            await expect(decryptApiKey(encrypted, key2)).rejects.toThrow();
        });
    });

    describe('removeMasterPassword', () => {
        test('マスターパスワードを削除できる', async () => {
            await setMasterPassword('password123');
            expect(await isMasterPasswordEnabled()).toBe(true);

            await removeMasterPassword();

            expect(await isMasterPasswordEnabled()).toBe(false);
            expect(await isEncryptionLocked()).toBe(false);

            const data = await chrome.storage.local.get([
                'master_password_enabled',
                'master_password_salt',
                'master_password_hash',
                'is_locked'
            ]);

            expect(data.master_password_enabled).toBeFalsy();
            expect(data.master_password_salt).toBeFalsy();
            expect(data.master_password_hash).toBeFalsy();
            expect(data.is_locked).toBeFalsy();
        });
    });

    describe('Security Requirements', () => {
        test('パスワードに対してソルトが使用されている（同一パスワードで異なるハッシュ）', async () => {
            const password = 'same-password';

            await setMasterPassword(password);
            const hash1 = (await chrome.storage.local.get('master_password_hash')).master_password_hash;

            clearEncryptionKeyCache();
            for (const key in storageData) {
                delete storageData[key];
            }
            storageData.settings_migrated = true;
            await setMasterPassword(password);
            const hash2 = (await chrome.storage.local.get('master_password_hash')).master_password_hash;

            expect(hash1).not.toBe(hash2);
        });

        test('パスワードハッシュは保存されない（PBKDF2ハッシュが保存される）', async () => {
            const password = 'password123';
            await setMasterPassword(password);

            const data = await chrome.storage.local.get(null);
            // 保存されているデータにパスワードそのものが含まれていないことを確認
            Object.values(data).forEach((value: any) => {
                expect(value).not.toBe(password);
            });
        });

        test('暗号化キーはストレージに保存されていない', async () => {
            await setMasterPassword('password123');
            await unlockWithPassword('password123');

            await getOrCreateEncryptionKey();

            const data = await chrome.storage.local.get(null);
            expect(data.encryption_key).toBeFalsy();
        });
    });
});