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
        test('要件を満たさない場合はエラー要素にメッセージを設定する', () => {
            const errorEl = { textContent: '', classList: { add: vi.fn() } } as any;
            const result = validateAndSetPasswordErrors('ab', errorEl);
            expect(result).toBe(true); // hasError
            expect(errorEl.textContent).toBeTruthy();
            expect(errorEl.classList.add).toHaveBeenCalledWith('visible');
        });

        test('要件を満たす場合はエラーを設定しない', () => {
            const errorEl = { textContent: '', classList: { add: vi.fn() } } as any;
            const result = validateAndSetPasswordErrors('securePassword123', errorEl);
            expect(result).toBe(false); // no error
            expect(errorEl.classList.add).not.toHaveBeenCalled();
        });

        test('エラー要素がnullの場合はエラーを設定しない', () => {
            const result = validateAndSetPasswordErrors('ab', null);
            expect(result).toBe(false);
        });
    });

    describe('validateAndSetMatchErrors', () => {
        test('パスワード不一致の場合はエラーを設定する', () => {
            const errorEl = { textContent: '', classList: { add: vi.fn() } } as any;
            const result = validateAndSetMatchErrors('password1', 'password2', errorEl);
            expect(result).toBe(true);
            expect(errorEl.classList.add).toHaveBeenCalledWith('visible');
        });

        test('パスワード一致の場合はエラーを設定しない', () => {
            const errorEl = { textContent: '', classList: { add: vi.fn() } } as any;
            const result = validateAndSetMatchErrors('password1', 'password1', errorEl);
            expect(result).toBe(false);
        });

        test('エラー要素がnullの場合はエラーを設定しない', () => {
            const result = validateAndSetMatchErrors('password1', 'password2', null);
            expect(result).toBe(false);
        });
    });

    describe('buildSetStorageFn', () => {
        test('chrome.storage.local.set を呼び出す関数を返す', async () => {
            const setFn = buildSetStorageFn();
            await setFn('test_key', 'test_value');
            expect(chrome.storage.local.set).toHaveBeenCalledWith({ test_key: 'test_value' });
        });
    });

    describe('buildGetStorageFn', () => {
        test('chrome.storage.local.get を呼び出す関数を返す', async () => {
            const getFn = buildGetStorageFn();
            await getFn(['test_key']);
            expect(chrome.storage.local.get).toHaveBeenCalledWith(['test_key']);
        });
    });

    describe('updatePasswordStrengthDisplay', () => {
        const calculatePasswordStrength = () => {
            return { score: 80, level: 'strong', text: 'Strong' };
        };

        test('空パスワードは幅0%と弱レベル表示になる', () => {
            const bar = { style: { width: '' }, className: '' } as any;
            const text = { textContent: '' } as any;
            updatePasswordStrengthDisplay('', bar, text, calculatePasswordStrength);
            expect(bar.style.width).toBe('0%');
            expect(bar.className).toBe('strength-fill');
            expect(text.textContent).toBeTruthy();
        });

        test('パスワード入力時は計算結果で表示を更新する', () => {
            const bar = { style: { width: '' }, className: '' } as any;
            const text = { textContent: '' } as any;
            updatePasswordStrengthDisplay('abcdefgh', bar, text, calculatePasswordStrength);
            expect(bar.style.width).toBe('80%');
            expect(bar.className).toBe('strength-fill strong');
            expect(text.textContent).toBeTruthy();
        });

        test('要素がnullの場合は何もしない', () => {
            expect(() =>
                updatePasswordStrengthDisplay('abcdefgh', null, null, calculatePasswordStrength)
            ).not.toThrow();
        });
    });
});
