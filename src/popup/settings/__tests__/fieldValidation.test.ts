/**
 * fieldValidation.test.ts
 * fieldValidation.ts の単体テスト
 */

import { JSDOM } from 'jsdom';

// chrome モック
(globalThis as any).chrome = {
    i18n: { getMessage: jest.fn((key: string) => key) },
    storage: { local: { get: jest.fn(), set: jest.fn() } }
};

// i18n モック
jest.mock('../../i18n.js', () => ({
    getMessage: jest.fn((key: string) => key)
}));

import {
    setFieldError,
    clearFieldError,
    clearAllFieldErrors,
    validateProtocol,
    validatePort,
    validateMinVisitDuration,
    validateMinScrollDepth,
    validateMaxTokens
} from '../fieldValidation.js';

describe('fieldValidation', () => {

    beforeEach(() => {
        document.body.innerHTML = `
            <input id="protocol" type="text" />
            <span id="protocol-error"></span>
            <input id="port" type="text" />
            <span id="port-error"></span>
            <input id="visit" type="text" />
            <span id="visit-error"></span>
            <input id="scroll" type="text" />
            <span id="scroll-error"></span>
            <input id="tokens" type="text" />
            <span id="tokens-error"></span>
        `;
    });

    describe('setFieldError', () => {
        test('aria-invalid を true に設定してエラーを表示する', () => {
            const input = document.getElementById('protocol') as HTMLInputElement;
            const errorEl = document.getElementById('protocol-error') as HTMLElement;

            setFieldError(input, 'protocol-error', 'Invalid');

            expect(input.getAttribute('aria-invalid')).toBe('true');
            expect(errorEl.textContent).toBe('Invalid');
            expect(errorEl.classList.contains('visible')).toBe(true);
        });

        test('エラー要素が null の場合でもエラーを投げない', () => {
            const input = document.createElement('input');
            expect(() => setFieldError(input, 'nonexistent', 'msg')).not.toThrow();
        });
    });

    describe('clearFieldError', () => {
        test('aria-invalid を false にしてエラーを非表示にする', () => {
            const input = document.getElementById('protocol') as HTMLInputElement;
            const errorEl = document.getElementById('protocol-error') as HTMLElement;
            input.setAttribute('aria-invalid', 'true');
            errorEl.classList.add('visible');
            errorEl.textContent = 'Error';

            clearFieldError(input, 'protocol-error');

            expect(input.getAttribute('aria-invalid')).toBe('false');
            expect(errorEl.textContent).toBe('');
            expect(errorEl.classList.contains('visible')).toBe(false);
        });

        test('エラー要素が null の場合でもエラーを投げない', () => {
            const input = document.createElement('input');
            expect(() => clearFieldError(input, 'nonexistent')).not.toThrow();
        });
    });

    describe('clearAllFieldErrors', () => {
        test('複数のエラーをクリアする', () => {
            const pInput = document.getElementById('protocol') as HTMLInputElement;
            const portInput = document.getElementById('port') as HTMLInputElement;
            pInput.setAttribute('aria-invalid', 'true');
            portInput.setAttribute('aria-invalid', 'true');

            clearAllFieldErrors([
                [pInput, 'protocol-error'],
                [portInput, 'port-error']
            ]);

            expect(pInput.getAttribute('aria-invalid')).toBe('false');
            expect(portInput.getAttribute('aria-invalid')).toBe('false');
        });
    });

    describe('validateProtocol', () => {
        test('http で有効', () => {
            const input = document.getElementById('protocol') as HTMLInputElement;
            input.value = 'http';
            expect(validateProtocol(input)).toBe(true);
            expect(input.getAttribute('aria-invalid')).not.toBe('true');
        });

        test('https で有効', () => {
            const input = document.getElementById('protocol') as HTMLInputElement;
            input.value = 'https';
            expect(validateProtocol(input)).toBe(true);
        });

        test('ftp で無効', () => {
            const input = document.getElementById('protocol') as HTMLInputElement;
            input.value = 'ftp';
            expect(validateProtocol(input)).toBe(false);
            expect(input.getAttribute('aria-invalid')).toBe('true');
        });

        test('空文字で無効', () => {
            const input = document.getElementById('protocol') as HTMLInputElement;
            input.value = '';
            expect(validateProtocol(input)).toBe(false);
        });
    });

    describe('validatePort', () => {
        test('1 で有効', () => {
            const input = document.getElementById('port') as HTMLInputElement;
            input.value = '1';
            expect(validatePort(input)).toBe(true);
        });

        test('65535 で有効', () => {
            const input = document.getElementById('port') as HTMLInputElement;
            input.value = '65535';
            expect(validatePort(input)).toBe(true);
        });

        test('0 で無効', () => {
            const input = document.getElementById('port') as HTMLInputElement;
            input.value = '0';
            expect(validatePort(input)).toBe(false);
        });

        test('65536 で無効', () => {
            const input = document.getElementById('port') as HTMLInputElement;
            input.value = '65536';
            expect(validatePort(input)).toBe(false);
        });

        test('負数で無効', () => {
            const input = document.getElementById('port') as HTMLInputElement;
            input.value = '-1';
            expect(validatePort(input)).toBe(false);
        });

        test('数値以外で無効', () => {
            const input = document.getElementById('port') as HTMLInputElement;
            input.value = 'abc';
            expect(validatePort(input)).toBe(false);
        });
    });

    describe('validateMinVisitDuration', () => {
        test('0 で有効', () => {
            const input = document.getElementById('visit') as HTMLInputElement;
            input.value = '0';
            expect(validateMinVisitDuration(input)).toBe(true);
        });

        test('正の整数で有効', () => {
            const input = document.getElementById('visit') as HTMLInputElement;
            input.value = '30';
            expect(validateMinVisitDuration(input)).toBe(true);
        });

        test('負数で無効', () => {
            const input = document.getElementById('visit') as HTMLInputElement;
            input.value = '-1';
            expect(validateMinVisitDuration(input)).toBe(false);
        });
    });

    describe('validateMinScrollDepth', () => {
        test('0 で有効', () => {
            const input = document.getElementById('scroll') as HTMLInputElement;
            input.value = '0';
            expect(validateMinScrollDepth(input)).toBe(true);
        });

        test('100 で有効', () => {
            const input = document.getElementById('scroll') as HTMLInputElement;
            input.value = '100';
            expect(validateMinScrollDepth(input)).toBe(true);
        });

        test('101 で無効', () => {
            const input = document.getElementById('scroll') as HTMLInputElement;
            input.value = '101';
            expect(validateMinScrollDepth(input)).toBe(false);
        });

        test('-1 で無効', () => {
            const input = document.getElementById('scroll') as HTMLInputElement;
            input.value = '-1';
            expect(validateMinScrollDepth(input)).toBe(false);
        });
    });

    describe('validateMaxTokens', () => {
        test('10 で有効（最小値）', () => {
            const input = document.getElementById('tokens') as HTMLInputElement;
            input.value = '10';
            expect(validateMaxTokens(input)).toBe(true);
        });

        test('16000 で有効（最大値）', () => {
            const input = document.getElementById('tokens') as HTMLInputElement;
            input.value = '16000';
            expect(validateMaxTokens(input)).toBe(true);
        });

        test('9 で無効', () => {
            const input = document.getElementById('tokens') as HTMLInputElement;
            input.value = '9';
            expect(validateMaxTokens(input)).toBe(false);
        });

        test('16001 で無効', () => {
            const input = document.getElementById('tokens') as HTMLInputElement;
            input.value = '16001';
            expect(validateMaxTokens(input)).toBe(false);
        });
    });
});
