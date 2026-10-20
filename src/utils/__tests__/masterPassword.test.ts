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

        // PBI 15 pin: score boundaries. Weights are multiples of 10, so the
        // 39/40 and 79/80 thresholds land on 30/40/70/80.
        test('rates score 30 (just below the 40 threshold) as WEAK', () => {
            // 12 lowercase chars: 20(len>=8) + 10(len>=12) = 30
            const result = calculatePasswordStrength('abcdefghijkl');
            expect(result.score).toBe(30);
            expect(result.level).toBe(PasswordStrength.WEAK);
            expect(result.text).toBe('Weak');
        });

        test('rates score 70 (just below the 80 threshold) as MEDIUM', () => {
            // 12 chars, mixed case + digit: 20 + 10 + 20 + 20 = 70
            const result = calculatePasswordStrength('Abcdefgh1234');
            expect(result.score).toBe(70);
            expect(result.level).toBe(PasswordStrength.MEDIUM);
            expect(result.text).toBe('Medium');
        });

        test('rates exactly score 80 as STRONG', () => {
            // 14 chars, lowercase + digit + special: 20 + 10 + 20 + 30 = 80
            const result = calculatePasswordStrength('abcdefgh1234!@');
            expect(result.score).toBe(80);
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
});
