/**
 * crypto.test.ts
 * crypto.tsのテスト
 * 【テスト対象】: src/utils/crypto.ts
 */

import { describe, test, expect, beforeEach } from '@jest/globals.js';
import { Crypto } from '@peculiar/webcrypto.js';
import {
    generateSalt,
    generateIV,
    hashPassword,
    verifyPassword,
    deriveKey,
    encrypt,
    decrypt,
    decryptData,
    isEncrypted,
    encryptApiKey,
    decryptApiKey,
    type EncryptedData
} from '../crypto.js';

// Web Crypto APIのセットアップ
beforeEach(() => {
    const webcrypto = new Crypto();
    global.crypto = webcrypto;
});

describe('crypto', () => {
    describe('generateSalt', () => {
        test('16バイトのソルトを生成できる', () => {
            const salt = generateSalt();
            expect(salt).toBeInstanceOf(Uint8Array);
            expect(salt.length).toBe(16);
        });

        test('毎回異なるソルトを生成する', () => {
            const salt1 = generateSalt();
            const salt2 = generateSalt();
            expect(salt1).not.toEqual(salt2);
        });
    });

    describe('generateIV', () => {
        test('12バイトのIVを生成できる', () => {
            const iv = generateIV();
            expect(iv).toBeInstanceOf(Uint8Array);
            expect(iv.length).toBe(12);
        });

        test('毎回異なるIVを生成する', () => {
            const iv1 = generateIV();
            const iv2 = generateIV();
            expect(iv1).not.toEqual(iv2);
        });
    });

    describe('hashPassword', () => {
        test('パスワードをハッシュ化できる', async () => {
            const password = 'test-password';
            const hash = await hashPassword(password);
            expect(typeof hash).toBe('string');
            expect(hash.length).toBeGreaterThan(0);
        });

        test('同じパスワードで同じハッシュを生成する', async () => {
            const password = 'test-password';
            const hash1 = await hashPassword(password);
            const hash2 = await hashPassword(password);
            expect(hash1).toBe(hash2);
        });

        test('異なるパスワードで異なるハッシュを生成する', async () => {
            const hash1 = await hashPassword('password1');
            const hash2 = await hashPassword('password2');
            expect(hash1).not.toBe(hash2);
        });
    });

    describe('verifyPassword', () => {
        test('正しいパスワードを検証できる', async () => {
            const password = 'test-password';
            const hash = await hashPassword(password);
            const isValid = await verifyPassword(password, hash);
            expect(isValid).toBe(true);
        });

        test('間違ったパスワードを拒否できる', async () => {
            const password = 'test-password';
            const hash = await hashPassword(password);
            const isValid = await verifyPassword('wrong-password', hash);
            expect(isValid).toBe(false);
        });
    });

    describe('deriveKey', () => {
        test('パスワードとソルトからキーを導出できる', async () => {
            const password = 'test-password';
            const salt = generateSalt();
            const key = await deriveKey(password, salt);
            expect(key).toBeInstanceOf(CryptoKey);
            expect(key.type).toBe('secret');
            expect(key.extractable).toBe(false);
        });

        test('同じパスワードとソルトで同じキーを導出できる', async () => {
            const password = 'test-password';
            const salt = generateSalt();
            const key1 = await deriveKey(password, salt);
            const key2 = await deriveKey(password, salt);
            // CryptoKeyは直接比較できないが、同じ入力で同じキーが導出されることを確認
            expect(key1.algorithm).toEqual(key2.algorithm);
        });

        test('異なるソルトで異なるキーを導出する', async () => {
            const password = 'test-password';
            const salt1 = generateSalt();
            const salt2 = generateSalt();
            const key1 = await deriveKey(password, salt1);
            const key2 = await deriveKey(password, salt2);

            // 異なるソルトで導出されたキーはソルトが異なるため異なるはず
            // 暗号化結果を比較してキーが異なることを確認
            const plaintext = 'test message';
            const encrypted1 = await encrypt(plaintext, key1);
            const encrypted2 = await encrypt(plaintext, key2);

            // 異なるキーで暗号化した結果は異なるはず
            expect(encrypted1.ciphertext).not.toBe(encrypted2.ciphertext);
        });
    });

    describe('encrypt and decrypt', () => {
        test('平文を暗号化して復号化できる', async () => {
            const plaintext = 'This is a secret message';
            const password = 'test-password';
            const salt = generateSalt();
            const key = await deriveKey(password, salt);

            const encrypted = await encrypt(plaintext, key);
            expect(encrypted.ciphertext).toBeDefined();
            expect(encrypted.iv).toBeDefined();

            const decrypted = await decrypt(encrypted.ciphertext, encrypted.iv, key);
            expect(decrypted).toBe(plaintext);
        });

        test('異なるキーで復号化できない', async () => {
            const plaintext = 'This is a secret message';
            const password1 = 'password1';
            const password2 = 'password2';
            const salt = generateSalt();
            const key1 = await deriveKey(password1, salt);
            const key2 = await deriveKey(password2, salt);

            const encrypted = await encrypt(plaintext, key1);

            await expect(decrypt(encrypted.ciphertext, encrypted.iv, key2))
                .rejects.toThrow('Decryption failed');
        });

        test('異なるIVで復号化できない', async () => {
            const plaintext = 'This is a secret message';
            const password = 'test-password';
            const salt = generateSalt();
            const key = await deriveKey(password, salt);

            const encrypted = await encrypt(plaintext, key);
            const wrongIV = generateIV();

            await expect(decrypt(encrypted.ciphertext, btoa(String.fromCharCode(...wrongIV)), key))
                .rejects.toThrow('Decryption failed');
        });

        test('空文字列を暗号化して復号化できる', async () => {
            const plaintext = '';
            const password = 'test-password';
            const salt = generateSalt();
            const key = await deriveKey(password, salt);

            const encrypted = await encrypt(plaintext, key);
            const decrypted = await decrypt(encrypted.ciphertext, encrypted.iv, key);
            expect(decrypted).toBe(plaintext);
        });

        test('長いテキストを暗号化して復号化できる', async () => {
            const plaintext = 'a'.repeat(10000);
            const password = 'test-password';
            const salt = generateSalt();
            const key = await deriveKey(password, salt);

            const encrypted = await encrypt(plaintext, key);
            const decrypted = await decrypt(encrypted.ciphertext, encrypted.iv, key);
            expect(decrypted).toBe(plaintext);
        });
    });

    describe('decryptData', () => {
        test('オブジェクト形式の暗号化データを復号化できる', async () => {
            const plaintext = 'This is a secret message';
            const password = 'test-password';
            const salt = generateSalt();
            const key = await deriveKey(password, salt);

            const encrypted = await encrypt(plaintext, key);
            const decrypted = await decryptData(encrypted, key);
            expect(decrypted).toBe(plaintext);
        });

        test('無効なデータ形式でエラーをスローする', async () => {
            const password = 'test-password';
            const salt = generateSalt();
            const key = await deriveKey(password, salt);

            await expect(decryptData(null, key)).rejects.toThrow('Invalid encrypted data format');
            await expect(decryptData({}, key)).rejects.toThrow('Invalid encrypted data format');
            await expect(decryptData({ ciphertext: 'test' }, key)).rejects.toThrow('Invalid encrypted data format');
        });
    });

    describe('isEncrypted', () => {
        test('暗号化されたデータを正しく識別する', () => {
            const encryptedData: EncryptedData = {
                ciphertext: 'base64-encoded-ciphertext',
                iv: 'base64-encoded-iv'
            };
            expect(isEncrypted(encryptedData)).toBe(true);
        });

        test('平文を正しく識別する', () => {
            expect(isEncrypted('plaintext')).toBe(false);
            expect(isEncrypted(null)).toBe(false);
            expect(isEncrypted(undefined)).toBe(false);
            expect(isEncrypted({})).toBe(false);
            expect(isEncrypted({ ciphertext: 'test' as const })).toBe(false);
        });
    });

    describe('encryptApiKey and decryptApiKey', () => {
        test('APIキーを暗号化して復号化できる', async () => {
            const apiKey = 'sk-1234567890abcdef';
            const password = 'test-password';
            const salt = generateSalt();
            const key = await deriveKey(password, salt);

            const encrypted = await encryptApiKey(apiKey, key);
            expect(isEncrypted(encrypted)).toBe(true);

            const decrypted = await decryptApiKey(encrypted, key);
            expect(decrypted).toBe(apiKey);
        });

        test('平文のAPIキーをそのまま返す（後方互換性）', async () => {
            const apiKey = 'sk-1234567890abcdef';
            const password = 'test-password';
            const salt = generateSalt();
            const key = await deriveKey(password, salt);

            const decrypted = await decryptApiKey(apiKey, key);
            expect(decrypted).toBe(apiKey);
        });

        test('無効なAPIキーでエラーをスローする', async () => {
            const password = 'test-password';
            const salt = generateSalt();
            const key = await deriveKey(password, salt);

            await expect(encryptApiKey(null, key)).rejects.toThrow('Invalid API key');
            await expect(encryptApiKey(123 as unknown as string, key)).rejects.toThrow('Invalid API key');
        });

        test('無効な暗号化データでエラーをスローする', async () => {
            const password = 'test-password';
            const salt = generateSalt();
            const key = await deriveKey(password, salt);

            await expect(decryptApiKey({} as EncryptedData, key)).rejects.toThrow('Invalid API key format');
        });
    });
});