/**
 * masterPassword.test.ts
 * masterPassword.ts の単体テスト
 */

import { Crypto } from '@peculiar/webcrypto';
Object.defineProperty(global, 'crypto', {
    value: new Crypto()
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
vi.mock('../crypto/index.js', () => ({
    generateSalt: vi.fn(() => new Uint8Array(16).fill(1)),
    hashPasswordWithPBKDF2: vi.fn(async (_password: string, _salt: Uint8Array) => 'hashed_value'),
    verifyPasswordWithPBKDF2: vi.fn(async (password: string, hash: string, _salt: Uint8Array) => {
        const isValid = password === 'correct_password' && hash === 'hashed_value';
        return { isValid, needsRehash: false };
    }),
    encrypt: vi.fn(async (plaintext: string, _key: CryptoKey) => ({
        ciphertext: 'encrypted_' + plaintext,
        iv: 'test_iv'
    })),
    decryptData: vi.fn(async (data: any, _key: CryptoKey) => {
        if (data.ciphertext === 'encrypted_old_secret') return 'old_secret';
        return 'decrypted_data';
    }),
    deriveKey: vi.fn(async (_password: string, _salt: Uint8Array) => 'mock_key' as unknown as CryptoKey)
}));

describe('masterPassword', () => {

    describe('calculatePasswordStrength', () => {
        test('returns score 0 and WEAK for an empty string', () => {
            const result = calculatePasswordStrength('');
            expect(result.score).toBe(0);
            expect(result.level).toBe(PasswordStrength.WEAK);
            expect(result.text).toBe('Weak');
        });

        test('returns score 20 and WEAK for 8 lowercase-only characters', () => {
            const result = calculatePasswordStrength('abcdefgh');
            expect(result.score).toBe(20);
            expect(result.level).toBe(PasswordStrength.WEAK);
        });

        test('adds 10 points for 12 or more characters', () => {
            const short = calculatePasswordStrength('abcdefgh');
            const long = calculatePasswordStrength('abcdefghijkl');
            expect(long.score).toBe(short.score + 10);
        });

        test('adds 20 points for mixed case', () => {
            const lower = calculatePasswordStrength('abcdefgh');
            const mixed = calculatePasswordStrength('Abcdefgh');
            expect(mixed.score).toBe(lower.score + 20);
        });

        test('adds 20 points for containing digits', () => {
            const noNum = calculatePasswordStrength('abcdefgh');
            const withNum = calculatePasswordStrength('abcd1234');
            expect(withNum.score).toBe(noNum.score + 20);
        });

        test('adds 30 points for containing special characters', () => {
            const noSpecial = calculatePasswordStrength('abcd1234');
            const withSpecial = calculatePasswordStrength('abcd1234!');
            expect(withSpecial.score).toBe(noSpecial.score + 30);
        });

        test('caps the score at 100', () => {
            // 8chars(+20) + 12chars(+10) + mixed(+20) + digit(+20) + special(+30) = 100
            const result = calculatePasswordStrength('Abcdef1!Ghijk');
            expect(result.score).toBe(100);
        });

        test('rates score below 40 as WEAK', () => {
            const result = calculatePasswordStrength('abcdefgh');
            expect(result.level).toBe(PasswordStrength.WEAK);
            expect(result.text).toBe('Weak');
        });

        test('rates score 40-79 as MEDIUM', () => {
            // 8chars(+20) + mixed case(+20) = 40
            const result = calculatePasswordStrength('Abcdefgh');
            expect(result.level).toBe(PasswordStrength.MEDIUM);
            expect(result.text).toBe('Medium');
        });

        test('rates score 80 and above as STRONG', () => {
            // 8chars(+20) + mixed(+20) + digit(+20) + special(+30) = 90
            const result = calculatePasswordStrength('Abcd1!ef');
            expect(result.level).toBe(PasswordStrength.STRONG);
            expect(result.text).toBe('Strong');
        });
    });

    describe('validatePasswordRequirements', () => {
        test('returns an error for an empty string', () => {
            expect(validatePasswordRequirements('')).toBe('Password is required');
        });

        test('returns an error for fewer than 12 characters (SSOT: 12 characters required)', () => {
            expect(validatePasswordRequirements('abc')).toBe('Password must be at least 12 characters long');
            expect(validatePasswordRequirements('Abc123!')).toBe('Password must be at least 12 characters long');
        });

        test('returns an error for fewer than 3 character classes', () => {
            // 12文字だが英小のみ / 2種のみは拒否
            expect(validatePasswordRequirements('abcdefghijkl')).not.toBeNull();
            expect(validatePasswordRequirements('abcdefgh1234')).not.toBeNull();
        });

        test('returns null for 12 or more characters with 3 or more classes', () => {
            expect(validatePasswordRequirements('Abcdef123!@#')).toBeNull();
            expect(validatePasswordRequirements('StrongPass123!')).toBeNull();
        });
    });

    describe('validatePasswordMatch', () => {
        test('returns null when passwords match', () => {
            expect(validatePasswordMatch('abc', 'abc')).toBeNull();
        });

        test('returns an error message when passwords do not match', () => {
            expect(validatePasswordMatch('abc', 'xyz')).toBe('Passwords do not match');
        });

        test('treats two empty strings as matching', () => {
            expect(validatePasswordMatch('', '')).toBeNull();
        });
    });

    describe('setMasterPassword', () => {
        test('succeeds with a valid password (meets SSOT strength)', async () => {
            const mockSet = vi.fn(async () => {});
            const result = await setMasterPassword('StrongPass123!@#', mockSet);

            expect(result.success).toBe(true);
            expect(result.error).toBeUndefined();
            expect(mockSet).toHaveBeenCalledTimes(3);
            expect(mockSet).toHaveBeenCalledWith('master_password_salt', expect.any(String));
            expect(mockSet).toHaveBeenCalledWith('master_password_hash', 'hashed_value');
            expect(mockSet).toHaveBeenCalledWith('master_password_enabled', true);
        });

        test('returns an error for a short password (SSOT 12 characters)', async () => {
            const mockSet = vi.fn(async () => {});
            const result = await setMasterPassword('short', mockSet);

            expect(result.success).toBe(false);
            expect(result.error).toBe('Password must be at least 12 characters long');
            expect(mockSet).not.toHaveBeenCalled();
        });

        test('returns an error for an empty password', async () => {
            const mockSet = vi.fn(async () => {});
            const result = await setMasterPassword('', mockSet);

            expect(result.success).toBe(false);
            expect(result.error).toBe('Password is required');
        });

        test('returns an error on storage failure', async () => {
            const mockSet = vi.fn(async () => { throw new Error('Storage failed'); });
            const result = await setMasterPassword('StrongPass123!@#', mockSet);

            expect(result.success).toBe(false);
            expect(result.error).toBe('Storage failed');
        });
    });

    describe('verifyMasterPassword', () => {
        test('succeeds with the correct password', async () => {
            const saltBase64 = btoa(String.fromCharCode(...new Uint8Array(16).fill(1)));
            const mockGet = vi.fn(async () => ({
                'master_password_salt': saltBase64,
                'master_password_hash': 'hashed_value'
            }));

            const result = await verifyMasterPassword('correct_password', mockGet);
            expect(result.success).toBe(true);
        });

        test('returns an error for a wrong password', async () => {
            const saltBase64 = btoa(String.fromCharCode(...new Uint8Array(16).fill(1)));
            const mockGet = vi.fn(async () => ({
                'master_password_salt': saltBase64,
                'master_password_hash': 'hashed_value'
            }));

            const result = await verifyMasterPassword('wrong_password', mockGet);
            expect(result.success).toBe(false);
            expect(result.error).toBe('Incorrect password');
        });

        test('returns an error when no master password is set', async () => {
            const mockGet = vi.fn(async () => ({}));

            const result = await verifyMasterPassword('any_password', mockGet);
            expect(result.success).toBe(false);
            expect(result.error).toBe('Master password not set');
        });

        test('returns an error on storage failure', async () => {
            const mockGet = vi.fn(async () => { throw new Error('Storage error'); });

            const result = await verifyMasterPassword('any', mockGet);
            expect(result.success).toBe(false);
            expect(result.error).toBe('Storage error');
        });
    });

    describe('changeMasterPassword', () => {
        test('changes the password with the correct old password (new password meets SSOT strength)', async () => {
            const saltBase64 = btoa(String.fromCharCode(...new Uint8Array(16).fill(1)));
            const mockGet = vi.fn(async (keys: string[]) => {
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
            const mockSet = vi.fn(async () => {});
            const mockReencrypt = vi.fn(async () => {});

            const result = await changeMasterPassword(
                'correct_password',
                'NewStrongPass123!@#',
                mockGet,
                mockSet,
                mockReencrypt
            );

            expect(result.success).toBe(true);
            expect(mockSet).toHaveBeenCalledWith('master_password_salt', expect.any(String));
            expect(mockSet).toHaveBeenCalledWith('master_password_hash', 'hashed_value');
            expect(mockSet).toHaveBeenCalledWith('master_password_enabled', true);
        });

        test('returns an error for a wrong old password', async () => {
            const saltBase64 = btoa(String.fromCharCode(...new Uint8Array(16).fill(1)));
            const mockGet = vi.fn(async () => ({
                'master_password_salt': saltBase64,
                'master_password_hash': 'hashed_value'
            }));
            const mockSet = vi.fn(async () => {});
            const mockReencrypt = vi.fn(async () => {});

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

        test('returns an error when the new password is short (SSOT 12 characters)', async () => {
            const saltBase64 = btoa(String.fromCharCode(...new Uint8Array(16).fill(1)));
            const mockGet = vi.fn(async () => ({
                'master_password_salt': saltBase64,
                'master_password_hash': 'hashed_value'
            }));
            const mockSet = vi.fn(async () => {});
            const mockReencrypt = vi.fn(async () => {});

            const result = await changeMasterPassword(
                'correct_password',
                'short',
                mockGet,
                mockSet,
                mockReencrypt
            );

            expect(result.success).toBe(false);
            expect(result.error).toBe('Password must be at least 12 characters long');
        });

        test('re-encrypts encrypted API keys', async () => {
            const saltBase64 = btoa(String.fromCharCode(...new Uint8Array(16).fill(1)));
            const encryptedData = { ciphertext: 'encrypted_old_secret', iv: 'test_iv' };
            const mockGet = vi.fn(async (keys: string[]) => {
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
            const mockSet = vi.fn(async () => {});
            const mockReencrypt = vi.fn(async () => {});

            const result = await changeMasterPassword(
                'correct_password',
                'NewStrongPass123!@#',
                mockGet,
                mockSet,
                mockReencrypt
            );

            expect(result.success).toBe(true);
        });
    });

    describe('isMasterPasswordSet', () => {
        test('returns true when the flag is true', async () => {
            const mockGet = vi.fn(async () => ({
                'master_password_enabled': true
            }));
            const result = await isMasterPasswordSet(mockGet);
            expect(result).toBe(true);
        });

        test('returns false when the flag is false', async () => {
            const mockGet = vi.fn(async () => ({
                'master_password_enabled': false
            }));
            const result = await isMasterPasswordSet(mockGet);
            expect(result).toBe(false);
        });

        test('returns false when the flag is unset (undefined)', async () => {
            const mockGet = vi.fn(async () => ({}));
            const result = await isMasterPasswordSet(mockGet);
            expect(result).toBe(false);
        });
    });
});
