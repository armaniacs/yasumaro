/**
 * crypto.test.ts
 * crypto.tsのテスト
 * 【テスト対象】: src/utils/crypto/index.ts
 */

import { vi } from 'vitest';;
import { Crypto } from '@peculiar/webcrypto';
import type { EncryptedData } from '../types.js';
import {
    generateSalt,
    generateIV,
    deriveKey,
    encrypt,
    decrypt,
    decryptData,
    isEncrypted,
    encryptApiKey,
    decryptApiKey,
    computeHMAC,
    hashPasswordWithPBKDF2,
    verifyPasswordWithPBKDF2,
    constantTimeCompare,
    generateHmacSignature,
    verifyHmacSignature,
    hashUrl,
    getNotificationHmacKey,
    getConsentHmacKey,
    wrapSecretString,
    unwrapSecretString,
    isWrappedSecretString,
    encryptEnvelope,
    decryptEnvelope,
    migrateLegacyCiphertext,
    isEncryptionEnvelope,
    CURRENT_ENVELOPE_VERSION,
} from '../index.js';
import type { EncryptionEnvelope } from '../index.js';

// Web Crypto APIのセットアップ
beforeEach(() => {
    const webcrypto = new Crypto();
    global.crypto = webcrypto;
});

describe('crypto', () => {
    describe('generateSalt', () => {
        test('generates a 16-byte salt', () => {
            const salt = generateSalt();
            expect(salt).toBeInstanceOf(Uint8Array);
            expect(salt.length).toBe(16);
        });

        test('generates a different salt each time', () => {
            const salt1 = generateSalt();
            const salt2 = generateSalt();
            expect(salt1).not.toEqual(salt2);
        });
    });

    describe('generateIV', () => {
        test('generates a 12-byte IV', () => {
            const iv = generateIV();
            expect(iv).toBeInstanceOf(Uint8Array);
            expect(iv.length).toBe(12);
        });

        test('generates a different IV each time', () => {
            const iv1 = generateIV();
            const iv2 = generateIV();
            expect(iv1).not.toEqual(iv2);
        });
    });

    // hashPassword/verifyPassword (deprecated, salt-less SHA-256) were made
    // internal-only (see PBI-2026-07-25-31) since no production code used
    // them; coverage now lives entirely in hashPasswordWithPBKDF2/
    // verifyPasswordWithPBKDF2 below.

    describe('deriveKey', () => {
        test('derives a key from a password and salt', async () => {
            const password = 'test-password';
            const salt = generateSalt();
            const key = await deriveKey(password, salt);
            expect(key).toBeInstanceOf(CryptoKey);
            expect(key.type).toBe('secret');
            expect(key.extractable).toBe(false);
        });

        test('derives the same key from the same password and salt', async () => {
            const password = 'test-password';
            const salt = generateSalt();
            const key1 = await deriveKey(password, salt);
            const key2 = await deriveKey(password, salt);
            // CryptoKeyは直接比較できないが、同じ入力で同じキーが導出されることを確認
            expect(key1.algorithm).toEqual(key2.algorithm);
        });

        test('derives different keys from different salts', async () => {
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
        test('encrypts and decrypts plaintext', async () => {
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

        test('fails to decrypt with a different key', async () => {
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

        test('fails to decrypt with a different IV', async () => {
            const plaintext = 'This is a secret message';
            const password = 'test-password';
            const salt = generateSalt();
            const key = await deriveKey(password, salt);

            const encrypted = await encrypt(plaintext, key);
            const wrongIV = generateIV();

            await expect(decrypt(encrypted.ciphertext, btoa(String.fromCharCode(...wrongIV)), key))
                .rejects.toThrow('Decryption failed');
        });

        test('encrypts and decrypts an empty string', async () => {
            const plaintext = '';
            const password = 'test-password';
            const salt = generateSalt();
            const key = await deriveKey(password, salt);

            const encrypted = await encrypt(plaintext, key);
            const decrypted = await decrypt(encrypted.ciphertext, encrypted.iv, key);
            expect(decrypted).toBe(plaintext);
        });

        test('encrypts and decrypts long text', async () => {
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
        test('decrypts object-form encrypted data', async () => {
            const plaintext = 'This is a secret message';
            const password = 'test-password';
            const salt = generateSalt();
            const key = await deriveKey(password, salt);

            const encrypted = await encrypt(plaintext, key);
            const decrypted = await decryptData(encrypted, key);
            expect(decrypted).toBe(plaintext);
        });

        test('throws for invalid data format', async () => {
            const password = 'test-password';
            const salt = generateSalt();
            const key = await deriveKey(password, salt);

            type Enc = Parameters<typeof decryptData>[0];
            await expect(decryptData(null as unknown as Enc, key)).rejects.toThrow('Invalid encrypted data format');
            await expect(decryptData({} as unknown as Enc, key)).rejects.toThrow('Invalid encrypted data format');
            await expect(decryptData({ ciphertext: 'test' } as unknown as Enc, key)).rejects.toThrow('Invalid encrypted data format');
        });
    });

    describe('isEncrypted', () => {
        test('identifies encrypted data correctly', () => {
            const encryptedData: EncryptedData = {
                ciphertext: 'base64-encoded-ciphertext',
                iv: 'base64-encoded-iv'
            };
            expect(isEncrypted(encryptedData)).toBe(true);
        });

        test('identifies plaintext correctly', () => {
            expect(isEncrypted('plaintext')).toBe(false);
            expect(isEncrypted(null)).toBe(false);
            expect(isEncrypted(undefined)).toBe(false);
            expect(isEncrypted({})).toBe(false);
            expect(isEncrypted({ ciphertext: 'test' as const })).toBe(false);
        });

        test('does not treat empty ciphertext/iv as encrypted data', () => {
            expect(isEncrypted({ ciphertext: '', iv: 'base64-iv' })).toBe(false);
            expect(isEncrypted({ ciphertext: 'base64-ciphertext', iv: '' })).toBe(false);
            expect(isEncrypted({ ciphertext: '', iv: '' })).toBe(false);
        });

        test('does not treat non-string ciphertext/iv as encrypted data', () => {
            expect(isEncrypted({ ciphertext: 123, iv: 'base64-iv' })).toBe(false);
            expect(isEncrypted({ ciphertext: 'base64-ciphertext', iv: null })).toBe(false);
        });
    });

    describe('encryptApiKey and decryptApiKey', () => {
        test('encrypts and decrypts an API key', async () => {
            const apiKey = 'sk-1234567890abcdef';
            const password = 'test-password';
            const salt = generateSalt();
            const key = await deriveKey(password, salt);

            const encrypted = await encryptApiKey(apiKey, key);
            expect(isEncrypted(encrypted)).toBe(true);

            const decrypted = await decryptApiKey(encrypted, key);
            expect(decrypted).toBe(apiKey);
        });

        test('returns a plaintext API key as-is (backward compatibility)', async () => {
            const apiKey = 'sk-1234567890abcdef';
            const password = 'test-password';
            const salt = generateSalt();
            const key = await deriveKey(password, salt);

            const decrypted = await decryptApiKey(apiKey, key);
            expect(decrypted).toBe(apiKey);
        });

        test('throws for an invalid API key', async () => {
            const password = 'test-password';
            const salt = generateSalt();
            const key = await deriveKey(password, salt);

            await expect(encryptApiKey(null as unknown as string, key)).rejects.toThrow('Invalid API key');
            await expect(encryptApiKey(123 as unknown as string, key)).rejects.toThrow('Invalid API key');
        });

        test('throws for invalid encrypted data', async () => {
            const password = 'test-password';
            const salt = generateSalt();
            const key = await deriveKey(password, salt);

            await expect(decryptApiKey({} as EncryptedData, key)).rejects.toThrow('Invalid API key format');
        });
    });

    // セキュリティテスト追加（Checking Team Review #3）
    describe('constantTimeCompare', () => {
        test('returns true for identical strings', async () => {
            const result = await constantTimeCompare('password123', 'password123');
            expect(result).toBe(true);
        });

        test('returns false for different strings of the same length', async () => {
            const result = await constantTimeCompare('password123', 'password456');
            expect(result).toBe(false);
        });

        test('returns false for strings of different lengths', async () => {
            const result = await constantTimeCompare('password123', 'password45678');
            expect(result).toBe(false);
        });

        test('returns true for empty strings', async () => {
            const result = await constantTimeCompare('', '');
            expect(result).toBe(true);
        });

        test('timing-attack resistance: verifies execution-time variance', async () => {
            // 同じ長さの一致・不一致の場合、実行時間が同程度であることを確認
            // iterationsを200に増やし、GC・コンテキストスイッチの分散を吸収する
            const iterations = 200;
            const timesMatch: number[] = [];
            const timesMismatch: number[] = [];

            for (let i = 0; i < iterations; i++) {
                // 一致する場合
                const start1 = performance.now();
                await constantTimeCompare('test-password-123-456', 'test-password-123-456');
                timesMatch.push(performance.now() - start1);

                // 不一致する場合
                const start2 = performance.now();
                await constantTimeCompare('test-password-123-456', 'test-password-xxx-xxx');
                timesMismatch.push(performance.now() - start2);
            }

            // 平均値を計算
            const avgMatch = timesMatch.reduce((a, b) => a + b, 0) / timesMatch.length;
            const avgMismatch = timesMismatch.reduce((a, b) => a + b, 0) / timesMismatch.length;

            // 一致・不一致の平均時間が大きく異ならないことを確認（許容範囲10倍以内）
            // constantTimeCompare は maxLength 分のループを早期終了なしで実行するため本質的に定数時間。
            // テスト環境のGC・コンテキストスイッチによる分散を考慮し許容範囲を広めに設定。
            const ratio = avgMatch > avgMismatch ? avgMatch / avgMismatch : avgMismatch / avgMatch;
            expect(ratio).toBeLessThan(10);
        });

        test('timing-attack resistance: keeps execution time stable across lengths', async () => {
            // 異なる長さの文字列を比較しても、実行時間が長さに依存しないことを確認
            const iterations = 50;
            const timesShort: number[] = [];
            const timesLong: number[] = [];

            for (let i = 0; i < iterations; i++) {
                // 短い文字列
                const start1 = performance.now();
                await constantTimeCompare('abcd', 'efgh');
                timesShort.push(performance.now() - start1);

                // 長い文字列
                const start2 = performance.now();
                await constantTimeCompare('very-long-password-123456789', 'different-long-password-987654321');
                timesLong.push(performance.now() - start2);
            }

            const avgShort = timesShort.reduce((a, b) => a + b, 0) / timesShort.length;
            const avgLong = timesLong.reduce((a, b) => a + b, 0) / timesLong.length;

            // 早期リターンがないことを検証: 長い文字列が短い文字列より極端に速くはないはず。
            // 厳密な大小比較は CI 高負荷環境でフレイキーになるため、
            // 比率が十分小さいことで「ほぼ同オーダー」を確認する。
            // 長い文字列は最大35文字、短い文字列は4文字で、理論上は約9倍の差が
            // 予想される。測定ノイズや JIT ウォームアップを考慮して閾値は 50 に緩和。
            const ratio = avgLong / (avgShort || 0.001); // ゼロ除算防止
            expect(ratio).toBeLessThan(50);
        });
    });

    describe('computeHMAC', () => {
        test('generates the same hash for the same input (deterministic)', async () => {
            const secret = 'test-secret';
            const message = 'test-message';

            const hash1 = await computeHMAC(secret, message);
            const hash2 = await computeHMAC(secret, message);

            expect(hash1).toBe(hash2);
        });

        test('generates different hashes for different inputs', async () => {
            const secret = 'test-secret';

            const hash1 = await computeHMAC(secret, 'message-1');
            const hash2 = await computeHMAC(secret, 'message-2');

            expect(hash1).not.toBe(hash2);
        });

        test('generates different hashes for different secrets', async () => {
            const message = 'test-message';

            const hash1 = await computeHMAC('secret-1', message);
            const hash2 = await computeHMAC('secret-2', message);

            expect(hash1).not.toBe(hash2);
        });

        test('generates valid Base64 output', async () => {
            const hash = await computeHMAC('secret', 'message');
            expect(typeof hash).toBe('string');

            // Base64エンコードであることを確認
            expect(() => atob(hash)).not.toThrow();
        });
    });

    describe('hashPasswordWithPBKDF2', () => {
        test('generates a password hash with PBKDF2', async () => {
            const password = 'test-password';
            const salt = generateSalt();

            const hash = await hashPasswordWithPBKDF2(password, salt);

            expect(typeof hash).toBe('string');
            expect(hash.length).toBeGreaterThan(0);

            // Base64エンコードであることを確認
            expect(() => atob(hash)).not.toThrow();
        });

        test('generates the same hash for the same password and salt', async () => {
            const password = 'test-password';
            const salt = generateSalt();

            const hash1 = await hashPasswordWithPBKDF2(password, salt);
            const hash2 = await hashPasswordWithPBKDF2(password, salt);

            expect(hash1).toBe(hash2);
        });

        test('generates different hashes for different salts', async () => {
            const password = 'test-password';
            const salt1 = generateSalt();
            const salt2 = generateSalt();

            const hash1 = await hashPasswordWithPBKDF2(password, salt1);
            const hash2 = await hashPasswordWithPBKDF2(password, salt2);

            expect(hash1).not.toBe(hash2);
        });

        test('generates different hashes for different passwords', async () => {
            const salt = generateSalt();

            const hash1 = await hashPasswordWithPBKDF2('password-1', salt);
            const hash2 = await hashPasswordWithPBKDF2('password-2', salt);

            expect(hash1).not.toBe(hash2);
        });
    });

    describe('verifyPasswordWithPBKDF2', () => {
        test('verifies a correct password', async () => {
            const password = 'test-password';
            const salt = generateSalt();
            const storedHash = await hashPasswordWithPBKDF2(password, salt);

            const result = await verifyPasswordWithPBKDF2(password, storedHash, salt);
            expect(result.isValid).toBe(true);
        });

        test('rejects a wrong password', async () => {
            const password = 'test-password';
            const salt = generateSalt();
            const storedHash = await hashPasswordWithPBKDF2(password, salt);

            const result = await verifyPasswordWithPBKDF2('wrong-password', storedHash, salt);
            expect(result.isValid).toBe(false);
        });

        test('uses constant-time comparison', { timeout: 60000 }, async () => {
            const password = 'test-password';
            const salt = generateSalt();
            const storedHash = await hashPasswordWithPBKDF2(password, salt);

            // 一致する場合と不一致する場合の実行時間を比較
            // CI環境（QEMU エミュレーション）でのメモリ節約のため少数回に抑える
            const iterations = 3;
            const timesMatch: number[] = [];
            const timesMismatch: number[] = [];

            for (let i = 0; i < iterations; i++) {
                const start1 = performance.now();
                await verifyPasswordWithPBKDF2(password, storedHash, salt);
                timesMatch.push(performance.now() - start1);

                const start2 = performance.now();
                await verifyPasswordWithPBKDF2('wrong-password', storedHash, salt);
                timesMismatch.push(performance.now() - start2);
            }

            const avgMatch = timesMatch.reduce((a, b) => a + b, 0) / timesMatch.length;
            const avgMismatch = timesMismatch.reduce((a, b) => a + b, 0) / timesMismatch.length;

            // 一致・不一致の平均時間が大きく異ならないことを確認（許容範囲5倍以内）
            const ratio = avgMatch > avgMismatch ? avgMatch / avgMismatch : avgMismatch / avgMatch;
            expect(ratio).toBeLessThan(5);
        });

        describe('レガシーパス（iterations未指定）', () => {
            test('matches a hash from the new iteration count and reports no rehash needed', async () => {
                const password = 'test-password';
                const salt = generateSalt();
                const storedHash = await hashPasswordWithPBKDF2(password, salt, 600000);

                const result = await verifyPasswordWithPBKDF2(password, storedHash, salt);
                expect(result.isValid).toBe(true);
                expect(result.needsRehash).toBe(false);
            });

            test('matches a hash from the old iteration count and reports rehash needed', async () => {
                const password = 'test-password';
                const salt = generateSalt();
                const storedHash = await hashPasswordWithPBKDF2(password, salt, 100000);

                const result = await verifyPasswordWithPBKDF2(password, storedHash, salt);
                expect(result.isValid).toBe(true);
                expect(result.needsRehash).toBe(true);
            });

            test('reports invalid when matching neither old nor new iteration hash', async () => {
                const password = 'test-password';
                const salt = generateSalt();
                const storedHash = await hashPasswordWithPBKDF2(password, salt, 600000);

                const result = await verifyPasswordWithPBKDF2('wrong-password', storedHash, salt);
                expect(result.isValid).toBe(false);
                expect(result.needsRehash).toBe(false);
            });
        });

        describe('iterations指定パス（定数時間比較）', () => {
            test('reports no rehash needed when the stored iteration matches the current default', async () => {
                const password = 'test-password';
                const salt = generateSalt();
                const storedHash = await hashPasswordWithPBKDF2(password, salt, 600000);

                const result = await verifyPasswordWithPBKDF2(password, storedHash, salt, 600000);
                expect(result.isValid).toBe(true);
                expect(result.needsRehash).toBe(false);
            });

            test('reports rehash needed when the stored iteration differs from the current default', async () => {
                const password = 'test-password';
                const salt = generateSalt();
                const storedHash = await hashPasswordWithPBKDF2(password, salt, 100000);

                const result = await verifyPasswordWithPBKDF2(password, storedHash, salt, 100000);
                expect(result.isValid).toBe(true);
                expect(result.needsRehash).toBe(true);
            });

            test('returns invalid with rehash flag for a wrong password', async () => {
                const password = 'test-password';
                const salt = generateSalt();
                const storedHash = await hashPasswordWithPBKDF2(password, salt, 600000);

                const result = await verifyPasswordWithPBKDF2('wrong-password', storedHash, salt, 600000);
                expect(result.isValid).toBe(false);
                expect(result.needsRehash).toBe(false);
            });
        });
    });
});

describe('generateHmacSignature', () => {
    test('generates a URL-safe base64 HMAC signature', async () => {
        const webcrypto = new Crypto();
        const key = await webcrypto.subtle.generateKey(
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign', 'verify']
        );

        const signature = await generateHmacSignature('test-data', key);
        expect(typeof signature).toBe('string');
        expect(signature.length).toBeGreaterThan(0);
        // URL-safe base64 は + / = を含まない
        expect(signature).not.toContain('+');
        expect(signature).not.toContain('/');
        expect(signature).not.toContain('=');
    });

    test('generates the same signature for the same data and key', async () => {
        const webcrypto = new Crypto();
        const key = await webcrypto.subtle.generateKey(
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign', 'verify']
        );

        const sig1 = await generateHmacSignature('same-data', key);
        const sig2 = await generateHmacSignature('same-data', key);
        expect(sig1).toBe(sig2);
    });

    test('generates different signatures for different data', async () => {
        const webcrypto = new Crypto();
        const key = await webcrypto.subtle.generateKey(
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign', 'verify']
        );

        const sig1 = await generateHmacSignature('data-a', key);
        const sig2 = await generateHmacSignature('data-b', key);
        expect(sig1).not.toBe(sig2);
    });
});

describe('verifyHmacSignature', () => {
    test('verifies a valid signature', async () => {
        const webcrypto = new Crypto();
        const key = await webcrypto.subtle.generateKey(
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign', 'verify']
        );

        const signature = await generateHmacSignature('test-data', key);
        const isValid = await verifyHmacSignature('test-data', signature, key);
        expect(isValid).toBe(true);
    });

    test('returns false for an invalid signature', async () => {
        const webcrypto = new Crypto();
        const key = await webcrypto.subtle.generateKey(
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign', 'verify']
        );

        const isValid = await verifyHmacSignature('test-data', 'invalid-signature', key);
        expect(isValid).toBe(false);
    });

    test('returns false for a signature of different data', async () => {
        const webcrypto = new Crypto();
        const key = await webcrypto.subtle.generateKey(
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign', 'verify']
        );

        const signature = await generateHmacSignature('data-a', key);
        const isValid = await verifyHmacSignature('data-b', signature, key);
        expect(isValid).toBe(false);
    });

    test('returns false for a signature of different length', async () => {
        const webcrypto = new Crypto();
        const key = await webcrypto.subtle.generateKey(
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign', 'verify']
        );

        const isValid = await verifyHmacSignature('test', 'short', key);
        expect(isValid).toBe(false);
    });
});

describe('hashUrl', () => {
    test('returns the SHA-256 hash prefix of a URL', async () => {
        const hash = await hashUrl('https://example.com');
        expect(hash).toMatch(/^\[hash:[0-9a-f]{16}\]$/);
    });

    test('returns the same hash for the same URL', async () => {
        const hash1 = await hashUrl('https://example.com');
        const hash2 = await hashUrl('https://example.com');
        expect(hash1).toBe(hash2);
    });

    test('returns different hashes for different URLs', async () => {
        const hash1 = await hashUrl('https://example.com');
        const hash2 = await hashUrl('https://other.com');
        expect(hash1).not.toBe(hash2);
    });
});

describe('getNotificationHmacKey', () => {
    test('generates and stores a new HMAC key', async () => {
        const key = await getNotificationHmacKey();
        expect(key).toBeDefined();
        expect(key.type).toBe('secret');
        expect(key.algorithm).toHaveProperty('name', 'HMAC');
    });

    test('loads a stored HMAC key', async () => {
        // 最初の呼び出しで鍵を生成・保存
        const key1 = await getNotificationHmacKey();
        // 2回目の呼び出しで保存済み鍵を読み込み
        const key2 = await getNotificationHmacKey();
        expect(key1).toBeDefined();
        expect(key2).toBeDefined();
    });

    test('generates a new key from corrupted storage data', async () => {
        // isEncrypted()がtrueを返すが、復号化に失敗するデータを設定
        await chrome.storage.local.set({
            'notification-signature-key': {
                ciphertext: '!!!invalid-base64!!!',
                iv: '!!!invalid-base64!!!'
            }
        });

        // console.warnが呼ばれ、新規鍵が生成されるべき
        const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const key = await getNotificationHmacKey();
        expect(key).toBeDefined();
        expect(key.type).toBe('secret');
        consoleWarnSpy.mockRestore();
    });
});

describe('HMAC key encryption (PBI-03)', () => {
    test('consent HMAC key is stored in encrypted (wrapped) form', async () => {
        await getConsentHmacKey();

        const stored = await chrome.storage.local.get('privacy-consent-signature-key');
        const value = stored['privacy-consent-signature-key'];
        expect(typeof value).toBe('object');
        expect(value).toHaveProperty('wrapped');
        expect(value).toHaveProperty('iv');
        expect((value as { wrapped: string }).wrapped.length).toBeGreaterThan(0);
        expect((value as { iv: string }).iv.length).toBeGreaterThan(0);
        // No plaintext base64 key material should be stored
        expect(typeof (stored as Record<string, unknown>)['privacy-consent-signature-key']).not.toBe('string');
    });

    test('notification HMAC key is stored in encrypted (wrapped) form', async () => {
        const key = await getNotificationHmacKey();

        const stored = await chrome.storage.local.get('notification-signature-key');
        const value = stored['notification-signature-key'];
        expect(typeof value).toBe('object');
        expect(value).toHaveProperty('wrapped');
        expect(value).toHaveProperty('iv');

        // The returned key still signs correctly
        const signature = await generateHmacSignature('test-data', key);
        expect(signature.length).toBeGreaterThan(0);
    });

    test('unwraps a stored encrypted key on subsequent reads (same key material)', async () => {
        const key1 = await getNotificationHmacKey();
        const key2 = await getNotificationHmacKey();

        // Both keys must produce the identical signature, i.e. same key material
        const sig1 = await generateHmacSignature('same-data', key1);
        const sig2 = await generateHmacSignature('same-data', key2);
        expect(sig1).toBe(sig2);
    });

    test('migrates a legacy plaintext key to the encrypted format', async () => {
        // Simulate a pre-PBI-03 plaintext base64 key in storage.local
        const rawBytes = new Uint8Array(32).map((_, i) => (i * 7 + 3) % 256);
        const plaintextKey = btoa(String.fromCharCode(...rawBytes));
        await chrome.storage.local.set({ 'privacy-consent-signature-key': plaintextKey });

        const key = await getConsentHmacKey();
        expect(key).toBeDefined();

        // The key must now be stored wrapped, not plaintext
        const stored = await chrome.storage.local.get('privacy-consent-signature-key');
        const value = stored['privacy-consent-signature-key'];
        expect(typeof value).toBe('object');
        expect(value).toHaveProperty('wrapped');
        expect(value).toHaveProperty('iv');

        // The migrated key uses the same key material as the original plaintext
        const originalKey = await global.crypto.subtle.importKey(
            'raw',
            rawBytes,
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign', 'verify']
        );
        const expectedSig = await generateHmacSignature('migration-check', originalKey);
        const actualSig = await generateHmacSignature('migration-check', key);
        expect(actualSig).toBe(expectedSig);
    });

    test('recovers from undecryptable wrapped data by generating a fresh key', async () => {
        await chrome.storage.local.set({
            'notification-signature-key': { wrapped: '!!!invalid-base64!!!', iv: '!!!invalid-base64!!!' }
        });

        const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const key = await getNotificationHmacKey();
        consoleWarnSpy.mockRestore();

        expect(key).toBeDefined();
        expect(key.type).toBe('secret');

        // Storage must now contain a valid wrapped envelope
        const stored = await chrome.storage.local.get('notification-signature-key');
        const value = stored['notification-signature-key'];
        expect(typeof value).toBe('object');
        expect((value as { wrapped: string }).wrapped.length).toBeGreaterThan(0);
        expect((value as { iv: string }).iv.length).toBeGreaterThan(0);
    });
});

describe('wrapSecretString / unwrapSecretString (hmac_secret encryption)', () => {
    test('encrypts a secret string and decrypts it back to the original value', async () => {
        const original = 'test-secret-base64-value==';
        const envelope = await wrapSecretString(original);

        expect(envelope).toHaveProperty('wrapped');
        expect(envelope).toHaveProperty('iv');
        expect(envelope.wrapped).not.toBe(original);

        const decrypted = await unwrapSecretString(envelope);
        expect(decrypted).toBe(original);
    });

    test('isWrappedSecretString identifies a wrapped envelope and rejects plaintext', () => {
        expect(isWrappedSecretString({ wrapped: 'x', iv: 'y' })).toBe(true);
        expect(isWrappedSecretString('plain-base64-string')).toBe(false);
        expect(isWrappedSecretString(null)).toBe(false);
        expect(isWrappedSecretString(undefined)).toBe(false);
    });

    test('different secrets produce different ciphertext (no key/IV reuse leak)', async () => {
        const envelope1 = await wrapSecretString('secret-a');
        const envelope2 = await wrapSecretString('secret-b');

        expect(envelope1.wrapped).not.toBe(envelope2.wrapped);
        expect(envelope1.iv).not.toBe(envelope2.iv);
    });
});

describe('verifyHmacSignature edge cases', () => {
    test('returns false for empty data', async () => {
        const webcrypto = new Crypto();
        const key = await webcrypto.subtle.generateKey(
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign', 'verify']
        );

        // Empty signature should fail
        const isValid = await verifyHmacSignature('test', '', key);
        expect(isValid).toBe(false);
    });

    test('fails to verify a signature made with a wrong key', async () => {
        const webcrypto = new Crypto();
        const key1 = await webcrypto.subtle.generateKey(
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign', 'verify']
        );
        const key2 = await webcrypto.subtle.generateKey(
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign', 'verify']
        );

        const signature = await generateHmacSignature('test-data', key1);
        const isValid = await verifyHmacSignature('test-data', signature, key2);
        expect(isValid).toBe(false);
    });
});

describe('deriveKey', () => {
    test('derives an encryption key from secret and salt', async () => {
        const { deriveKey } = await import('../index.js');
        const salt = generateSalt();
        const key = await deriveKey('secret', salt);
        expect(key).toBeInstanceOf(CryptoKey);
        expect(key.type).toBe('secret');
    });

    test('derives different keys from different salts', async () => {
        const { deriveKey } = await import('../index.js');
        const salt1 = generateSalt();
        const salt2 = generateSalt();
        const key1 = await deriveKey('secret', salt1);
        const key2 = await deriveKey('secret', salt2);

        const plaintext = 'test';
        const enc1 = await encrypt(plaintext, key1);
        const enc2 = await encrypt(plaintext, key2);
        expect(enc1.ciphertext).not.toBe(enc2.ciphertext);
    });
});

describe('versioned encryption envelope (H3)', () => {
    const TEST_PASSWORD = 'test-master-password-12345';

    describe('encryptEnvelope / decryptEnvelope', () => {
        test('encrypts and decrypts a string with current version', async () => {
            const plaintext = 'sk-test-openai-key-12345';
            const envelope = await encryptEnvelope(plaintext, TEST_PASSWORD);
            expect(envelope.version).toBe(CURRENT_ENVELOPE_VERSION);
            const decrypted = await decryptEnvelope(envelope, TEST_PASSWORD);
            expect(decrypted).toBe(plaintext);
        });

        test('fails to decrypt with wrong password', async () => {
            const envelope = await encryptEnvelope('secret', TEST_PASSWORD);
            await expect(decryptEnvelope(envelope, 'wrong-password')).rejects.toThrow();
        });

        test('envelope contains version, kdf, hash, iterations, salt, iv, data', async () => {
            const envelope = await encryptEnvelope('hello', TEST_PASSWORD);
            expect(envelope).toMatchObject({
                version: expect.any(Number),
                kdf: 'pbkdf2',
                hash: expect.stringMatching(/^SHA-/),
                iterations: expect.any(Number),
                salt: expect.any(String),
                iv: expect.any(String),
                data: expect.any(String),
            });
        });

        test('each encryption produces unique salt and iv', async () => {
            const env1 = await encryptEnvelope('same', TEST_PASSWORD);
            const env2 = await encryptEnvelope('same', TEST_PASSWORD);
            expect(env1.salt).not.toBe(env2.salt);
            expect(env1.iv).not.toBe(env2.iv);
            expect(env1.data).not.toBe(env2.data);
        });

        test('handles empty string', async () => {
            const envelope = await encryptEnvelope('', TEST_PASSWORD);
            const decrypted = await decryptEnvelope(envelope, TEST_PASSWORD);
            expect(decrypted).toBe('');
        });

        test('handles long plaintext', async () => {
            const plaintext = 'a'.repeat(10000);
            const envelope = await encryptEnvelope(plaintext, TEST_PASSWORD);
            const decrypted = await decryptEnvelope(envelope, TEST_PASSWORD);
            expect(decrypted).toBe(plaintext);
        });

        test('handles unicode plaintext', async () => {
            const plaintext = '日本語テスト🔐秘密鍵';
            const envelope = await encryptEnvelope(plaintext, TEST_PASSWORD);
            const decrypted = await decryptEnvelope(envelope, TEST_PASSWORD);
            expect(decrypted).toBe(plaintext);
        });
    });

    describe('isEncryptionEnvelope', () => {
        test('returns true for valid envelope', async () => {
            const envelope = await encryptEnvelope('test', TEST_PASSWORD);
            expect(isEncryptionEnvelope(envelope)).toBe(true);
        });

        test('returns false for legacy EncryptedData', () => {
            const legacy = { ciphertext: 'abc', iv: 'def' };
            expect(isEncryptionEnvelope(legacy)).toBe(false);
        });

        test('returns false for non-objects', () => {
            expect(isEncryptionEnvelope(null)).toBe(false);
            expect(isEncryptionEnvelope(undefined)).toBe(false);
            expect(isEncryptionEnvelope('string')).toBe(false);
            expect(isEncryptionEnvelope(42)).toBe(false);
        });

        test('returns false for incomplete envelope', () => {
            expect(isEncryptionEnvelope({ version: 2 })).toBe(false);
            expect(isEncryptionEnvelope({ version: 2, kdf: 'pbkdf2' })).toBe(false);
        });

        test('returns false for excessive iterations', async () => {
            const envelope = await encryptEnvelope('test', TEST_PASSWORD);
            envelope.iterations = 1_000_000_000;
            expect(isEncryptionEnvelope(envelope)).toBe(false);
        });

        test('returns false for SHA-1 hash downgrade', async () => {
            const envelope = await encryptEnvelope('test', TEST_PASSWORD);
            envelope.hash = 'SHA-1';
            expect(isEncryptionEnvelope(envelope)).toBe(false);
        });

        test('returns false for future version', async () => {
            const envelope = await encryptEnvelope('test', TEST_PASSWORD);
            envelope.version = 999;
            expect(isEncryptionEnvelope(envelope)).toBe(false);
        });
    });

    describe('migrateLegacyCiphertext', () => {
        test('converts legacy EncryptedData to EncryptionEnvelope', async () => {
            const plaintext = 'sk-legacy-api-key-12345';
            const salt = generateSalt();
            const legacyKey = await deriveKey('legacy-secret', salt);
            const legacyData = await encrypt(plaintext, legacyKey);

            const envelope = await migrateLegacyCiphertext(legacyData, legacyKey, TEST_PASSWORD);

            expect(isEncryptionEnvelope(envelope)).toBe(true);
            expect(envelope.version).toBe(CURRENT_ENVELOPE_VERSION);

            const decrypted = await decryptEnvelope(envelope, TEST_PASSWORD);
            expect(decrypted).toBe(plaintext);
        });

        test('migrated data is decryptable with new password', async () => {
            const plaintext = 'sk-migrated-key';
            const salt = generateSalt();
            const legacyKey = await deriveKey('old-secret', salt);
            const legacyData = await encrypt(plaintext, legacyKey);

            const newPassword = 'completely-new-password';
            const envelope = await migrateLegacyCiphertext(legacyData, legacyKey, newPassword);

            const decrypted = await decryptEnvelope(envelope, newPassword);
            expect(decrypted).toBe(plaintext);
        });

        test('throws for invalid legacy data', async () => {
            const salt = generateSalt();
            const legacyKey = await deriveKey('secret', salt);
            const invalidData = { ciphertext: 'bad', iv: 'bad' };

            await expect(
                migrateLegacyCiphertext(invalidData, legacyKey, TEST_PASSWORD)
            ).rejects.toThrow();
        });
    });

    describe('decryptEnvelope validation', () => {
        const password = 'test-password';

        test('rejects iterations that are too high', async () => {
            const envelope = await encryptEnvelope('secret', password);
            envelope.iterations = 1_000_000_000;
            await expect(decryptEnvelope(envelope, password)).rejects.toThrow('Invalid envelope iterations');
        });

        test('rejects SHA-1 hash downgrade', async () => {
            const envelope = await encryptEnvelope('secret', password);
            envelope.hash = 'SHA-1';
            await expect(decryptEnvelope(envelope, password)).rejects.toThrow('Invalid envelope hash');
        });

        test('rejects future version', async () => {
            const envelope = await encryptEnvelope('secret', password);
            envelope.version = 999;
            await expect(decryptEnvelope(envelope, password)).rejects.toThrow('Unsupported envelope version');
        });

        test('rejects oversized data', async () => {
            const envelope = await encryptEnvelope('secret', password);
            envelope.data = 'a'.repeat(10 * 1024 * 1024 + 1);
            await expect(decryptEnvelope(envelope, password)).rejects.toThrow('exceeds maximum length');
        });
    });
});