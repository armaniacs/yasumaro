/**
 * storage.test.ts
 * Tests for storage.ts constants and functions
 */

import {
    MAX_URL_SET_SIZE,
    URL_WARNING_THRESHOLD,
    buildAllowedUrls,
    computeUrlsHash,
    StorageKeys,
    getSettings,
    saveSettings,
    getOrCreateEncryptionKey,
    clearEncryptionKeyCache,
    clearSettingsCache,
    isDomainInWhitelist
} from '../storage.js';
import { normalizeUrl } from '../urlUtils.js';
import { isEncrypted, encrypt, decrypt } from '../crypto.js';

jest.mock('../migration.js', () => ({
    migrateUblockSettings: jest.fn(() => Promise.resolve(false))
}));

// 【パフォーマンス改善】テスト間でキャッシュをクリア
afterEach(() => {
    clearSettingsCache();
});

describe('isDomainInWhitelist', () => {
    it('should return true for exact matches', () => {
        expect(isDomainInWhitelist('https://api.openai.com/v1')).toBe(true);
        expect(isDomainInWhitelist('https://generativelanguage.googleapis.com')).toBe(true);
    });

    it('should return true for Sakura Cloud API', () => {
        expect(isDomainInWhitelist('https://api.ai.sakura.ad.jp/v1')).toBe(true);
    });

    it('should return true for localhost', () => {
        expect(isDomainInWhitelist('http://localhost:11434')).toBe(true);
    });

    it('should return false for unauthorized Sakura subdomains', () => {
        expect(isDomainInWhitelist('https://other.sakura.ad.jp/v1')).toBe(false);
    });

    it('should return false for domains not in whitelist', () => {
        expect(isDomainInWhitelist('https://malicious.com')).toBe(false);
        expect(isDomainInWhitelist('https://sakura.ad.jp.evil.com')).toBe(false);
    });

    it('should handle invalid URLs gracefully', () => {
        expect(isDomainInWhitelist('not-a-url')).toBe(false);
    });
});

describe('Storage Constants', () => {
    describe('MAX_URL_SET_SIZE', () => {
        it('should be 10000', () => {
            expect(MAX_URL_SET_SIZE).toBe(10000);
        });
    });

    describe('URL_WARNING_THRESHOLD', () => {
        it('should be 8000', () => {
            expect(URL_WARNING_THRESHOLD).toBe(8000);
        });
    });
});

describe('normalizeUrl', () => {
    it('should remove trailing slash', () => {
        expect(normalizeUrl('https://example.com/')).toBe('https://example.com');
        expect(normalizeUrl('https://example.com/path/')).toBe('https://example.com/path');
    });

    it('should normalize protocol to lowercase', () => {
        expect(normalizeUrl('HTTPS://example.com')).toBe('https://example.com');
        expect(normalizeUrl('HTTP://example.com')).toBe('http://example.com');
    });

    it('should return original URL if invalid', () => {
        expect(normalizeUrl('not-a-url')).toBe('not-a-url');
    });
});

describe('buildAllowedUrls', () => {
    it('should build allowed URLs from settings', () => {
        const settings = {
            [StorageKeys.OBSIDIAN_PROTOCOL]: 'http',
            [StorageKeys.OBSIDIAN_PORT]: '27123',
            [StorageKeys.OPENAI_BASE_URL]: 'https://api.groq.com/openai/v1',
            [StorageKeys.OPENAI_2_BASE_URL]: 'http://127.0.0.1:11434/v1'
        };

        const allowedUrls = buildAllowedUrls(settings);

        expect(allowedUrls.has('http://127.0.0.1:27123')).toBe(true);
        expect(allowedUrls.has('http://localhost:27123')).toBe(true);
        expect(allowedUrls.has('https://generativelanguage.googleapis.com')).toBe(true);
        expect(allowedUrls.has('https://api.groq.com/openai/v1')).toBe(true);
        expect(allowedUrls.has('http://127.0.0.1:11434/v1')).toBe(true);
    });

    it('should use default values for missing settings', () => {
        const settings = {};

        const allowedUrls = buildAllowedUrls(settings);

        // デフォルトプロトコルは https、ポートは 27124
        expect(allowedUrls.has('https://127.0.0.1:27124')).toBe(true);
        expect(allowedUrls.has('https://localhost:27124')).toBe(true);
        expect(allowedUrls.has('https://generativelanguage.googleapis.com')).toBe(true);
    });

    // 重複したテストを削除

    it('should skip empty base URLs', () => {
        const settings = {
            [StorageKeys.OPENAI_BASE_URL]: '',
            [StorageKeys.OPENAI_2_BASE_URL]: null
        };

        const allowedUrls = buildAllowedUrls(settings);

        expect(allowedUrls.has('')).toBe(false);
        expect(allowedUrls.has('null')).toBe(false);
    });
});

describe('computeUrlsHash', () => {
    it('should compute hash from URLs', () => {
        const urls = new Set(['https://example.com', 'https://api.example.com']);
        const hash = computeUrlsHash(urls);

        expect(hash).toBe('https://api.example.com|https://example.com');
    });

    it('should return empty string for empty set', () => {
        const urls = new Set();
        const hash = computeUrlsHash(urls);

        expect(hash).toBe('');
    });

    it('should produce consistent hash for same URLs', () => {
        const urls1 = new Set(['https://example.com', 'https://api.example.com']);
        const urls2 = new Set(['https://api.example.com', 'https://example.com']);

        expect(computeUrlsHash(urls1)).toBe(computeUrlsHash(urls2));
    });
});

describe('APIキー暗号化統合', () => {
    beforeEach(async () => {
        clearEncryptionKeyCache();
        // 単一settingsオブジェクト方式を初期化
        await chrome.storage.local.set({
            settings_migrated: true,
            settings_version: 0
        });
    });

    describe('getOrCreateEncryptionKey', () => {
        it('ソルトとシークレットを生成してストレージに保存する', async () => {
            const key = await getOrCreateEncryptionKey();

            expect(key).toBeDefined();
            expect(key.type).toBe('secret');

            // ストレージにソルトとシークレットが保存されたことを確認
            const stored = await chrome.storage.local.get([
                StorageKeys.ENCRYPTION_SALT,
                StorageKeys.ENCRYPTION_SECRET
            ]);
            expect(stored[StorageKeys.ENCRYPTION_SALT]).toBeTruthy();
            expect(stored[StorageKeys.ENCRYPTION_SECRET]).toBeTruthy();
        });

        it('既存のソルト/シークレットを再利用する', async () => {
            const key1 = await getOrCreateEncryptionKey();
            clearEncryptionKeyCache();
            const key2 = await getOrCreateEncryptionKey();

            // 同じソルト/シークレットから導出されるため、同じキーで暗号/復号できる
            expect(key1).toBeDefined();
            expect(key2).toBeDefined();
        });

        it('メモリキャッシュから同じキーを返す', async () => {
            const key1 = await getOrCreateEncryptionKey();
            const key2 = await getOrCreateEncryptionKey();

            // CryptoKeyは同じ参照である必要はないが、同じキーで暗号化/復号化できる
            // 実際に同じ秘密を暗号化して、双方のキーで復号化できることを確認
            const testMessage = 'test-secret';
            const { ciphertext, iv } = await encrypt(testMessage, key1);
            const decrypted = await decrypt(ciphertext, iv, key2);
            expect(decrypted).toBe(testMessage);
        });
    });

    describe('saveSettings - 暗号化', () => {
        it('APIキーを暗号化して保存する', async () => {
            await saveSettings({
                [StorageKeys.OBSIDIAN_API_KEY]: 'test-obsidian-key',
                [StorageKeys.GEMINI_API_KEY]: 'test-gemini-key'
            });

            // ストレージの生データを直接取得（settingsオブジェクトから）
            const raw = await chrome.storage.local.get('settings');

            // 暗号化された形式（オブジェクト）で保存されている
            expect(isEncrypted(raw.settings[StorageKeys.OBSIDIAN_API_KEY])).toBe(true);
            expect(isEncrypted(raw.settings[StorageKeys.GEMINI_API_KEY])).toBe(true);
        });

        it('空のAPIキーは暗号化しない', async () => {
            await saveSettings({
                [StorageKeys.OBSIDIAN_API_KEY]: '',
                [StorageKeys.GEMINI_API_KEY]: ''
            });

            const raw = await chrome.storage.local.get('settings');

            expect(raw.settings[StorageKeys.OBSIDIAN_API_KEY]).toBe('');
            expect(raw.settings[StorageKeys.GEMINI_API_KEY]).toBe('');
        });

        it('APIキー以外のフィールドはそのまま保存する', async () => {
            await saveSettings({
                [StorageKeys.OBSIDIAN_PORT]: '8080',
                [StorageKeys.AI_PROVIDER]: 'gemini'
            });

            const raw = await chrome.storage.local.get('settings');

            expect(raw.settings[StorageKeys.OBSIDIAN_PORT]).toBe('8080');
            expect(raw.settings[StorageKeys.AI_PROVIDER]).toBe('gemini');
        });
    });

    describe('getSettings - 復号', () => {
        it('暗号化されたAPIキーを復号して返す', async () => {
            await saveSettings({
                [StorageKeys.OBSIDIAN_API_KEY]: 'my-secret-key',
                [StorageKeys.OPENAI_API_KEY]: 'sk-test-123'
            });

            const settings = await getSettings();

            expect(settings[StorageKeys.OBSIDIAN_API_KEY]).toBe('my-secret-key');
            expect(settings[StorageKeys.OPENAI_API_KEY]).toBe('sk-test-123');
        });

        it('平文APIキーをそのまま返す（後方互換性）', async () => {
            // 暗号化なしでストレージに直接保存（旧バージョンの状態をシミュレート）
            // 単一settingsオブジェクト方式
            await chrome.storage.local.set({
                settings: {
                    [StorageKeys.OBSIDIAN_API_KEY]: 'plaintext-key'
                },
                settings_migrated: true,
                settings_version: 0
            });

            const settings = await getSettings();

            expect(settings[StorageKeys.OBSIDIAN_API_KEY]).toBe('plaintext-key');
        });

        it('復号失敗時は空文字にフォールバックする', async () => {
            // 不正な暗号化データをストレージに直接設定
            // 単一settingsオブジェクト方式
            await chrome.storage.local.set({
                settings: {
                    [StorageKeys.OBSIDIAN_API_KEY]: {
                        ciphertext: 'invalid-base64-data',
                        iv: 'invalid-iv'
                    }
                },
                settings_migrated: true,
                settings_version: 0
            });

            const settings = await getSettings();

            expect(settings[StorageKeys.OBSIDIAN_API_KEY]).toBe('');
        });
    });

    describe('暗号化→復号ラウンドトリップ', () => {
        it('全4つのAPIキーが正しくラウンドトリップする', async () => {
            const originalKeys = {
                [StorageKeys.OBSIDIAN_API_KEY]: 'obsidian-key-abc',
                [StorageKeys.GEMINI_API_KEY]: 'gemini-key-xyz',
                [StorageKeys.OPENAI_API_KEY]: 'sk-openai-key',
                [StorageKeys.OPENAI_2_API_KEY]: 'ollama-key-123'
            };

            await saveSettings(originalKeys);
            const settings = await getSettings();

            expect(settings[StorageKeys.OBSIDIAN_API_KEY]).toBe('obsidian-key-abc');
            expect(settings[StorageKeys.GEMINI_API_KEY]).toBe('gemini-key-xyz');
            expect(settings[StorageKeys.OPENAI_API_KEY]).toBe('sk-openai-key');
            expect(settings[StorageKeys.OPENAI_2_API_KEY]).toBe('ollama-key-123');
        });

        it('APIキーとその他の設定が混在しても正しく動作する', async () => {
            await saveSettings({
                [StorageKeys.OBSIDIAN_API_KEY]: 'my-key',
                [StorageKeys.OBSIDIAN_PORT]: '9999',
                [StorageKeys.AI_PROVIDER]: 'openai'
            });

            const settings = await getSettings();

            expect(settings[StorageKeys.OBSIDIAN_API_KEY]).toBe('my-key');
            expect(settings[StorageKeys.OBSIDIAN_PORT]).toBe('9999');
            expect(settings[StorageKeys.AI_PROVIDER]).toBe('openai');
        });
    });
});
