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
    isMasterPasswordSet,
    PasswordStrength
} from '../masterPassword.js';

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
