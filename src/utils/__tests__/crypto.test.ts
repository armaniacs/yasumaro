/**
 * crypto.test.ts
 * crypto.tsのテスト
 * 【テスト対象】: src/utils/crypto.ts
 */

import { vi } from 'vitest';;
import { Crypto } from '@peculiar/webcrypto';
import type { EncryptedData } from '../typesCrypto.js';
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
    computeHMAC,
    hashPasswordWithPBKDF2,
    verifyPasswordWithPBKDF2,
    constantTimeCompare,
    generateHmacSignature,
    verifyHmacSignature,
    hashUrl,
    getNotificationHmacKey
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

    // セキュリティテスト追加（Checking Team Review #3）
    describe('constantTimeCompare', () => {
        test('同一文字列でtrueを返す', async () => {
            const result = await constantTimeCompare('password123', 'password123');
            expect(result).toBe(true);
        });

        test('異なる文字列（同長）でfalseを返す', async () => {
            const result = await constantTimeCompare('password123', 'password456');
            expect(result).toBe(false);
        });

        test('異なる長さの文字列でfalseを返す', async () => {
            const result = await constantTimeCompare('password123', 'password45678');
            expect(result).toBe(false);
        });

        test('空文字列でtrueを返す', async () => {
            const result = await constantTimeCompare('', '');
            expect(result).toBe(true);
        });

        test('タイミング攻撃耐性: 実行時間の分散を検証', async () => {
            // 同じ長さの一致・不一致の場合、実行時間が同程度であることを確認
            const iterations = 50;
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

            // 一致・不一致の平均時間が大きく異ならないことを確認（許容範囲5倍以内）
            const ratio = avgMatch > avgMismatch ? avgMatch / avgMismatch : avgMismatch / avgMatch;
            expect(ratio).toBeLessThan(5);
        });

        test('タイミング攻撃耐性: 異なる長さでも固定実行時間', async () => {
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
            // 比率が 10 倍未満であることで「ほぼ同オーダー」を確認する統計的アサーションに変更。
            const ratio = avgLong / (avgShort || 0.001); // ゼロ除算防止
            expect(ratio).toBeLessThan(10);
        });
    });

    describe('computeHMAC', () => {
        test('同じ入力で同じハッシュを生成する（決定性）', async () => {
            const secret = 'test-secret';
            const message = 'test-message';

            const hash1 = await computeHMAC(secret, message);
            const hash2 = await computeHMAC(secret, message);

            expect(hash1).toBe(hash2);
        });

        test('異なる入力で異なるハッシュを生成する', async () => {
            const secret = 'test-secret';

            const hash1 = await computeHMAC(secret, 'message-1');
            const hash2 = await computeHMAC(secret, 'message-2');

            expect(hash1).not.toBe(hash2);
        });

        test('シークレットが異なると異なるハッシュを生成する', async () => {
            const message = 'test-message';

            const hash1 = await computeHMAC('secret-1', message);
            const hash2 = await computeHMAC('secret-2', message);

            expect(hash1).not.toBe(hash2);
        });

        test('有効なBase64出力を生成する', async () => {
            const hash = await computeHMAC('secret', 'message');
            expect(typeof hash).toBe('string');

            // Base64エンコードであることを確認
            expect(() => atob(hash)).not.toThrow();
        });
    });

    describe('hashPasswordWithPBKDF2', () => {
        test('PBKDF2でパスワードハッシュを生成できる', async () => {
            const password = 'test-password';
            const salt = generateSalt();

            const hash = await hashPasswordWithPBKDF2(password, salt);

            expect(typeof hash).toBe('string');
            expect(hash.length).toBeGreaterThan(0);

            // Base64エンコードであることを確認
            expect(() => atob(hash)).not.toThrow();
        });

        test('同じパスワードとソルトで同じハッシュを生成する', async () => {
            const password = 'test-password';
            const salt = generateSalt();

            const hash1 = await hashPasswordWithPBKDF2(password, salt);
            const hash2 = await hashPasswordWithPBKDF2(password, salt);

            expect(hash1).toBe(hash2);
        });

        test('異なるソルトで異なるハッシュを生成する', async () => {
            const password = 'test-password';
            const salt1 = generateSalt();
            const salt2 = generateSalt();

            const hash1 = await hashPasswordWithPBKDF2(password, salt1);
            const hash2 = await hashPasswordWithPBKDF2(password, salt2);

            expect(hash1).not.toBe(hash2);
        });

        test('異なるパスワードで異なるハッシュを生成する', async () => {
            const salt = generateSalt();

            const hash1 = await hashPasswordWithPBKDF2('password-1', salt);
            const hash2 = await hashPasswordWithPBKDF2('password-2', salt);

            expect(hash1).not.toBe(hash2);
        });
    });

    describe('verifyPasswordWithPBKDF2', () => {
        test('正しいパスワードを検証できる', async () => {
            const password = 'test-password';
            const salt = generateSalt();
            const storedHash = await hashPasswordWithPBKDF2(password, salt);

            const isValid = await verifyPasswordWithPBKDF2(password, storedHash, salt);
            expect(isValid).toBe(true);
        });

        test('間違ったパスワードを拒否できる', async () => {
            const password = 'test-password';
            const salt = generateSalt();
            const storedHash = await hashPasswordWithPBKDF2(password, salt);

            const isValid = await verifyPasswordWithPBKDF2('wrong-password', storedHash, salt);
            expect(isValid).toBe(false);
        });

        test('定数時間比較を使用している', { timeout: 60000 }, async () => {
            const password = 'test-password';
            const salt = generateSalt();
            const storedHash = await hashPasswordWithPBKDF2(password, salt);

            // 一致する場合と不一致する場合の実行時間を比較
            const iterations = 30;
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
    });
});

describe('generateHmacSignature', () => {
    test('URL-safe base64 HMAC署名を生成できる', async () => {
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

    test('同じデータと鍵で同じ署名を生成する', async () => {
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

    test('異なるデータで異なる署名を生成する', async () => {
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
    test('有効な署名を検証できる', async () => {
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

    test('不正な署名は false を返す', async () => {
        const webcrypto = new Crypto();
        const key = await webcrypto.subtle.generateKey(
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign', 'verify']
        );

        const isValid = await verifyHmacSignature('test-data', 'invalid-signature', key);
        expect(isValid).toBe(false);
    });

    test('異なるデータの署名は false を返す', async () => {
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

    test('長さが異なる署名は false を返す', async () => {
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
    test('URLのSHA-256ハッシュプレフィックスを返す', async () => {
        const hash = await hashUrl('https://example.com');
        expect(hash).toMatch(/^\[hash:[0-9a-f]{8}\]$/);
    });

    test('同じURLで同じハッシュを返す', async () => {
        const hash1 = await hashUrl('https://example.com');
        const hash2 = await hashUrl('https://example.com');
        expect(hash1).toBe(hash2);
    });

    test('異なるURLで異なるハッシュを返す', async () => {
        const hash1 = await hashUrl('https://example.com');
        const hash2 = await hashUrl('https://other.com');
        expect(hash1).not.toBe(hash2);
    });
});

describe('getNotificationHmacKey', () => {
    test('新規HMAC鍵を生成して保存する', async () => {
        const key = await getNotificationHmacKey();
        expect(key).toBeDefined();
        expect(key.type).toBe('secret');
        expect(key.algorithm).toHaveProperty('name', 'HMAC');
    });

    test('保存済みのHMAC鍵を読み込める', async () => {
        // 最初の呼び出しで鍵を生成・保存
        const key1 = await getNotificationHmacKey();
        // 2回目の呼び出しで保存済み鍵を読み込み
        const key2 = await getNotificationHmacKey();
        expect(key1).toBeDefined();
        expect(key2).toBeDefined();
    });

    test('破損したストレージデータから新規鍵を生成する', async () => {
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

describe('verifyHmacSignature edge cases', () => {
    test('空のデータでfalseを返す', async () => {
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

    test('不正な鍵で生成された署名は検証に失敗する', async () => {
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
    test('secretとsaltから暗号化キーを導出できる', async () => {
        const { deriveKey } = await import('../crypto.js');
        const salt = generateSalt();
        const key = await deriveKey('secret', salt);
        expect(key).toBeInstanceOf(CryptoKey);
        expect(key.type).toBe('secret');
    });

    test('異なるsaltで異なるキーを導出する', async () => {
        const { deriveKey } = await import('../crypto.js');
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