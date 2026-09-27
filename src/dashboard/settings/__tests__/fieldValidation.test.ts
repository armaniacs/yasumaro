// @vitest-environment jsdom
/**
 * fieldValidation.test.ts
 * fieldValidation.ts の単体テスト
 *
 * The descriptor table is the single source of truth for every settings field,
 * so the accept/reject matrices, the DOM error display and the blur wiring are
 * all driven off GENERAL_SETTINGS_FIELDS instead of per-field functions.
 */

import { vi } from 'vitest';;

// chrome モック
(globalThis as any).chrome = {
    i18n: { getMessage: vi.fn((key: string) => key) },
    storage: { local: { get: vi.fn(), set: vi.fn() } }
};

// i18n モック
// getMessage returns '' for keys that are not translated, mirroring
// src/utils/i18n.js: the dashboard shows an empty error box rather than the key.
const { translations } = vi.hoisted(() => ({ translations: new Map<string, string>() }));
vi.mock('../../../utils/i18n.js', () => {
    const getMessage = vi.fn((key: string) => translations.get(key) ?? '');
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
    validateBaseUrl,
    validateDescriptorField,
    setupDescriptorValidation,
    setupAllFieldValidations,
    setupObsidianHostValidation,
    setupGeminiApiVersionValidation,
    validateAllFields,
} from '../fieldValidation.js';
import { GENERAL_SETTINGS_FIELDS, getDescriptorByElementId } from '../fieldDescriptor.js';

import * as urlWhitelist from '../../../utils/storage/urlWhitelist.js';
const { isDomainInWhitelist } = vi.mocked(urlWhitelist);

const descriptor = (elementId: string) => {
    const found = getDescriptorByElementId(elementId);
    if (!found) throw new Error(`no descriptor for ${elementId}`);
    return found;
};

/** DOM for the whole general-settings form, keyed by the table's element ids. */
function buildForm(values: Record<string, string> = {}): void {
    const defaults: Record<string, string> = {
        protocol: 'https',
        port: '27124',
        obsidianHost: '127.0.0.1',
        geminiApiVersion: 'v1beta',
        minVisitDuration: '5',
        minScrollDepth: '50',
        maxTokensPerPrompt: '1000',
    };
    const merged = { ...defaults, ...values };
    document.body.innerHTML = `
        <input id="protocol" type="text" />
        <div id="protocolWarning" class="hidden"></div>
        <div id="protocolError"></div>
        <input id="port" type="text" />
        <div id="portError"></div>
        <input id="obsidianHost" type="text" />
        <div id="obsidianHostError"></div>
        <input id="geminiApiVersion" type="text" />
        <div id="geminiApiVersionError"></div>
        <input id="minVisitDuration" type="text" />
        <div id="minVisitDurationError"></div>
        <input id="minScrollDepth" type="text" />
        <div id="minScrollDepthError"></div>
        <input id="maxTokensPerPrompt" type="text" />
        <div id="maxTokensError"></div>
        <input id="baseUrl" type="text" />
        <div id="baseUrlError"></div>
    `;
    for (const [elementId, value] of Object.entries(merged)) {
        const input = document.getElementById(elementId) as HTMLInputElement | null;
        if (input) input.value = value;
    }
}

const input = (elementId: string): HTMLInputElement =>
    document.getElementById(elementId) as HTMLInputElement;
const errorEl = (errorId: string): HTMLElement =>
    document.getElementById(errorId) as HTMLElement;

describe('fieldValidation', () => {

    beforeEach(() => {
        translations.clear();
        buildForm();
    });

    describe('setFieldError', () => {
        test('sets aria-invalid to true and shows the error', () => {
            const el = input('protocol');
            const err = errorEl('protocolError');

            setFieldError(el, 'protocolError', 'Invalid');

            expect(el.getAttribute('aria-invalid')).toBe('true');
            expect(err.textContent).toBe('Invalid');
            expect(err.classList.contains('visible')).toBe(true);
        });

        test('does not throw when the error element is null', () => {
            const el = document.createElement('input');
            expect(() => setFieldError(el, 'nonexistent', 'msg')).not.toThrow();
        });

        test('overwrites the error message on repeated calls', () => {
            const el = input('protocol');
            const err = errorEl('protocolError');

            setFieldError(el, 'protocolError', 'First error');
            expect(err.textContent).toBe('First error');

            setFieldError(el, 'protocolError', 'Second error');
            expect(err.textContent).toBe('Second error');
        });
    });

    describe('clearFieldError', () => {
        test('sets aria-invalid to false and hides the error', () => {
            const el = input('protocol');
            const err = errorEl('protocolError');
            el.setAttribute('aria-invalid', 'true');
            err.classList.add('visible');
            err.textContent = 'Error';

            clearFieldError(el, 'protocolError');

            expect(el.getAttribute('aria-invalid')).toBe('false');
            expect(err.textContent).toBe('');
            expect(err.classList.contains('visible')).toBe(false);
        });

        test('does not throw when the error element is null', () => {
            const el = document.createElement('input');
            expect(() => clearFieldError(el, 'nonexistent')).not.toThrow();
        });
    });

    describe('clearAllFieldErrors', () => {
        test('clears multiple errors', () => {
            const pInput = input('protocol');
            const portInput = input('port');
            pInput.setAttribute('aria-invalid', 'true');
            portInput.setAttribute('aria-invalid', 'true');

            clearAllFieldErrors([
                [pInput, 'protocolError'],
                [portInput, 'portError']
            ]);

            expect(pInput.getAttribute('aria-invalid')).toBe('false');
            expect(portInput.getAttribute('aria-invalid')).toBe('false');
        });

        test('does not throw when passed an empty array', () => {
            expect(() => clearAllFieldErrors([])).not.toThrow();
        });

        test('clears all seven descriptor-table error elements', () => {
            const pairs = GENERAL_SETTINGS_FIELDS.map((d) => {
                const el = input(d.elementId);
                el.setAttribute('aria-invalid', 'true');
                errorEl(d.errorId).classList.add('visible');
                errorEl(d.errorId).textContent = 'Error';
                return [el, d.errorId] as [HTMLInputElement, string];
            });

            clearAllFieldErrors(pairs);

            for (const d of GENERAL_SETTINGS_FIELDS) {
                expect(input(d.elementId).getAttribute('aria-invalid')).toBe('false');
                expect(errorEl(d.errorId).classList.contains('visible')).toBe(false);
            }
        });
    });

    // The accept/reject matrices that used to live in per-field describes now
    // run through the descriptor route, so they also pin the errorId the row
    // writes to.
    describe('descriptor route accept/reject matrix', () => {
        const CASES: Array<{ elementId: string; valid: string[]; invalid: string[] }> = [
            {
                elementId: 'protocol',
                valid: ['http', 'https', 'HTTP', 'HTTPS', '  https  '],
                invalid: ['', 'ftp', 'ws'],
            },
            {
                elementId: 'port',
                valid: ['1', '443', '8080', '65535', ''],
                invalid: ['0', '-1', 'abc', '65536', '80.5', '80abc'],
            },
            {
                elementId: 'obsidianHost',
                valid: ['127.0.0.1', 'localhost', '192.168.1.10', '::1', '[::1]', ''],
                invalid: ['127.0.0.1@evil.com', 'evil.com%2Fpath', '-leading.com', '999.999.999.999'],
            },
            {
                elementId: 'geminiApiVersion',
                valid: ['v1', 'v1beta', ''],
                invalid: ['bad', '1v', 'v1 beta'],
            },
            {
                elementId: 'minVisitDuration',
                valid: ['0', '30', '999999'],
                invalid: ['-1', '', 'abc'],
            },
            {
                elementId: 'minScrollDepth',
                valid: ['0', '50', '100'],
                invalid: ['-1', '101', '', 'abc'],
            },
            {
                elementId: 'maxTokensPerPrompt',
                valid: ['10', '4096', '16000'],
                invalid: ['0', '9', '16001', '', 'abc'],
            },
        ];

        test.each(CASES)('$elementId accepts/rejects the legacy values', ({ elementId, valid, invalid }) => {
            const row = descriptor(elementId);
            for (const raw of valid) {
                input(elementId).value = raw;
                expect(validateDescriptorField(row, input(elementId)), `${elementId}=${raw}`).toBe(true);
            }
            for (const raw of invalid) {
                input(elementId).value = raw;
                expect(validateDescriptorField(row, input(elementId)), `${elementId}=${raw}`).toBe(false);
            }
        });
    });

    describe('error display parity per descriptor row', () => {
        const ROWS = [
            { elementId: 'protocol', errorId: 'protocolError', errorKey: 'errorProtocol', invalid: 'ftp', valid: 'https', translated: 'プロトコルが不正です' },
            { elementId: 'port', errorId: 'portError', errorKey: 'errorPort', invalid: '0', valid: '8080', translated: 'ポートが不正です' },
            { elementId: 'obsidianHost', errorId: 'obsidianHostError', errorKey: 'obsidianHostError', invalid: '127.0.0.1@evil.com', valid: '192.168.1.10', translated: 'ホストが不正です' },
            { elementId: 'geminiApiVersion', errorId: 'geminiApiVersionError', errorKey: 'geminiApiVersionError', invalid: 'bad', valid: 'v1beta', translated: 'バージョンが不正です' },
            { elementId: 'minVisitDuration', errorId: 'minVisitDurationError', errorKey: 'errorDuration', invalid: '-1', valid: '30', translated: '時間が不正です' },
            { elementId: 'minScrollDepth', errorId: 'minScrollDepthError', errorKey: 'errorScrollDepth', invalid: '101', valid: '50', translated: '深度が不正です' },
            { elementId: 'maxTokensPerPrompt', errorId: 'maxTokensError', errorKey: 'error_max_tokens_range', invalid: '9', valid: '4096', translated: '範囲外です' },
        ];

        test.each(ROWS)('$elementId shows the translated message on the row error element', (row) => {
            translations.set(row.errorKey, row.translated);
            input(row.elementId).value = row.invalid;

            expect(validateDescriptorField(descriptor(row.elementId), input(row.elementId))).toBe(false);

            expect(input(row.elementId).getAttribute('aria-invalid')).toBe('true');
            expect(errorEl(row.errorId).textContent).toBe(row.translated);
            expect(errorEl(row.errorId).classList.contains('visible')).toBe(true);
        });

        test.each(ROWS)('$elementId clears its error element on the next valid value', (row) => {
            input(row.elementId).value = row.invalid;
            validateDescriptorField(descriptor(row.elementId), input(row.elementId));

            input(row.elementId).value = row.valid;
            expect(validateDescriptorField(descriptor(row.elementId), input(row.elementId))).toBe(true);

            expect(input(row.elementId).getAttribute('aria-invalid')).toBe('false');
            expect(errorEl(row.errorId).textContent).toBe('');
            expect(errorEl(row.errorId).classList.contains('visible')).toBe(false);
        });

        test('an untranslated key renders an empty error box (getMessage contract)', () => {
            input('protocol').value = 'ftp';
            validateDescriptorField(descriptor('protocol'), input('protocol'));

            // translations is empty, so getMessage('errorProtocol') === ''
            expect(errorEl('protocolError').textContent).toBe('');
            expect(errorEl('protocolError').classList.contains('visible')).toBe(true);
        });

        test('rows carrying an errorFallback show the English text when untranslated', () => {
            input('geminiApiVersion').value = 'bad';
            validateDescriptorField(descriptor('geminiApiVersion'), input('geminiApiVersion'));

            expect(errorEl('geminiApiVersionError').textContent)
                .toBe('Gemini API version must be like v1 or v1beta.');

            input('obsidianHost').value = '127.0.0.1@evil.com';
            validateDescriptorField(descriptor('obsidianHost'), input('obsidianHost'));

            expect(errorEl('obsidianHostError').textContent)
                .toBe('Obsidian host contains invalid characters.');
        });
    });

    describe('cross-field and compound validators', () => {
        test('maxTokens follows the providerId in the validation context', () => {
            const row = descriptor('maxTokensPerPrompt');
            input('maxTokensPerPrompt').value = '10000';

            // gemini caps at 8192, the global range accepts 16000
            expect(validateDescriptorField(row, input('maxTokensPerPrompt'), { providerId: 'gemini' })).toBe(false);
            expect(errorEl('maxTokensError').textContent).toBe('');

            expect(validateDescriptorField(row, input('maxTokensPerPrompt'), { providerId: '' })).toBe(true);
            expect(errorEl('maxTokensError').classList.contains('visible')).toBe(false);
        });

        test('obsidianHost mirrors the SW-side compound validator on accept/reject', async () => {
            const { validateObsidianHost: validateValue } = await import('../../../utils/obsidianConfigValidator.js');
            const values = [
                'localhost', '127.0.0.1', '192.168.1.10', 'example.com', 'vault.example.com',
                '::1', '[::1]', '2001:db8::1',
                '127.0.0.1@evil.com', 'evil.com%2Fpath', 'has space.com', 'http://x.com',
                '-bad.com', 'bad-.com', 'a..b', '999.999.999.999', 'a_b.com',
            ];
            const row = descriptor('obsidianHost');
            for (const value of values) {
                let expected = true;
                try {
                    validateValue(value);
                } catch {
                    expected = false;
                }
                input('obsidianHost').value = value;
                expect(validateDescriptorField(row, input('obsidianHost'))).toBe(expected);
            }
        });
    });

    describe('protocol HTTP warning side channel', () => {
        test('shows the warning for http and clears it for https', () => {
            translations.set('warningProtocolHttp', 'HTTP は暗号化されません');

            input('protocol').value = 'http';
            validateDescriptorField(descriptor('protocol'), input('protocol'));
            expect(errorEl('protocolWarning').textContent).toBe('HTTP は暗号化されません');
            expect(errorEl('protocolWarning').classList.contains('hidden')).toBe(false);

            input('protocol').value = 'https';
            validateDescriptorField(descriptor('protocol'), input('protocol'));
            expect(errorEl('protocolWarning').textContent).toBe('');
            expect(errorEl('protocolWarning').classList.contains('hidden')).toBe(true);
        });

        test('clears the warning when the value becomes invalid', () => {
            translations.set('warningProtocolHttp', 'HTTP は暗号化されません');

            input('protocol').value = 'http';
            validateDescriptorField(descriptor('protocol'), input('protocol'));
            expect(errorEl('protocolWarning').classList.contains('hidden')).toBe(false);

            input('protocol').value = 'ftp';
            expect(validateDescriptorField(descriptor('protocol'), input('protocol'))).toBe(false);
            expect(errorEl('protocolWarning').classList.contains('hidden')).toBe(true);
        });
    });

    describe('setupDescriptorValidation', () => {
        test('runs validation on blur, clears on a valid value, and stops after cleanup', () => {
            const port = input('port');
            const cleanup = setupDescriptorValidation(descriptor('port'), port);

            port.value = '0';
            port.dispatchEvent(new Event('blur'));
            expect(port.getAttribute('aria-invalid')).toBe('true');
            expect(errorEl('portError').classList.contains('visible')).toBe(true);

            port.value = '8080';
            port.dispatchEvent(new Event('blur'));
            expect(port.getAttribute('aria-invalid')).toBe('false');
            expect(errorEl('portError').classList.contains('visible')).toBe(false);

            cleanup();
            port.value = '0';
            port.dispatchEvent(new Event('blur'));
            expect(port.getAttribute('aria-invalid')).toBe('false');
        });

        test('is a no-op for a missing input', () => {
            const cleanup = setupDescriptorValidation(descriptor('port'), null);
            expect(() => cleanup()).not.toThrow();
        });
    });

    describe('setupAllFieldValidations', () => {
        test('wires one blur listener per table row that has an element in the DOM', () => {
            const cleanups = setupAllFieldValidations(input('protocol'), input('port'));

            expect(cleanups).toHaveLength(GENERAL_SETTINGS_FIELDS.length);
            for (const cleanup of cleanups) expect(typeof cleanup).toBe('function');

            cleanups.forEach(cleanup => cleanup());
        });

        test('prefers the caller-supplied element for the row it names', () => {
            const detached = document.createElement('input');
            detached.id = 'minScrollDepth';
            detached.value = '101';

            const cleanups = setupAllFieldValidations(input('protocol'), input('port'), null, detached);

            detached.dispatchEvent(new Event('blur'));
            expect(detached.getAttribute('aria-invalid')).toBe('true');

            cleanups.forEach(cleanup => cleanup());
        });

        test('validates rows the caller did not supply (new rows need no line here)', () => {
            // Only protocol and port are handed over, as the panel does.
            setupAllFieldValidations(input('protocol'), input('port'));

            const depth = input('minScrollDepth');
            depth.value = '101';
            depth.dispatchEvent(new Event('blur'));

            expect(depth.getAttribute('aria-invalid')).toBe('true');
            expect(errorEl('minScrollDepthError').classList.contains('visible')).toBe(true);
        });

        test('removes every listener when all cleanup functions are called', () => {
            const cleanups = setupAllFieldValidations(input('protocol'), input('port'));
            cleanups.forEach(cleanup => cleanup());

            input('protocol').value = 'ftp';
            input('protocol').dispatchEvent(new Event('blur'));
            input('minScrollDepth').value = '101';
            input('minScrollDepth').dispatchEvent(new Event('blur'));

            expect(input('protocol').getAttribute('aria-invalid')).toBeNull();
            expect(input('minScrollDepth').getAttribute('aria-invalid')).toBeNull();
        });
    });

    describe('setupObsidianHostValidation / setupGeminiApiVersionValidation', () => {
        test('wire the rows the panel passes by container query', () => {
            const hostCleanup = setupObsidianHostValidation(input('obsidianHost'));
            const versionCleanup = setupGeminiApiVersionValidation(input('geminiApiVersion'));

            input('obsidianHost').value = '127.0.0.1@evil.com';
            input('obsidianHost').dispatchEvent(new Event('blur'));
            expect(input('obsidianHost').getAttribute('aria-invalid')).toBe('true');

            input('geminiApiVersion').value = 'bad';
            input('geminiApiVersion').dispatchEvent(new Event('blur'));
            expect(input('geminiApiVersion').getAttribute('aria-invalid')).toBe('true');

            hostCleanup();
            versionCleanup();
            input('obsidianHost').value = '127.0.0.1';
            input('obsidianHost').dispatchEvent(new Event('blur'));
            // Listener removed: the stale error is neither refreshed nor cleared.
            expect(input('obsidianHost').getAttribute('aria-invalid')).toBe('true');
        });

        test('are no-ops for a missing input', () => {
            expect(() => setupObsidianHostValidation(null)()).not.toThrow();
            expect(() => setupGeminiApiVersionValidation(null)()).not.toThrow();
        });
    });

    describe('validateAllFields', () => {
        test('returns true when every row holds a valid value', () => {
            expect(validateAllFields()).toBe(true);
        });

        test('ignores rows whose input is absent from the DOM', () => {
            document.body.innerHTML = '';
            expect(validateAllFields()).toBe(true);
        });

        // The acceptance bar for the descriptor route: a row that exists only in
        // the table is swept without any edit in fieldValidation.ts.
        test.each(GENERAL_SETTINGS_FIELDS.map((d) => [d.elementId, d.errorId]))(
            'reports a failure raised by the %s row alone',
            (elementId, errorId) => {
                const invalid: Record<string, string> = {
                    protocol: 'ftp',
                    port: '0',
                    obsidianHost: '127.0.0.1@evil.com',
                    geminiApiVersion: 'bad',
                    minVisitDuration: '-1',
                    minScrollDepth: '101',
                    maxTokensPerPrompt: '9',
                };
                input(elementId).value = invalid[elementId] ?? '';

                expect(validateAllFields()).toBe(false);
                expect(input(elementId).getAttribute('aria-invalid')).toBe('true');
                expect(errorEl(errorId).classList.contains('visible')).toBe(true);
            }
        );

        test('clears every row error when all values become valid again', () => {
            input('port').value = '0';
            expect(validateAllFields()).toBe(false);

            input('port').value = '8080';
            expect(validateAllFields()).toBe(true);
            expect(errorEl('portError').classList.contains('visible')).toBe(false);
        });

        test('passes the provider context through to the cross-field row', () => {
            input('maxTokensPerPrompt').value = '10000';

            expect(validateAllFields({ providerId: 'gemini' })).toBe(false);
            expect(validateAllFields({ providerId: '' })).toBe(true);
        });
    });

    describe('validateBaseUrl', () => {
        test('allows empty strings (returns true)', async () => {
            const el = input('baseUrl');
            el.value = '';

            const result = await validateBaseUrl(el);

            expect(result).toBe(true);
        });

        test('returns false for invalid URL formats', async () => {
            const el = input('baseUrl');
            el.value = 'not-a-valid-url';

            const result = await validateBaseUrl(el);

            expect(result).toBe(false);
            expect(el.getAttribute('aria-invalid')).toBe('true');
        });

        test('treats whitespace-only values as empty', async () => {
            const el = input('baseUrl');
            el.value = '   ';

            const result = await validateBaseUrl(el);

            // 空文字トリム後は空文字 → true
            expect(result).toBe(true);
        });

        test('returns true for whitelisted URLs', async () => {
            isDomainInWhitelist.mockReturnValue(true);

            const el = input('baseUrl');
            el.value = 'https://api.openai.com/v1';

            const result = await validateBaseUrl(el);

            expect(result).toBe(true);
            expect(el.getAttribute('aria-invalid')).not.toBe('true');
        });

        test('returns false for non-whitelisted URLs', async () => {
            isDomainInWhitelist.mockReturnValue(false);

            const el = input('baseUrl');
            el.value = 'https://unknown-provider.com/v1';

            const result = await validateBaseUrl(el);

            expect(result).toBe(false);
            expect(el.getAttribute('aria-invalid')).toBe('true');
        });
    });
});
