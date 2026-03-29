/**
 * masterPassword.test.ts
 * masterPassword.ts の単体テスト
 */

import { webcrypto as crypto } from '@peculiar/webcrypto';
Object.defineProperty(global, 'crypto', {
    value: crypto
});

import {
    calculatePasswordStrength,
    validatePasswordRequirements,
    validatePasswordMatch,
    setMasterPassword,
    verifyMasterPassword,
    changeMasterPassword,
    isMasterPasswordSet,
    PasswordStrength
} from '../masterPassword.js';

// crypto モック
jest.mock('../crypto.js', () => ({
    generateSalt: jest.fn(() => new Uint8Array(16).fill(1)),
    hashPasswordWithPBKDF2: jest.fn(async (_password: string, _salt: Uint8Array) => 'hashed_value'),
    verifyPasswordWithPBKDF2: jest.fn(async (password: string, hash: string, _salt: Uint8Array) => {
        return password === 'correct_password' && hash === 'hashed_value';
    }),
    encrypt: jest.fn(async (plaintext: string, _key: CryptoKey) => ({
        ciphertext: 'encrypted_' + plaintext,
        iv: 'test_iv'
    })),
    decryptData: jest.fn(async (data: any, _key: CryptoKey) => {
        if (data.ciphertext === 'encrypted_old_secret') return 'old_secret';
        return 'decrypted_data';
    }),
    deriveKey: jest.fn(async (_password: string, _salt: Uint8Array) => 'mock_key' as unknown as CryptoKey)
}));

describe('masterPassword', () => {

    describe('calculatePasswordStrength', () => {
        test('空文字列は score 0, WEAK', () => {
            const result = calculatePasswordStrength('');
            expect(result.score).toBe(0);
            expect(result.level).toBe(PasswordStrength.WEAK);
            expect(result.text).toBe('Weak');
        });

        test('8文字のみ（小文字のみ）は score 20, WEAK', () => {
            const result = calculatePasswordStrength('abcdefgh');
            expect(result.score).toBe(20);
            expect(result.level).toBe(PasswordStrength.WEAK);
        });

        test('12文字以上で+10ポイント', () => {
            const short = calculatePasswordStrength('abcdefgh');
            const long = calculatePasswordStrength('abcdefghijkl');
            expect(long.score).toBe(short.score + 10);
        });

        test('大文字小文字混在で+20ポイント', () => {
            const lower = calculatePasswordStrength('abcdefgh');
            const mixed = calculatePasswordStrength('Abcdefgh');
            expect(mixed.score).toBe(lower.score + 20);
        });

        test('数字を含むと+20ポイント', () => {
            const noNum = calculatePasswordStrength('abcdefgh');
            const withNum = calculatePasswordStrength('abcd1234');
            expect(withNum.score).toBe(noNum.score + 20);
        });

        test('特殊文字を含むと+30ポイント', () => {
            const noSpecial = calculatePasswordStrength('abcd1234');
            const withSpecial = calculatePasswordStrength('abcd1234!');
            expect(withSpecial.score).toBe(noSpecial.score + 30);
        });

        test('最大値は100', () => {
            // 8chars(+20) + 12chars(+10) + mixed(+20) + digit(+20) + special(+30) = 100
            const result = calculatePasswordStrength('Abcdef1!Ghijk');
            expect(result.score).toBe(100);
        });

        test('score < 40 は WEAK', () => {
            const result = calculatePasswordStrength('abcdefgh');
            expect(result.level).toBe(PasswordStrength.WEAK);
            expect(result.text).toBe('Weak');
        });

        test('score 40-79 は MEDIUM', () => {
            // 8chars(+20) + mixed case(+20) = 40
            const result = calculatePasswordStrength('Abcdefgh');
            expect(result.level).toBe(PasswordStrength.MEDIUM);
            expect(result.text).toBe('Medium');
        });

        test('score >= 80 は STRONG', () => {
            // 8chars(+20) + mixed(+20) + digit(+20) + special(+30) = 90
            const result = calculatePasswordStrength('Abcd1!ef');
            expect(result.level).toBe(PasswordStrength.STRONG);
            expect(result.text).toBe('Strong');
        });
    });

    describe('validatePasswordRequirements', () => {
        test('空文字列はエラー', () => {
            expect(validatePasswordRequirements('')).toBe('Password is required');
        });

        test('8文字未満はエラー', () => {
            expect(validatePasswordRequirements('abc')).toBe('Password must be at least 8 characters long');
        });

        test('8文字以上は null', () => {
            expect(validatePasswordRequirements('abcdefgh')).toBeNull();
        });

        test('12文字も null', () => {
            expect(validatePasswordRequirements('abcdefghijkl')).toBeNull();
        });
    });

    describe('validatePasswordMatch', () => {
        test('一致する場合は null', () => {
            expect(validatePasswordMatch('abc', 'abc')).toBeNull();
        });

        test('不一致の場合はエラーメッセージ', () => {
            expect(validatePasswordMatch('abc', 'xyz')).toBe('Passwords do not match');
        });

        test('空文字同士も一致とみなす', () => {
            expect(validatePasswordMatch('', '')).toBeNull();
        });
    });

    describe('setMasterPassword', () => {
        test('有効なパスワードで成功する', async () => {
            const mockSet = jest.fn(async () => {});
            const result = await setMasterPassword('validpass123', mockSet);

            expect(result.success).toBe(true);
            expect(result.error).toBeUndefined();
            expect(mockSet).toHaveBeenCalledTimes(3);
            expect(mockSet).toHaveBeenCalledWith('master_password_salt', expect.any(String));
            expect(mockSet).toHaveBeenCalledWith('master_password_hash', 'hashed_value');
            expect(mockSet).toHaveBeenCalledWith('master_password_enabled', true);
        });

        test('短いパスワードはエラーを返す', async () => {
            const mockSet = jest.fn(async () => {});
            const result = await setMasterPassword('short', mockSet);

            expect(result.success).toBe(false);
            expect(result.error).toBe('Password must be at least 8 characters long');
            expect(mockSet).not.toHaveBeenCalled();
        });

        test('空のパスワードはエラーを返す', async () => {
            const mockSet = jest.fn(async () => {});
            const result = await setMasterPassword('', mockSet);

            expect(result.success).toBe(false);
            expect(result.error).toBe('Password is required');
        });

        test('ストレージエラー時にエラーを返す', async () => {
            const mockSet = jest.fn(async () => { throw new Error('Storage failed'); });
            const result = await setMasterPassword('validpass123', mockSet);

            expect(result.success).toBe(false);
            expect(result.error).toBe('Storage failed');
        });
    });

    describe('verifyMasterPassword', () => {
        test('正しいパスワードで成功する', async () => {
            const saltBase64 = btoa(String.fromCharCode(...new Uint8Array(16).fill(1)));
            const mockGet = jest.fn(async () => ({
                'master_password_salt': saltBase64,
                'master_password_hash': 'hashed_value'
            }));

            const result = await verifyMasterPassword('correct_password', mockGet);
            expect(result.success).toBe(true);
        });

        test('間違ったパスワードでエラーを返す', async () => {
            const saltBase64 = btoa(String.fromCharCode(...new Uint8Array(16).fill(1)));
            const mockGet = jest.fn(async () => ({
                'master_password_salt': saltBase64,
                'master_password_hash': 'hashed_value'
            }));

            const result = await verifyMasterPassword('wrong_password', mockGet);
            expect(result.success).toBe(false);
            expect(result.error).toBe('Incorrect password');
        });

        test('マスターパスワード未設定の場合はエラー', async () => {
            const mockGet = jest.fn(async () => ({}));

            const result = await verifyMasterPassword('any_password', mockGet);
            expect(result.success).toBe(false);
            expect(result.error).toBe('Master password not set');
        });

        test('ストレージエラー時にエラーを返す', async () => {
            const mockGet = jest.fn(async () => { throw new Error('Storage error'); });

            const result = await verifyMasterPassword('any', mockGet);
            expect(result.success).toBe(false);
            expect(result.error).toBe('Storage error');
        });
    });

    describe('changeMasterPassword', () => {
        test('正しい旧パスワードで変更できる', async () => {
            const saltBase64 = btoa(String.fromCharCode(...new Uint8Array(16).fill(1)));
            const mockGet = jest.fn(async (keys: string[]) => {
                if (keys.includes('master_password_hash')) {
                    return {
                        'master_password_salt': saltBase64,
                        'master_password_hash': 'hashed_value'
                    };
                }
                if (keys.includes('master_password_salt')) {
                    return { 'master_password_salt': saltBase64 };
                }
                return {};
            });
            const mockSet = jest.fn(async () => {});
            const mockReencrypt = jest.fn(async () => {});

            const result = await changeMasterPassword(
                'correct_password',
                'newpassword123',
                mockGet,
                mockSet,
                mockReencrypt
            );

            expect(result.success).toBe(true);
            expect(mockSet).toHaveBeenCalledWith('master_password_salt', expect.any(String));
            expect(mockSet).toHaveBeenCalledWith('master_password_hash', 'hashed_value');
            expect(mockSet).toHaveBeenCalledWith('master_password_enabled', true);
        });

        test('間違った旧パスワードでエラーを返す', async () => {
            const saltBase64 = btoa(String.fromCharCode(...new Uint8Array(16).fill(1)));
            const mockGet = jest.fn(async () => ({
                'master_password_salt': saltBase64,
                'master_password_hash': 'hashed_value'
            }));
            const mockSet = jest.fn(async () => {});
            const mockReencrypt = jest.fn(async () => {});

            const result = await changeMasterPassword(
                'wrong_password',
                'newpassword123',
                mockGet,
                mockSet,
                mockReencrypt
            );

            expect(result.success).toBe(false);
            expect(result.error).toBe('Incorrect password');
        });

        test('新しいパスワードが短い場合はエラーを返す', async () => {
            const saltBase64 = btoa(String.fromCharCode(...new Uint8Array(16).fill(1)));
            const mockGet = jest.fn(async () => ({
                'master_password_salt': saltBase64,
                'master_password_hash': 'hashed_value'
            }));
            const mockSet = jest.fn(async () => {});
            const mockReencrypt = jest.fn(async () => {});

            const result = await changeMasterPassword(
                'correct_password',
                'short',
                mockGet,
                mockSet,
                mockReencrypt
            );

            expect(result.success).toBe(false);
            expect(result.error).toBe('Password must be at least 8 characters long');
        });

        test('暗号化されたAPIキーを再暗号化する', async () => {
            const saltBase64 = btoa(String.fromCharCode(...new Uint8Array(16).fill(1)));
            const encryptedData = { ciphertext: 'encrypted_old_secret', iv: 'test_iv' };
            const mockGet = jest.fn(async (keys: string[]) => {
                if (keys.includes('master_password_hash')) {
                    return {
                        'master_password_salt': saltBase64,
                        'master_password_hash': 'hashed_value'
                    };
                }
                if (keys.includes('master_password_salt')) {
                    return { 'master_password_salt': saltBase64 };
                }
                for (const key of keys) {
                    if (key.includes('api_key')) {
                        return { [key]: encryptedData };
                    }
                }
                return {};
            });
            const mockSet = jest.fn(async () => {});
            const mockReencrypt = jest.fn(async () => {});

            const result = await changeMasterPassword(
                'correct_password',
                'newpassword123',
                mockGet,
                mockSet,
                mockReencrypt
            );

            expect(result.success).toBe(true);
        });
    });

    describe('isMasterPasswordSet', () => {
        test('true の場合は true を返す', async () => {
            const mockGet = jest.fn(async () => ({
                'master_password_enabled': true
            }));
            const result = await isMasterPasswordSet(mockGet);
            expect(result).toBe(true);
        });

        test('false の場合は false を返す', async () => {
            const mockGet = jest.fn(async () => ({
                'master_password_enabled': false
            }));
            const result = await isMasterPasswordSet(mockGet);
            expect(result).toBe(false);
        });

        test('未設定(undefined)の場合は false を返す', async () => {
            const mockGet = jest.fn(async () => ({}));
            const result = await isMasterPasswordSet(mockGet);
            expect(result).toBe(false);
        });
    });
});
