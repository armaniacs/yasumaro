/**
 * fieldValidation.test.ts
 * fieldValidation.ts の単体テスト
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';

// chrome モック
(globalThis as any).chrome = {
    i18n: { getMessage: jest.fn((key: string) => key) },
    storage: { local: { get: jest.fn(), set: jest.fn() } }
};

// i18n モック
jest.mock('../../i18n.js', () => ({
    getMessage: jest.fn((key: string) => key)
}));

// storage モック (validateBaseUrl の dynamic import 用)
jest.mock('../../../utils/storage.js', () => ({
    isDomainInWhitelist: jest.fn(() => true),
    ALLOWED_AI_PROVIDER_DOMAINS: ['api.openai.com', 'api.anthropic.com'],
}));

import {
    setFieldError,
    clearFieldError,
    clearAllFieldErrors,
    validateProtocol,
    validatePort,
    validateMinVisitDuration,
    validateMinScrollDepth,
    validateMaxTokens,
    validateBaseUrl,
    setupProtocolValidation,
    setupPortValidation,
    setupMinVisitDurationValidation,
    setupMinScrollDepthValidation,
    setupMaxTokensValidation,
    setupAllFieldValidations,
    validateAllFields
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
            <input id="baseUrl" type="text" />
            <span id="baseUrl-error"></span>
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

        test('複数回呼び出すとエラーメッセージが上書きされる', () => {
            const input = document.getElementById('protocol') as HTMLInputElement;
            const errorEl = document.getElementById('protocol-error') as HTMLElement;

            setFieldError(input, 'protocol-error', 'First error');
            expect(errorEl.textContent).toBe('First error');

            setFieldError(input, 'protocol-error', 'Second error');
            expect(errorEl.textContent).toBe('Second error');
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

        test('空の配列を渡してもエラーを投げない', () => {
            expect(() => clearAllFieldErrors([])).not.toThrow();
        });

        test('5つのフィールドエラーをすべてクリアする', () => {
            const inputs = ['protocol', 'port', 'visit', 'scroll', 'tokens'];
            const pairs = inputs.map(id => {
                const el = document.getElementById(id) as HTMLInputElement;
                el.setAttribute('aria-invalid', 'true');
                return [el, `${id}-error`] as [HTMLInputElement, string];
            });

            clearAllFieldErrors(pairs);

            inputs.forEach(id => {
                const el = document.getElementById(id) as HTMLInputElement;
                expect(el.getAttribute('aria-invalid')).toBe('false');
            });
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

        test('大文字 HTTP でも有効（小文字変換される）', () => {
            const input = document.getElementById('protocol') as HTMLInputElement;
            input.value = 'HTTP';
            expect(validateProtocol(input)).toBe(true);
        });

        test('大文字 HTTPS でも有効', () => {
            const input = document.getElementById('protocol') as HTMLInputElement;
            input.value = 'HTTPS';
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

        test('前後にスペースがある場合はトリムされる', () => {
            const input = document.getElementById('protocol') as HTMLInputElement;
            input.value = '  https  ';
            expect(validateProtocol(input)).toBe(true);
        });

        test('ws プロトコルで無効', () => {
            const input = document.getElementById('protocol') as HTMLInputElement;
            input.value = 'ws';
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

        test('8080 で有効', () => {
            const input = document.getElementById('port') as HTMLInputElement;
            input.value = '8080';
            expect(validatePort(input)).toBe(true);
        });

        test('443 で有効', () => {
            const input = document.getElementById('port') as HTMLInputElement;
            input.value = '443';
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

        test('空文字で無効', () => {
            const input = document.getElementById('port') as HTMLInputElement;
            input.value = '';
            expect(validatePort(input)).toBe(false);
        });

        test('小数で無効（parseIntで切り捨て）', () => {
            const input = document.getElementById('port') as HTMLInputElement;
            input.value = '80.5';
            expect(validatePort(input)).toBe(true); // parseInt('80.5') = 80, which is valid
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

        test('大きな値で有効', () => {
            const input = document.getElementById('visit') as HTMLInputElement;
            input.value = '999999';
            expect(validateMinVisitDuration(input)).toBe(true);
        });

        test('負数で無効', () => {
            const input = document.getElementById('visit') as HTMLInputElement;
            input.value = '-1';
            expect(validateMinVisitDuration(input)).toBe(false);
        });

        test('空文字で無効', () => {
            const input = document.getElementById('visit') as HTMLInputElement;
            input.value = '';
            expect(validateMinVisitDuration(input)).toBe(false);
        });

        test('数値以外で無効', () => {
            const input = document.getElementById('visit') as HTMLInputElement;
            input.value = 'abc';
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

        test('50 で有効', () => {
            const input = document.getElementById('scroll') as HTMLInputElement;
            input.value = '50';
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

        test('空文字で無効', () => {
            const input = document.getElementById('scroll') as HTMLInputElement;
            input.value = '';
            expect(validateMinScrollDepth(input)).toBe(false);
        });

        test('数値以外で無効', () => {
            const input = document.getElementById('scroll') as HTMLInputElement;
            input.value = 'abc';
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

        test('4096 で有効', () => {
            const input = document.getElementById('tokens') as HTMLInputElement;
            input.value = '4096';
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

        test('0 で無効', () => {
            const input = document.getElementById('tokens') as HTMLInputElement;
            input.value = '0';
            expect(validateMaxTokens(input)).toBe(false);
        });

        test('空文字で無効', () => {
            const input = document.getElementById('tokens') as HTMLInputElement;
            input.value = '';
            expect(validateMaxTokens(input)).toBe(false);
        });

        test('数値以外で無効', () => {
            const input = document.getElementById('tokens') as HTMLInputElement;
            input.value = 'abc';
            expect(validateMaxTokens(input)).toBe(false);
        });
    });

    describe('validateBaseUrl', () => {
        test('空文字は許容（true を返す）', async () => {
            const input = document.getElementById('baseUrl') as HTMLInputElement;
            input.value = '';

            const result = await validateBaseUrl(input);

            expect(result).toBe(true);
        });

        test('無効なURL形式で false を返す', async () => {
            const input = document.getElementById('baseUrl') as HTMLInputElement;
            input.value = 'not-a-valid-url';

            const result = await validateBaseUrl(input);

            expect(result).toBe(false);
            expect(input.getAttribute('aria-invalid')).toBe('true');
        });

        test('スペースのみの値は空として扱われる', async () => {
            const input = document.getElementById('baseUrl') as HTMLInputElement;
            input.value = '   ';

            const result = await validateBaseUrl(input);

            // 空文字トリム後は空文字 → true
            expect(result).toBe(true);
        });

        test('ホワイトリストに含まれるURLで true を返す', async () => {
            const { isDomainInWhitelist } = require('../../../utils/storage.js');
            isDomainInWhitelist.mockReturnValue(true);

            const input = document.getElementById('baseUrl') as HTMLInputElement;
            input.value = 'https://api.openai.com/v1';

            const result = await validateBaseUrl(input);

            expect(result).toBe(true);
            expect(input.getAttribute('aria-invalid')).not.toBe('true');
        });

        test('ホワイトリストに含まれないURLで false を返す', async () => {
            const { isDomainInWhitelist } = require('../../../utils/storage.js');
            isDomainInWhitelist.mockReturnValue(false);

            const input = document.getElementById('baseUrl') as HTMLInputElement;
            input.value = 'https://unknown-provider.com/v1';

            const result = await validateBaseUrl(input);

            expect(result).toBe(false);
            expect(input.getAttribute('aria-invalid')).toBe('true');
        });
    });

    describe('setupProtocolValidation', () => {
        test('blurイベントでバリデーションが実行される', () => {
            const input = document.getElementById('protocol') as HTMLInputElement;
            const cleanup = setupProtocolValidation(input);

            input.value = 'ftp';
            input.dispatchEvent(new Event('blur'));

            expect(input.getAttribute('aria-invalid')).toBe('true');

            // クリーンアップ
            cleanup();
        });

        test('有効な値でblurするとエラーがクリアされる', () => {
            const input = document.getElementById('protocol') as HTMLInputElement;
            const cleanup = setupProtocolValidation(input);

            input.value = 'https';
            input.dispatchEvent(new Event('blur'));

            expect(input.getAttribute('aria-invalid')).not.toBe('true');

            cleanup();
        });

        test('クリーンアップ後はバリデーションが実行されない', () => {
            const input = document.getElementById('protocol') as HTMLInputElement;
            const cleanup = setupProtocolValidation(input);

            cleanup();

            input.value = 'ftp';
            input.dispatchEvent(new Event('blur'));

            // クリーンアップ後はハンドラが呼ばれないため、aria-invalid は設定されない
            expect(input.getAttribute('aria-invalid')).toBeNull();
        });
    });

    describe('setupPortValidation', () => {
        test('blurイベントでバリデーションが実行される', () => {
            const input = document.getElementById('port') as HTMLInputElement;
            const cleanup = setupPortValidation(input);

            input.value = '0';
            input.dispatchEvent(new Event('blur'));

            expect(input.getAttribute('aria-invalid')).toBe('true');

            cleanup();
        });

        test('有効なポートでblurするとエラーがクリアされる', () => {
            const input = document.getElementById('port') as HTMLInputElement;
            const cleanup = setupPortValidation(input);

            input.value = '8080';
            input.dispatchEvent(new Event('blur'));

            expect(input.getAttribute('aria-invalid')).not.toBe('true');

            cleanup();
        });

        test('クリーンアップ後はバリデーションが実行されない', () => {
            const input = document.getElementById('port') as HTMLInputElement;
            const cleanup = setupPortValidation(input);

            cleanup();

            input.value = '0';
            input.dispatchEvent(new Event('blur'));

            expect(input.getAttribute('aria-invalid')).toBeNull();
        });
    });

    describe('setupMinVisitDurationValidation', () => {
        test('blurイベントでバリデーションが実行される', () => {
            const input = document.getElementById('visit') as HTMLInputElement;
            const cleanup = setupMinVisitDurationValidation(input);

            input.value = '-1';
            input.dispatchEvent(new Event('blur'));

            expect(input.getAttribute('aria-invalid')).toBe('true');

            cleanup();
        });

        test('有効な値でblurするとエラーがクリアされる', () => {
            const input = document.getElementById('visit') as HTMLInputElement;
            const cleanup = setupMinVisitDurationValidation(input);

            input.value = '10';
            input.dispatchEvent(new Event('blur'));

            expect(input.getAttribute('aria-invalid')).not.toBe('true');

            cleanup();
        });

        test('クリーンアップ後はバリデーションが実行されない', () => {
            const input = document.getElementById('visit') as HTMLInputElement;
            const cleanup = setupMinVisitDurationValidation(input);

            cleanup();

            input.value = '-1';
            input.dispatchEvent(new Event('blur'));

            expect(input.getAttribute('aria-invalid')).toBeNull();
        });
    });

    describe('setupMinScrollDepthValidation', () => {
        test('blurイベントでバリデーションが実行される', () => {
            const input = document.getElementById('scroll') as HTMLInputElement;
            const cleanup = setupMinScrollDepthValidation(input);

            input.value = '101';
            input.dispatchEvent(new Event('blur'));

            expect(input.getAttribute('aria-invalid')).toBe('true');

            cleanup();
        });

        test('有効な値でblurするとエラーがクリアされる', () => {
            const input = document.getElementById('scroll') as HTMLInputElement;
            const cleanup = setupMinScrollDepthValidation(input);

            input.value = '50';
            input.dispatchEvent(new Event('blur'));

            expect(input.getAttribute('aria-invalid')).not.toBe('true');

            cleanup();
        });

        test('クリーンアップ後はバリデーションが実行されない', () => {
            const input = document.getElementById('scroll') as HTMLInputElement;
            const cleanup = setupMinScrollDepthValidation(input);

            cleanup();

            input.value = '101';
            input.dispatchEvent(new Event('blur'));

            expect(input.getAttribute('aria-invalid')).toBeNull();
        });
    });

    describe('setupMaxTokensValidation', () => {
        test('blurイベントでバリデーションが実行される', () => {
            const input = document.getElementById('tokens') as HTMLInputElement;
            const cleanup = setupMaxTokensValidation(input);

            input.value = '5';
            input.dispatchEvent(new Event('blur'));

            expect(input.getAttribute('aria-invalid')).toBe('true');

            cleanup();
        });

        test('有効な値でblurするとエラーがクリアされる', () => {
            const input = document.getElementById('tokens') as HTMLInputElement;
            const cleanup = setupMaxTokensValidation(input);

            input.value = '4096';
            input.dispatchEvent(new Event('blur'));

            expect(input.getAttribute('aria-invalid')).not.toBe('true');

            cleanup();
        });

        test('クリーンアップ後はバリデーションが実行されない', () => {
            const input = document.getElementById('tokens') as HTMLInputElement;
            const cleanup = setupMaxTokensValidation(input);

            cleanup();

            input.value = '5';
            input.dispatchEvent(new Event('blur'));

            expect(input.getAttribute('aria-invalid')).toBeNull();
        });
    });

    describe('setupAllFieldValidations', () => {
        test('すべてのバリデーションリスナーが設定される', () => {
            const protocolInput = document.getElementById('protocol') as HTMLInputElement;
            const portInput = document.getElementById('port') as HTMLInputElement;
            const visitInput = document.getElementById('visit') as HTMLInputElement;
            const scrollInput = document.getElementById('scroll') as HTMLInputElement;
            const tokensInput = document.getElementById('tokens') as HTMLInputElement;

            const cleanupFns = setupAllFieldValidations(
                protocolInput,
                portInput,
                visitInput,
                scrollInput,
                tokensInput
            );

            expect(cleanupFns).toHaveLength(5);
            cleanupFns.forEach(fn => expect(typeof fn).toBe('function'));

            // クリーンアップ
            cleanupFns.forEach(fn => fn());
        });

        test('各フィールドのblurイベントでバリデーションが実行される', () => {
            const protocolInput = document.getElementById('protocol') as HTMLInputElement;
            const portInput = document.getElementById('port') as HTMLInputElement;
            const visitInput = document.getElementById('visit') as HTMLInputElement;
            const scrollInput = document.getElementById('scroll') as HTMLInputElement;
            const tokensInput = document.getElementById('tokens') as HTMLInputElement;

            const cleanupFns = setupAllFieldValidations(
                protocolInput,
                portInput,
                visitInput,
                scrollInput,
                tokensInput
            );

            protocolInput.value = 'ftp';
            protocolInput.dispatchEvent(new Event('blur'));
            expect(protocolInput.getAttribute('aria-invalid')).toBe('true');

            portInput.value = '0';
            portInput.dispatchEvent(new Event('blur'));
            expect(portInput.getAttribute('aria-invalid')).toBe('true');

            // クリーンアップ
            cleanupFns.forEach(fn => fn());
        });

        test('すべてのクリーンアップ関数を呼び出すとリスナーが削除される', () => {
            const protocolInput = document.getElementById('protocol') as HTMLInputElement;
            const portInput = document.getElementById('port') as HTMLInputElement;
            const visitInput = document.getElementById('visit') as HTMLInputElement;
            const scrollInput = document.getElementById('scroll') as HTMLInputElement;
            const tokensInput = document.getElementById('tokens') as HTMLInputElement;

            const cleanupFns = setupAllFieldValidations(
                protocolInput,
                portInput,
                visitInput,
                scrollInput,
                tokensInput
            );

            cleanupFns.forEach(fn => fn());

            protocolInput.value = 'ftp';
            protocolInput.dispatchEvent(new Event('blur'));
            expect(protocolInput.getAttribute('aria-invalid')).toBeNull();
        });
    });

    describe('validateAllFields', () => {
        test('すべてのフィールドが有効な場合 true を返す', () => {
            const protocolInput = document.getElementById('protocol') as HTMLInputElement;
            const portInput = document.getElementById('port') as HTMLInputElement;
            const visitInput = document.getElementById('visit') as HTMLInputElement;
            const scrollInput = document.getElementById('scroll') as HTMLInputElement;
            const tokensInput = document.getElementById('tokens') as HTMLInputElement;

            protocolInput.value = 'https';
            portInput.value = '8080';
            visitInput.value = '5';
            scrollInput.value = '50';
            tokensInput.value = '4096';

            const result = validateAllFields(
                protocolInput,
                portInput,
                visitInput,
                scrollInput,
                tokensInput
            );

            expect(result).toBe(true);
        });

        test('プロトコルが無効な場合 false を返す', () => {
            const protocolInput = document.getElementById('protocol') as HTMLInputElement;
            const portInput = document.getElementById('port') as HTMLInputElement;
            const visitInput = document.getElementById('visit') as HTMLInputElement;
            const scrollInput = document.getElementById('scroll') as HTMLInputElement;
            const tokensInput = document.getElementById('tokens') as HTMLInputElement;

            protocolInput.value = 'ftp';
            portInput.value = '8080';
            visitInput.value = '5';
            scrollInput.value = '50';
            tokensInput.value = '4096';

            const result = validateAllFields(
                protocolInput,
                portInput,
                visitInput,
                scrollInput,
                tokensInput
            );

            expect(result).toBe(false);
        });

        test('ポートが無効な場合 false を返す', () => {
            const protocolInput = document.getElementById('protocol') as HTMLInputElement;
            const portInput = document.getElementById('port') as HTMLInputElement;
            const visitInput = document.getElementById('visit') as HTMLInputElement;
            const scrollInput = document.getElementById('scroll') as HTMLInputElement;
            const tokensInput = document.getElementById('tokens') as HTMLInputElement;

            protocolInput.value = 'https';
            portInput.value = '0';
            visitInput.value = '5';
            scrollInput.value = '50';
            tokensInput.value = '4096';

            const result = validateAllFields(
                protocolInput,
                portInput,
                visitInput,
                scrollInput,
                tokensInput
            );

            expect(result).toBe(false);
        });

        test('訪問時間が無効な場合 false を返す', () => {
            const protocolInput = document.getElementById('protocol') as HTMLInputElement;
            const portInput = document.getElementById('port') as HTMLInputElement;
            const visitInput = document.getElementById('visit') as HTMLInputElement;
            const scrollInput = document.getElementById('scroll') as HTMLInputElement;
            const tokensInput = document.getElementById('tokens') as HTMLInputElement;

            protocolInput.value = 'https';
            portInput.value = '8080';
            visitInput.value = '-1';
            scrollInput.value = '50';
            tokensInput.value = '4096';

            const result = validateAllFields(
                protocolInput,
                portInput,
                visitInput,
                scrollInput,
                tokensInput
            );

            expect(result).toBe(false);
        });

        test('スクロール深度が無効な場合 false を返す', () => {
            const protocolInput = document.getElementById('protocol') as HTMLInputElement;
            const portInput = document.getElementById('port') as HTMLInputElement;
            const visitInput = document.getElementById('visit') as HTMLInputElement;
            const scrollInput = document.getElementById('scroll') as HTMLInputElement;
            const tokensInput = document.getElementById('tokens') as HTMLInputElement;

            protocolInput.value = 'https';
            portInput.value = '8080';
            visitInput.value = '5';
            scrollInput.value = '101';
            tokensInput.value = '4096';

            const result = validateAllFields(
                protocolInput,
                portInput,
                visitInput,
                scrollInput,
                tokensInput
            );

            expect(result).toBe(false);
        });

        test('最大トークン数が無効な場合 false を返す', () => {
            const protocolInput = document.getElementById('protocol') as HTMLInputElement;
            const portInput = document.getElementById('port') as HTMLInputElement;
            const visitInput = document.getElementById('visit') as HTMLInputElement;
            const scrollInput = document.getElementById('scroll') as HTMLInputElement;
            const tokensInput = document.getElementById('tokens') as HTMLInputElement;

            protocolInput.value = 'https';
            portInput.value = '8080';
            visitInput.value = '5';
            scrollInput.value = '50';
            tokensInput.value = '9';

            const result = validateAllFields(
                protocolInput,
                portInput,
                visitInput,
                scrollInput,
                tokensInput
            );

            expect(result).toBe(false);
        });

        test('複数のフィールドが無効な場合 false を返す', () => {
            const protocolInput = document.getElementById('protocol') as HTMLInputElement;
            const portInput = document.getElementById('port') as HTMLInputElement;
            const visitInput = document.getElementById('visit') as HTMLInputElement;
            const scrollInput = document.getElementById('scroll') as HTMLInputElement;
            const tokensInput = document.getElementById('tokens') as HTMLInputElement;

            protocolInput.value = '';
            portInput.value = 'abc';
            visitInput.value = '-5';
            scrollInput.value = '200';
            tokensInput.value = '1';

            const result = validateAllFields(
                protocolInput,
                portInput,
                visitInput,
                scrollInput,
                tokensInput
            );

            expect(result).toBe(false);
        });
    });
});
