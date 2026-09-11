/**
 * masterPasswordUiCore.test.ts
 * マスターパスワードUI共有ロジックの単体テスト
 */

import { describe, test, expect, vi } from 'vitest';
import {
    validateAndSetPasswordErrors,
    validateAndSetMatchErrors,
    buildSetStorageFn,
    buildGetStorageFn,
    updatePasswordStrengthDisplay,
} from '../masterPasswordUiCore.js';

describe('masterPasswordUiCore', () => {
    describe('validateAndSetPasswordErrors', () => {
        test('sets a message on the error element when requirements are not met', () => {
            const errorEl = { textContent: '', classList: { add: vi.fn() } } as any;
            const result = validateAndSetPasswordErrors('ab', errorEl);
            expect(result).toBe(true); // hasError
            expect(errorEl.textContent).toBeTruthy();
            expect(errorEl.classList.add).toHaveBeenCalledWith('visible');
        });

        test('sets no error when requirements are met', () => {
            const errorEl = { textContent: '', classList: { add: vi.fn() } } as any;
            const result = validateAndSetPasswordErrors('securePassword123', errorEl);
            expect(result).toBe(false); // no error
            expect(errorEl.classList.add).not.toHaveBeenCalled();
        });

        test('sets no error when the error element is null', () => {
            const result = validateAndSetPasswordErrors('ab', null);
            expect(result).toBe(false);
        });
    });

    describe('validateAndSetMatchErrors', () => {
        test('sets an error when passwords do not match', () => {
            const errorEl = { textContent: '', classList: { add: vi.fn() } } as any;
            const result = validateAndSetMatchErrors('password1', 'password2', errorEl);
            expect(result).toBe(true);
            expect(errorEl.classList.add).toHaveBeenCalledWith('visible');
        });

        test('sets no error when passwords match', () => {
            const errorEl = { textContent: '', classList: { add: vi.fn() } } as any;
            const result = validateAndSetMatchErrors('password1', 'password1', errorEl);
            expect(result).toBe(false);
        });

        test('sets no error when the error element is null', () => {
            const result = validateAndSetMatchErrors('password1', 'password2', null);
            expect(result).toBe(false);
        });
    });

    describe('buildSetStorageFn', () => {
        test('returns a function that calls chrome.storage.local.set', async () => {
            const setFn = buildSetStorageFn();
            await setFn('test_key', 'test_value');
            expect(chrome.storage.local.set).toHaveBeenCalledWith({ test_key: 'test_value' });
        });
    });

    describe('buildGetStorageFn', () => {
        test('returns a function that calls chrome.storage.local.get', async () => {
            const getFn = buildGetStorageFn();
            await getFn(['test_key']);
            expect(chrome.storage.local.get).toHaveBeenCalledWith(['test_key']);
        });
    });

    describe('updatePasswordStrengthDisplay', () => {
        const calculatePasswordStrength = () => {
            return { score: 80, level: 'strong', text: 'Strong' };
        };

        test('renders 0% width with weak level for an empty password', () => {
            const bar = { style: { width: '' }, className: '' } as any;
            const text = { textContent: '' } as any;
            updatePasswordStrengthDisplay('', bar, text, calculatePasswordStrength);
            expect(bar.style.width).toBe('0%');
            expect(bar.className).toBe('strength-fill');
            expect(text.textContent).toBeTruthy();
        });

        test('updates the display with the computed result on password input', () => {
            const bar = { style: { width: '' }, className: '' } as any;
            const text = { textContent: '' } as any;
            updatePasswordStrengthDisplay('abcdefgh', bar, text, calculatePasswordStrength);
            expect(bar.style.width).toBe('80%');
            expect(bar.className).toBe('strength-fill strong');
            expect(text.textContent).toBeTruthy();
        });

        test('does nothing when elements are null', () => {
            expect(() =>
                updatePasswordStrengthDisplay('abcdefgh', null, null, calculatePasswordStrength)
            ).not.toThrow();
        });
    });
});
