// @vitest-environment jsdom
/**
 * fieldValidation.test.ts
 * fieldValidation.ts の単体テスト
 */

import { vi } from 'vitest';;

// chrome モック
(globalThis as any).chrome = {
    i18n: { getMessage: vi.fn((key: string) => key) },
    storage: { local: { get: vi.fn(), set: vi.fn() } }
};

// i18n モック
vi.mock('../../../utils/i18n.js', () => {
    const getMessage = vi.fn((key: string) => key);
    const getMessageOr = (key: string, fallback: string, subs?: unknown): string =>
    ((subs === undefined ? (getMessage as (...a: any[]) => unknown)(key) : (getMessage as (...a: any[]) => unknown)(key, subs)) || fallback) as string;
    const getMessageWithSubstitutions = (
    key: string,
    subs: Record<string, string | number>,
    fallback: string,
      ): string =>
      ((getMessage as (...a: any[]) => unknown)(key, subs) ||
    fallback.replace(/\{(\w+)\}/g, (_m: string, n: string) =>
      subs[n] !== undefined ? String(subs[n]) : `{${n}}`)) as string;
    return {
    getMessage: getMessage, getMessageOr, getMessageWithSubstitutions}; });

// storage モック (validateBaseUrl の dynamic import 用)
const mockIsDomainInWhitelist = vi.hoisted(() => vi.fn());
vi.mock('../../../utils/storage/urlWhitelist.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, isDomainInWhitelist: mockIsDomainInWhitelist };
});

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
    validateAllFields,
    validateObsidianHost
} from '../fieldValidation.js';

import * as urlWhitelist from '../../../utils/storage/urlWhitelist.js';
const { isDomainInWhitelist } = vi.mocked(urlWhitelist);

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
        test('sets aria-invalid to true and shows the error', () => {
            const input = document.getElementById('protocol') as HTMLInputElement;
            const errorEl = document.getElementById('protocol-error') as HTMLElement;

            setFieldError(input, 'protocol-error', 'Invalid');

            expect(input.getAttribute('aria-invalid')).toBe('true');
            expect(errorEl.textContent).toBe('Invalid');
            expect(errorEl.classList.contains('visible')).toBe(true);
        });

        test('does not throw when the error element is null', () => {
            const input = document.createElement('input');
            expect(() => setFieldError(input, 'nonexistent', 'msg')).not.toThrow();
        });

        test('overwrites the error message on repeated calls', () => {
            const input = document.getElementById('protocol') as HTMLInputElement;
            const errorEl = document.getElementById('protocol-error') as HTMLElement;

            setFieldError(input, 'protocol-error', 'First error');
            expect(errorEl.textContent).toBe('First error');

            setFieldError(input, 'protocol-error', 'Second error');
            expect(errorEl.textContent).toBe('Second error');
        });
    });

    describe('clearFieldError', () => {
        test('sets aria-invalid to false and hides the error', () => {
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

        test('does not throw when the error element is null', () => {
            const input = document.createElement('input');
            expect(() => clearFieldError(input, 'nonexistent')).not.toThrow();
        });
    });

    describe('clearAllFieldErrors', () => {
        test('clears multiple errors', () => {
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

        test('does not throw when passed an empty array', () => {
            expect(() => clearAllFieldErrors([])).not.toThrow();
        });

        test('clears all five field errors', () => {
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
        test('returns true for http', () => {
            const input = document.getElementById('protocol') as HTMLInputElement;
            input.value = 'http';
            expect(validateProtocol(input)).toBe(true);
            expect(input.getAttribute('aria-invalid')).not.toBe('true');
        });

        test('returns true for https', () => {
            const input = document.getElementById('protocol') as HTMLInputElement;
            input.value = 'https';
            expect(validateProtocol(input)).toBe(true);
        });

        test('returns true for uppercase HTTP (lowercased)', () => {
            const input = document.getElementById('protocol') as HTMLInputElement;
            input.value = 'HTTP';
            expect(validateProtocol(input)).toBe(true);
        });

        test('returns true for uppercase HTTPS', () => {
            const input = document.getElementById('protocol') as HTMLInputElement;
            input.value = 'HTTPS';
            expect(validateProtocol(input)).toBe(true);
        });

        test('returns false for ftp', () => {
            const input = document.getElementById('protocol') as HTMLInputElement;
            input.value = 'ftp';
            expect(validateProtocol(input)).toBe(false);
            expect(input.getAttribute('aria-invalid')).toBe('true');
        });

        test('returns false for an empty string', () => {
            const input = document.getElementById('protocol') as HTMLInputElement;
            input.value = '';
            expect(validateProtocol(input)).toBe(false);
        });

        test('trims surrounding whitespace', () => {
            const input = document.getElementById('protocol') as HTMLInputElement;
            input.value = '  https  ';
            expect(validateProtocol(input)).toBe(true);
        });

        test('returns false for the ws protocol', () => {
            const input = document.getElementById('protocol') as HTMLInputElement;
            input.value = 'ws';
            expect(validateProtocol(input)).toBe(false);
        });
    });

    describe('validatePort', () => {
        test('returns true for 1', () => {
            const input = document.getElementById('port') as HTMLInputElement;
            input.value = '1';
            expect(validatePort(input)).toBe(true);
        });

        test('returns true for 65535', () => {
            const input = document.getElementById('port') as HTMLInputElement;
            input.value = '65535';
            expect(validatePort(input)).toBe(true);
        });

        test('returns true for 8080', () => {
            const input = document.getElementById('port') as HTMLInputElement;
            input.value = '8080';
            expect(validatePort(input)).toBe(true);
        });

        test('returns true for 443', () => {
            const input = document.getElementById('port') as HTMLInputElement;
            input.value = '443';
            expect(validatePort(input)).toBe(true);
        });

        test('returns false for 0', () => {
            const input = document.getElementById('port') as HTMLInputElement;
            input.value = '0';
            expect(validatePort(input)).toBe(false);
        });

        test('returns false for 65536', () => {
            const input = document.getElementById('port') as HTMLInputElement;
            input.value = '65536';
            expect(validatePort(input)).toBe(false);
        });

        test('returns false for negative numbers', () => {
            const input = document.getElementById('port') as HTMLInputElement;
            input.value = '-1';
            expect(validatePort(input)).toBe(false);
        });

        test('returns false for non-numeric values', () => {
            const input = document.getElementById('port') as HTMLInputElement;
            input.value = 'abc';
            expect(validatePort(input)).toBe(false);
        });

        test('allows an empty string (default port)', () => {
            const input = document.getElementById('port') as HTMLInputElement;
            input.value = '';
            expect(validatePort(input)).toBe(true); // validateObsidianPort treats '' as default
        });

        test('rejects decimals (delegated to validateObsidianPort)', () => {
            const input = document.getElementById('port') as HTMLInputElement;
            input.value = '80.5';
            expect(validatePort(input)).toBe(false); // Number.isInteger rejects; UI now matches connection test
        });

        test('rejects trailing garbage (delegated to validateObsidianPort)', () => {
            const input = document.getElementById('port') as HTMLInputElement;
            input.value = '80abc';
            expect(validatePort(input)).toBe(false); // Number('80abc') is NaN; UI now matches connection test
        });

        test('sets the port error display when delegation throws', () => {
            const input = document.getElementById('port') as HTMLInputElement;
            input.value = '80abc';
            expect(validatePort(input)).toBe(false);
            expect(input.getAttribute('aria-invalid')).toBe('true');
        });
    });

    describe('validateMinVisitDuration', () => {
        test('returns true for 0', () => {
            const input = document.getElementById('visit') as HTMLInputElement;
            input.value = '0';
            expect(validateMinVisitDuration(input)).toBe(true);
        });

        test('returns true for positive integers', () => {
            const input = document.getElementById('visit') as HTMLInputElement;
            input.value = '30';
            expect(validateMinVisitDuration(input)).toBe(true);
        });

        test('returns true for large values', () => {
            const input = document.getElementById('visit') as HTMLInputElement;
            input.value = '999999';
            expect(validateMinVisitDuration(input)).toBe(true);
        });

        test('returns false for negative numbers', () => {
            const input = document.getElementById('visit') as HTMLInputElement;
            input.value = '-1';
            expect(validateMinVisitDuration(input)).toBe(false);
        });

        test('returns false for an empty string', () => {
            const input = document.getElementById('visit') as HTMLInputElement;
            input.value = '';
            expect(validateMinVisitDuration(input)).toBe(false);
        });

        test('returns false for non-numeric values', () => {
            const input = document.getElementById('visit') as HTMLInputElement;
            input.value = 'abc';
            expect(validateMinVisitDuration(input)).toBe(false);
        });
    });

    describe('validateMinScrollDepth', () => {
        test('returns true for 0', () => {
            const input = document.getElementById('scroll') as HTMLInputElement;
            input.value = '0';
            expect(validateMinScrollDepth(input)).toBe(true);
        });

        test('returns true for 100', () => {
            const input = document.getElementById('scroll') as HTMLInputElement;
            input.value = '100';
            expect(validateMinScrollDepth(input)).toBe(true);
        });

        test('returns true for 50', () => {
            const input = document.getElementById('scroll') as HTMLInputElement;
            input.value = '50';
            expect(validateMinScrollDepth(input)).toBe(true);
        });

        test('returns false for 101', () => {
            const input = document.getElementById('scroll') as HTMLInputElement;
            input.value = '101';
            expect(validateMinScrollDepth(input)).toBe(false);
        });

        test('returns false for -1', () => {
            const input = document.getElementById('scroll') as HTMLInputElement;
            input.value = '-1';
            expect(validateMinScrollDepth(input)).toBe(false);
        });

        test('returns false for an empty string', () => {
            const input = document.getElementById('scroll') as HTMLInputElement;
            input.value = '';
            expect(validateMinScrollDepth(input)).toBe(false);
        });

        test('returns false for non-numeric values', () => {
            const input = document.getElementById('scroll') as HTMLInputElement;
            input.value = 'abc';
            expect(validateMinScrollDepth(input)).toBe(false);
        });
    });

    describe('validateMaxTokens', () => {
        test('returns true for 10 (minimum)', () => {
            const input = document.getElementById('tokens') as HTMLInputElement;
            input.value = '10';
            expect(validateMaxTokens(input)).toBe(true);
        });

        test('returns true for 16000 (maximum)', () => {
            const input = document.getElementById('tokens') as HTMLInputElement;
            input.value = '16000';
            expect(validateMaxTokens(input)).toBe(true);
        });

        test('returns true for 4096', () => {
            const input = document.getElementById('tokens') as HTMLInputElement;
            input.value = '4096';
            expect(validateMaxTokens(input)).toBe(true);
        });

        test('returns false for 9', () => {
            const input = document.getElementById('tokens') as HTMLInputElement;
            input.value = '9';
            expect(validateMaxTokens(input)).toBe(false);
        });

        test('returns false for 16001', () => {
            const input = document.getElementById('tokens') as HTMLInputElement;
            input.value = '16001';
            expect(validateMaxTokens(input)).toBe(false);
        });

        test('returns false for 0', () => {
            const input = document.getElementById('tokens') as HTMLInputElement;
            input.value = '0';
            expect(validateMaxTokens(input)).toBe(false);
        });

        test('returns false for an empty string', () => {
            const input = document.getElementById('tokens') as HTMLInputElement;
            input.value = '';
            expect(validateMaxTokens(input)).toBe(false);
        });

        test('returns false for non-numeric values', () => {
            const input = document.getElementById('tokens') as HTMLInputElement;
            input.value = 'abc';
            expect(validateMaxTokens(input)).toBe(false);
        });
    });

    describe('validateBaseUrl', () => {
        test('allows empty strings (returns true)', async () => {
            const input = document.getElementById('baseUrl') as HTMLInputElement;
            input.value = '';

            const result = await validateBaseUrl(input);

            expect(result).toBe(true);
        });

        test('returns false for invalid URL formats', async () => {
            const input = document.getElementById('baseUrl') as HTMLInputElement;
            input.value = 'not-a-valid-url';

            const result = await validateBaseUrl(input);

            expect(result).toBe(false);
            expect(input.getAttribute('aria-invalid')).toBe('true');
        });

        test('treats whitespace-only values as empty', async () => {
            const input = document.getElementById('baseUrl') as HTMLInputElement;
            input.value = '   ';

            const result = await validateBaseUrl(input);

            // 空文字トリム後は空文字 → true
            expect(result).toBe(true);
        });

        test('returns true for whitelisted URLs', async () => {
            isDomainInWhitelist.mockReturnValue(true);

            const input = document.getElementById('baseUrl') as HTMLInputElement;
            input.value = 'https://api.openai.com/v1';

            const result = await validateBaseUrl(input);

            expect(result).toBe(true);
            expect(input.getAttribute('aria-invalid')).not.toBe('true');
        });

        test('returns false for non-whitelisted URLs', async () => {
            isDomainInWhitelist.mockReturnValue(false);

            const input = document.getElementById('baseUrl') as HTMLInputElement;
            input.value = 'https://unknown-provider.com/v1';

            const result = await validateBaseUrl(input);

            expect(result).toBe(false);
            expect(input.getAttribute('aria-invalid')).toBe('true');
        });
    });

    describe('setupProtocolValidation', () => {
        test('runs validation on blur events', () => {
            const input = document.getElementById('protocol') as HTMLInputElement;
            const cleanup = setupProtocolValidation(input);

            input.value = 'ftp';
            input.dispatchEvent(new Event('blur'));

            expect(input.getAttribute('aria-invalid')).toBe('true');

            // クリーンアップ
            cleanup();
        });

        test('clears the error on blur with a valid value', () => {
            const input = document.getElementById('protocol') as HTMLInputElement;
            const cleanup = setupProtocolValidation(input);

            input.value = 'https';
            input.dispatchEvent(new Event('blur'));

            expect(input.getAttribute('aria-invalid')).not.toBe('true');

            cleanup();
        });

        test('does not run validation after cleanup', () => {
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
        test('runs validation on blur events', () => {
            const input = document.getElementById('port') as HTMLInputElement;
            const cleanup = setupPortValidation(input);

            input.value = '0';
            input.dispatchEvent(new Event('blur'));

            expect(input.getAttribute('aria-invalid')).toBe('true');

            cleanup();
        });

        test('clears the error on blur with a valid port', () => {
            const input = document.getElementById('port') as HTMLInputElement;
            const cleanup = setupPortValidation(input);

            input.value = '8080';
            input.dispatchEvent(new Event('blur'));

            expect(input.getAttribute('aria-invalid')).not.toBe('true');

            cleanup();
        });

        test('does not run validation after cleanup', () => {
            const input = document.getElementById('port') as HTMLInputElement;
            const cleanup = setupPortValidation(input);

            cleanup();

            input.value = '0';
            input.dispatchEvent(new Event('blur'));

            expect(input.getAttribute('aria-invalid')).toBeNull();
        });
    });

    describe('setupMinVisitDurationValidation', () => {
        test('runs validation on blur events', () => {
            const input = document.getElementById('visit') as HTMLInputElement;
            const cleanup = setupMinVisitDurationValidation(input);

            input.value = '-1';
            input.dispatchEvent(new Event('blur'));

            expect(input.getAttribute('aria-invalid')).toBe('true');

            cleanup();
        });

        test('clears the error on blur with a valid value', () => {
            const input = document.getElementById('visit') as HTMLInputElement;
            const cleanup = setupMinVisitDurationValidation(input);

            input.value = '10';
            input.dispatchEvent(new Event('blur'));

            expect(input.getAttribute('aria-invalid')).not.toBe('true');

            cleanup();
        });

        test('does not run validation after cleanup', () => {
            const input = document.getElementById('visit') as HTMLInputElement;
            const cleanup = setupMinVisitDurationValidation(input);

            cleanup();

            input.value = '-1';
            input.dispatchEvent(new Event('blur'));

            expect(input.getAttribute('aria-invalid')).toBeNull();
        });
    });

    describe('setupMinScrollDepthValidation', () => {
        test('runs validation on blur events', () => {
            const input = document.getElementById('scroll') as HTMLInputElement;
            const cleanup = setupMinScrollDepthValidation(input);

            input.value = '101';
            input.dispatchEvent(new Event('blur'));

            expect(input.getAttribute('aria-invalid')).toBe('true');

            cleanup();
        });

        test('clears the error on blur with a valid value', () => {
            const input = document.getElementById('scroll') as HTMLInputElement;
            const cleanup = setupMinScrollDepthValidation(input);

            input.value = '50';
            input.dispatchEvent(new Event('blur'));

            expect(input.getAttribute('aria-invalid')).not.toBe('true');

            cleanup();
        });

        test('does not run validation after cleanup', () => {
            const input = document.getElementById('scroll') as HTMLInputElement;
            const cleanup = setupMinScrollDepthValidation(input);

            cleanup();

            input.value = '101';
            input.dispatchEvent(new Event('blur'));

            expect(input.getAttribute('aria-invalid')).toBeNull();
        });
    });

    describe('setupMaxTokensValidation', () => {
        test('runs validation on blur events', () => {
            const input = document.getElementById('tokens') as HTMLInputElement;
            const cleanup = setupMaxTokensValidation(input);

            input.value = '5';
            input.dispatchEvent(new Event('blur'));

            expect(input.getAttribute('aria-invalid')).toBe('true');

            cleanup();
        });

        test('clears the error on blur with a valid value', () => {
            const input = document.getElementById('tokens') as HTMLInputElement;
            const cleanup = setupMaxTokensValidation(input);

            input.value = '4096';
            input.dispatchEvent(new Event('blur'));

            expect(input.getAttribute('aria-invalid')).not.toBe('true');

            cleanup();
        });

        test('does not run validation after cleanup', () => {
            const input = document.getElementById('tokens') as HTMLInputElement;
            const cleanup = setupMaxTokensValidation(input);

            cleanup();

            input.value = '5';
            input.dispatchEvent(new Event('blur'));

            expect(input.getAttribute('aria-invalid')).toBeNull();
        });
    });

    describe('setupAllFieldValidations', () => {
        test('sets up all validation listeners', () => {
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

        test('runs validation on blur for each field', () => {
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

        test('removes listeners when all cleanup functions are called', () => {
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
        test('returns true when all fields are valid', () => {
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

        test('returns false when the protocol is invalid', () => {
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

        test('returns false when the port is invalid', () => {
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

        test('returns false when the visit duration is invalid', () => {
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

        test('returns false when the scroll depth is invalid', () => {
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

        test('returns false when the max token count is invalid', () => {
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

        test('returns false when multiple fields are invalid', () => {
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

    describe('validateObsidianHost', () => {
        const makeHostInput = (value: string): HTMLInputElement => {
            const input = document.createElement('input');
            input.id = 'obsidianHost';
            input.value = value;
            const error = document.createElement('div');
            error.id = 'obsidianHostError';
            document.body.appendChild(input);
            document.body.appendChild(error);
            return input;
        };

        test('rejects URL userinfo tricks that would redirect the API key elsewhere', () => {
            const input = makeHostInput('127.0.0.1@evil.com');
            expect(validateObsidianHost(input)).toBe(false);
            expect(input.getAttribute('aria-invalid')).toBe('true');
        });

        test('rejects percent-encoded host values', () => {
            const input = makeHostInput('evil.com%2Fpath');
            expect(validateObsidianHost(input)).toBe(false);
        });

        test('accepts plain hostnames and IPv4', () => {
            const host = makeHostInput('192.168.1.10');
            expect(validateObsidianHost(host)).toBe(true);
            expect(host.getAttribute('aria-invalid')).toBe('false');
        });

        test('accepts IPv6 hosts (shared SW semantics, no UI drift)', () => {
            const host = makeHostInput('::1');
            expect(validateObsidianHost(host)).toBe(true);
            expect(host.getAttribute('aria-invalid')).toBe('false');
        });

        test('rejects malformed hostnames the SW validator rejects', () => {
            for (const value of ['-leading.com', 'trailing-.com', 'empty..label.com', '999.999.999.999', 'under_score.com']) {
                document.body.innerHTML = '';
                const input = makeHostInput(value);
                expect(validateObsidianHost(input)).toBe(false);
            }
        });

        test('mirror agrees with the SW-side validator on accept/reject (parity)', async () => {
            const { validateObsidianHost: validateValue } = await import('../../../utils/obsidianConfigValidator.js');
            const values = [
                'localhost', '127.0.0.1', '192.168.1.10', 'example.com', 'vault.example.com',
                '::1', '[::1]', '2001:db8::1',
                '127.0.0.1@evil.com', 'evil.com%2Fpath', 'has space.com', 'http://x.com',
                '-bad.com', 'bad-.com', 'a..b', '999.999.999.999', 'a_b.com',
            ];
            for (const value of values) {
                document.body.innerHTML = '';
                const input = makeHostInput(value);
                let expected = true;
                try {
                    validateValue(value);
                } catch {
                    expected = false;
                }
                expect(validateObsidianHost(input)).toBe(expected);
            }
        });
    });
});
