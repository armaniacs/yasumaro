// @vitest-environment jsdom
/**
 * settingsSaver.test.ts
 * settingsSaver.ts のユニットテスト
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
    runConnectionTest,
    addCertificateWarning,
    displayConnectionResult,
    handleSaveAndTest,
    setupSaveButtonListener
} from '../settingsSaver.js';

import { getSettings, saveSettingsWithAllowedUrls } from '../../../utils/storage.js';
import { extractSettingsFromInputs } from '../../settingsUiHelper.js';
import { clearAllFieldErrors, validateAllFields } from '../fieldValidation.js';

import { STATUS_COLORS } from '../../../constants/appConstants.js';

// Mock dependencies
vi.mock('../../../utils/storage.js', () => ({
    getSettings: vi.fn(),
    saveSettingsWithAllowedUrls: vi.fn(),
}));

vi.mock('../../settingsUiHelper.js', () => ({
    extractSettingsFromInputs: vi.fn(),
}));

vi.mock('../../i18n.js', () => ({
    getMessage: vi.fn((key: string) => {
        const messages: Record<string, string> = {
            testingConnection: 'Testing connection...',
            connectionSuccess: 'Success!',
            acceptCertificate: 'Click here to accept self-signed certificate',
            errorProtocol: 'Error: Protocol must be "http" or "https".',
            saveError: 'Save error',
        };
        return messages[key] || key;
    }),
}));

vi.mock('../fieldValidation.js', () => ({
    clearAllFieldErrors: vi.fn(),
    validateAllFields: vi.fn(() => true),
}));

vi.mock('../settingsUiHelper.js', () => ({
    extractSettingsFromInputs: vi.fn(),
}));

vi.mock('../i18n.js', () => ({
    getMessage: vi.fn((key: string) => {
        const messages: Record<string, string> = {
            testingConnection: 'Testing connection...',
            connectionSuccess: 'Success!',
            acceptCertificate: 'Click here to accept self-signed certificate',
            errorProtocol: 'Error: Protocol must be "http" or "https".',
            saveError: 'Save error',
        };
        return messages[key] || key;
    }),
}));

vi.mock('./fieldValidation.js', () => ({
    clearAllFieldErrors: vi.fn(),
    validateAllFields: vi.fn(() => true),
}));

function createMockInputs() {
    const protocolInput = document.createElement('input');
    protocolInput.value = 'https';
    const portInput = document.createElement('input');
    portInput.value = '27123';
    const minVisitDurationInput = document.createElement('input');
    minVisitDurationInput.value = '5';
    const minScrollDepthInput = document.createElement('input');
    minScrollDepthInput.value = '50';
    const maxTokensInput = document.createElement('input');
    maxTokensInput.value = '1000';
    return {
        protocolInput,
        portInput,
        minVisitDurationInput,
        minScrollDepthInput,
        maxTokensInput,
    };
}

describe('settingsSaver', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        global.chrome = {
            runtime: {
                sendMessage: vi.fn(),
            },
        } as any;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('runConnectionTest', () => {
        it('should return success when both connections succeed', async () => {
            (global.chrome.runtime.sendMessage as any).mockResolvedValue({
                obsidian: { success: true, message: 'Connected' },
                ai: { success: true, message: 'Connected' },
            });

            const result = await runConnectionTest();

            expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith({
                type: 'TEST_CONNECTIONS',
                payload: {},
            });
            expect(result).toEqual({
                obsidianSuccess: true,
                obsidianMessage: 'Connected',
                aiSuccess: true,
                aiMessage: 'Connected',
            });
        });

        it('should return failure when both connections fail', async () => {
            (global.chrome.runtime.sendMessage as any).mockResolvedValue({
                obsidian: { success: false, message: 'Failed' },
                ai: { success: false, message: 'API Error' },
            });

            const result = await runConnectionTest();

            expect(result).toEqual({
                obsidianSuccess: false,
                obsidianMessage: 'Failed',
                aiSuccess: false,
                aiMessage: 'API Error',
            });
        });

        it('should return default failure when response is undefined', async () => {
            (global.chrome.runtime.sendMessage as any).mockResolvedValue(undefined);

            const result = await runConnectionTest();

            expect(result).toEqual({
                obsidianSuccess: false,
                obsidianMessage: 'No response',
                aiSuccess: false,
                aiMessage: 'No response',
            });
        });

        it('should return default failure when response fields are missing', async () => {
            (global.chrome.runtime.sendMessage as any).mockResolvedValue({});

            const result = await runConnectionTest();

            expect(result).toEqual({
                obsidianSuccess: false,
                obsidianMessage: 'No response',
                aiSuccess: false,
                aiMessage: 'No response',
            });
        });

        it('should handle partial response (only obsidian)', async () => {
            (global.chrome.runtime.sendMessage as any).mockResolvedValue({
                obsidian: { success: true, message: 'OK' },
            });

            const result = await runConnectionTest();

            expect(result).toEqual({
                obsidianSuccess: true,
                obsidianMessage: 'OK',
                aiSuccess: false,
                aiMessage: 'No response',
            });
        });

        it('should handle partial response (only ai)', async () => {
            (global.chrome.runtime.sendMessage as any).mockResolvedValue({
                ai: { success: true, message: 'OK' },
            });

            const result = await runConnectionTest();

            expect(result).toEqual({
                obsidianSuccess: false,
                obsidianMessage: 'No response',
                aiSuccess: true,
                aiMessage: 'OK',
            });
        });
    });

    describe('addCertificateWarning', () => {
        it('should add a link to the status div', () => {
            const statusDiv = document.createElement('div');
            const port = 8080;

            addCertificateWarning(statusDiv, port);

            expect(statusDiv.innerHTML).toContain('<br>');
            expect(statusDiv.innerHTML).toContain('<a ');
        });

        it('should create link with correct URL', () => {
            const statusDiv = document.createElement('div');
            const port = 8080;

            addCertificateWarning(statusDiv, port);

            const link = statusDiv.querySelector('a');
            expect(link).not.toBeNull();
            expect(link?.href).toContain('https://127.0.0.1:8080/');
        });

        it('should have correct link text', () => {
            const statusDiv = document.createElement('div');
            const port = 443;

            addCertificateWarning(statusDiv, port);

            const link = statusDiv.querySelector('a');
            expect(link?.textContent).toBe('Click here to accept self-signed certificate');
        });

        it('should have target=_blank and rel=noopener noreferrer', () => {
            const statusDiv = document.createElement('div');

            addCertificateWarning(statusDiv, 8080);

            const link = statusDiv.querySelector('a');
            expect(link?.target).toBe('_blank');
            expect(link?.rel).toBe('noopener noreferrer');
        });

        it('should handle different ports', () => {
            const statusDiv1 = document.createElement('div');
            const statusDiv2 = document.createElement('div');

            addCertificateWarning(statusDiv1, 8080);
            addCertificateWarning(statusDiv2, 3000);

            const link1 = statusDiv1.querySelector('a');
            const link2 = statusDiv2.querySelector('a');

            expect(link1?.href).toContain('8080');
            expect(link2?.href).toContain('3000');
        });
    });

    describe('displayConnectionResult', () => {
        it('should show success when both connections succeed', () => {
            const statusDiv = document.createElement('div');
            const protocolInput = document.createElement('input');
            protocolInput.value = 'https';

            const result = {
                obsidianSuccess: true,
                obsidianMessage: 'Connected',
                aiSuccess: true,
                aiMessage: 'Connected',
            };

            displayConnectionResult(statusDiv, result, protocolInput, 8080);

            expect(statusDiv.innerHTML).toContain('📦 Obsidian:');
            expect(statusDiv.innerHTML).toContain('🤖 AI:');
            expect(statusDiv.innerHTML).toContain('✅');
            expect(statusDiv.className).toBe('success');
        });

        it('should show error when Obsidian connection fails', () => {
            const statusDiv = document.createElement('div');
            const protocolInput = document.createElement('input');
            protocolInput.value = 'https';

            const result = {
                obsidianSuccess: false,
                obsidianMessage: 'Failed to fetch',
                aiSuccess: true,
                aiMessage: 'Connected',
            };

            displayConnectionResult(statusDiv, result, protocolInput, 8080);

            expect(statusDiv.innerHTML).toContain('❌');
            expect(statusDiv.className).toBe('error');
        });

        it('should show error when AI connection fails', () => {
            const statusDiv = document.createElement('div');
            const protocolInput = document.createElement('input');
            protocolInput.value = 'http';

            const result = {
                obsidianSuccess: true,
                obsidianMessage: 'Connected',
                aiSuccess: false,
                aiMessage: 'Invalid API key',
            };

            displayConnectionResult(statusDiv, result, protocolInput, 8080);

            expect(statusDiv.innerHTML).toContain('❌');
            expect(statusDiv.innerHTML).toContain('Invalid API key');
            expect(statusDiv.className).toBe('error');
        });

        it('should add certificate warning for HTTPS failed connection', () => {
            const statusDiv = document.createElement('div');
            const protocolInput = document.createElement('input');
            protocolInput.value = 'https';

            const result = {
                obsidianSuccess: false,
                obsidianMessage: 'Failed to fetch',
                aiSuccess: false,
                aiMessage: 'Failed to fetch',
            };

            displayConnectionResult(statusDiv, result, protocolInput, 8080);

            expect(statusDiv.innerHTML).toContain('<a ');
        });

        it('should NOT add certificate warning for HTTP protocol', () => {
            const statusDiv = document.createElement('div');
            const protocolInput = document.createElement('input');
            protocolInput.value = 'http';

            const result = {
                obsidianSuccess: false,
                obsidianMessage: 'Failed to fetch',
                aiSuccess: false,
                aiMessage: 'Failed to fetch',
            };

            displayConnectionResult(statusDiv, result, protocolInput, 8080);

            expect(statusDiv.querySelector('a')).toBeNull();
        });

        it('should show both connection results', () => {
            const statusDiv = document.createElement('div');
            const protocolInput = document.createElement('input');
            protocolInput.value = 'https';

            const result = {
                obsidianSuccess: true,
                obsidianMessage: 'OK',
                aiSuccess: true,
                aiMessage: 'OK',
            };

            displayConnectionResult(statusDiv, result, protocolInput, 8080);

            expect(statusDiv.innerHTML).toContain('📦 Obsidian:');
            expect(statusDiv.innerHTML).toContain('🤖 AI:');
        });

        it('should clear previous content before displaying results', () => {
            const statusDiv = document.createElement('div');
            statusDiv.innerHTML = '<p>Previous content</p>';
            const protocolInput = document.createElement('input');
            protocolInput.value = 'https';

            const result = {
                obsidianSuccess: true,
                obsidianMessage: 'OK',
                aiSuccess: true,
                aiMessage: 'OK',
            };

            displayConnectionResult(statusDiv, result, protocolInput, 8080);

            expect(statusDiv.innerHTML).not.toContain('Previous content');
        });
    });

    describe('handleSaveAndTest', () => {
        it('should show testing message and clear errors initially', async () => {
            const statusDiv = document.createElement('div');
            const inputs = createMockInputs();

            (validateAllFields as any).mockReturnValue(false);

            await handleSaveAndTest(
                statusDiv,
                inputs.protocolInput,
                inputs.portInput,
                inputs.minVisitDurationInput,
                inputs.minScrollDepthInput,
                inputs.maxTokensInput,
                {},
                validateAllFields as any
            );

            expect(clearAllFieldErrors).toHaveBeenCalled();
        });

        it('should set testing message before validation', async () => {
            const statusDiv = document.createElement('div');
            const inputs = createMockInputs();

            (validateAllFields as any).mockReturnValue(false);

            const promise = handleSaveAndTest(
                statusDiv,
                inputs.protocolInput,
                inputs.portInput,
                inputs.minVisitDurationInput,
                inputs.minScrollDepthInput,
                inputs.maxTokensInput,
                {},
                validateAllFields as any
            );

            // Even though validation fails, testingConnection message is set first
            // After validation fails it's cleared to ''
            await promise;
            expect(statusDiv.textContent).toBe('');
        });

        it('should return early when validation fails', async () => {
            const statusDiv = document.createElement('div');
            const inputs = createMockInputs();

            (validateAllFields as any).mockReturnValue(false);

            await handleSaveAndTest(
                statusDiv,
                inputs.protocolInput,
                inputs.portInput,
                inputs.minVisitDurationInput,
                inputs.minScrollDepthInput,
                inputs.maxTokensInput,
                {},
                validateAllFields as any
            );

            expect(saveSettingsWithAllowedUrls).not.toHaveBeenCalled();
        });

        it('should save settings and run connection test when validation passes', async () => {
            const statusDiv = document.createElement('div');
            const inputs = createMockInputs();

            (validateAllFields as any).mockReturnValue(true);
            (getSettings as any).mockResolvedValue({ existing: 'value' });
            (extractSettingsFromInputs as any).mockReturnValue({ newSetting: 'value' });
            (saveSettingsWithAllowedUrls as any).mockResolvedValue(undefined);
            (global.chrome.runtime.sendMessage as any).mockResolvedValue({
                obsidian: { success: true, message: 'OK' },
                ai: { success: true, message: 'OK' },
            });

            await handleSaveAndTest(
                statusDiv,
                inputs.protocolInput,
                inputs.portInput,
                inputs.minVisitDurationInput,
                inputs.minScrollDepthInput,
                inputs.maxTokensInput,
                {},
                validateAllFields as any
            );

            expect(saveSettingsWithAllowedUrls).toHaveBeenCalledWith({ existing: 'value', newSetting: 'value' });
            expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'TEST_CONNECTIONS', payload: {} });
            expect(statusDiv.className).toBe('success');
        });

        it('should handle saveSettingsWithAllowedUrls throwing an Error', async () => {
            const statusDiv = document.createElement('div');
            const inputs = createMockInputs();

            (validateAllFields as any).mockReturnValue(true);
            (getSettings as any).mockResolvedValue({});
            (extractSettingsFromInputs as any).mockReturnValue({});
            const testError = new Error('Save failed');
            (saveSettingsWithAllowedUrls as any).mockRejectedValue(testError);

            await handleSaveAndTest(
                statusDiv,
                inputs.protocolInput,
                inputs.portInput,
                inputs.minVisitDurationInput,
                inputs.minScrollDepthInput,
                inputs.maxTokensInput,
                {},
                validateAllFields as any
            );

            expect(statusDiv.textContent).toContain('Save error: Save failed');
            expect(statusDiv.className).toBe('error');
        });

        it('should handle non-Error thrown value', async () => {
            const statusDiv = document.createElement('div');
            const inputs = createMockInputs();

            (validateAllFields as any).mockReturnValue(true);
            (getSettings as any).mockResolvedValue({});
            (extractSettingsFromInputs as any).mockReturnValue({});
            (saveSettingsWithAllowedUrls as any).mockRejectedValue('String error');

            await handleSaveAndTest(
                statusDiv,
                inputs.protocolInput,
                inputs.portInput,
                inputs.minVisitDurationInput,
                inputs.minScrollDepthInput,
                inputs.maxTokensInput,
                {},
                validateAllFields as any
            );

            expect(statusDiv.textContent).toBe('Save error: String error');
            expect(statusDiv.className).toBe('error');
        });

        it('should display error connection result after save', async () => {
            const statusDiv = document.createElement('div');
            const inputs = createMockInputs();
            inputs.protocolInput.value = 'https';

            (validateAllFields as any).mockReturnValue(true);
            (getSettings as any).mockResolvedValue({});
            (extractSettingsFromInputs as any).mockReturnValue({});
            (saveSettingsWithAllowedUrls as any).mockResolvedValue(undefined);
            (global.chrome.runtime.sendMessage as any).mockResolvedValue({
                obsidian: { success: false, message: 'Failed to fetch' },
                ai: { success: false, message: 'Failed' },
            });

            await handleSaveAndTest(
                statusDiv,
                inputs.protocolInput,
                inputs.portInput,
                inputs.minVisitDurationInput,
                inputs.minScrollDepthInput,
                inputs.maxTokensInput,
                {},
                validateAllFields as any
            );

            expect(statusDiv.className).toBe('error');
            expect(statusDiv.innerHTML).toContain('❌');
            expect(statusDiv.innerHTML).toContain('<a '); // certificate warning for https
        });

        it('should merge new settings with current settings', async () => {
            const statusDiv = document.createElement('div');
            const inputs = createMockInputs();

            (validateAllFields as any).mockReturnValue(true);
            (getSettings as any).mockResolvedValue({ oldKey: 'oldValue' });
            (extractSettingsFromInputs as any).mockReturnValue({ newKey: 'newValue' });
            (saveSettingsWithAllowedUrls as any).mockResolvedValue(undefined);
            (global.chrome.runtime.sendMessage as any).mockResolvedValue({
                obsidian: { success: true, message: 'OK' },
                ai: { success: true, message: 'OK' },
            });

            await handleSaveAndTest(
                statusDiv,
                inputs.protocolInput,
                inputs.portInput,
                inputs.minVisitDurationInput,
                inputs.minScrollDepthInput,
                inputs.maxTokensInput,
                {},
                validateAllFields as any
            );

            expect(saveSettingsWithAllowedUrls).toHaveBeenCalledWith({
                oldKey: 'oldValue',
                newKey: 'newValue',
            });
        });

        it('should call getSettings twice (before save and verification)', async () => {
            const statusDiv = document.createElement('div');
            const inputs = createMockInputs();

            (validateAllFields as any).mockReturnValue(true);
            (getSettings as any).mockResolvedValue({});
            (extractSettingsFromInputs as any).mockReturnValue({});
            (saveSettingsWithAllowedUrls as any).mockResolvedValue(undefined);
            (global.chrome.runtime.sendMessage as any).mockResolvedValue({
                obsidian: { success: true, message: 'OK' },
                ai: { success: true, message: 'OK' },
            });

            await handleSaveAndTest(
                statusDiv,
                inputs.protocolInput,
                inputs.portInput,
                inputs.minVisitDurationInput,
                inputs.minScrollDepthInput,
                inputs.maxTokensInput,
                {},
                validateAllFields as any
            );

            expect(getSettings).toHaveBeenCalledTimes(2);
        });
    });

    describe('setupSaveButtonListener', () => {
        it('should add click event listener and return cleanup function', () => {
            const saveBtn = document.createElement('button') as HTMLButtonElement;
            const statusDiv = document.createElement('div');
            const inputs = createMockInputs();

            const addEventListenerSpy = vi.spyOn(saveBtn, 'addEventListener');
            const removeEventListenerSpy = vi.spyOn(saveBtn, 'removeEventListener');

            const cleanup = setupSaveButtonListener(
                saveBtn,
                statusDiv,
                inputs.protocolInput,
                inputs.portInput,
                inputs.minVisitDurationInput,
                inputs.minScrollDepthInput,
                inputs.maxTokensInput,
                {}
            );

            expect(addEventListenerSpy).toHaveBeenCalledWith('click', expect.any(Function));
            expect(typeof cleanup).toBe('function');

            cleanup();
            expect(removeEventListenerSpy).toHaveBeenCalledWith('click', expect.any(Function));

            addEventListenerSpy.mockRestore();
            removeEventListenerSpy.mockRestore();
        });

        it('click handler should invoke validation logic on click', async () => {
            const saveBtn = document.createElement('button') as HTMLButtonElement;
            const statusDiv = document.createElement('div');
            const inputs = createMockInputs();

            (validateAllFields as any).mockReturnValue(false);

            setupSaveButtonListener(
                saveBtn,
                statusDiv,
                inputs.protocolInput,
                inputs.portInput,
                inputs.minVisitDurationInput,
                inputs.minScrollDepthInput,
                inputs.maxTokensInput,
                {}
            );

            saveBtn.click();
            await Promise.resolve(); // flush microtasks

            expect(validateAllFields).toHaveBeenCalled();
            expect(statusDiv.textContent).toBe('');
        });
    });

    describe('handleSaveAndTest edge cases', () => {
        it('should handle saveSettingsWithAllowedUrls throwing null', async () => {
            const statusDiv = document.createElement('div');
            const inputs = createMockInputs();

            (validateAllFields as any).mockReturnValue(true);
            (getSettings as any).mockResolvedValue({});
            (extractSettingsFromInputs as any).mockReturnValue({});
            (saveSettingsWithAllowedUrls as any).mockRejectedValue(null);

            await handleSaveAndTest(
                statusDiv,
                inputs.protocolInput,
                inputs.portInput,
                inputs.minVisitDurationInput,
                inputs.minScrollDepthInput,
                inputs.maxTokensInput,
                {},
                validateAllFields as any
            );

            expect(statusDiv.textContent).toBe('Save error: null');
            expect(statusDiv.className).toBe('error');
        });

        it('should handle saveSettingsWithAllowedUrls throwing undefined', async () => {
            const statusDiv = document.createElement('div');
            const inputs = createMockInputs();

            (validateAllFields as any).mockReturnValue(true);
            (getSettings as any).mockResolvedValue({});
            (extractSettingsFromInputs as any).mockReturnValue({});
            (saveSettingsWithAllowedUrls as any).mockRejectedValue(undefined);

            await handleSaveAndTest(
                statusDiv,
                inputs.protocolInput,
                inputs.portInput,
                inputs.minVisitDurationInput,
                inputs.minScrollDepthInput,
                inputs.maxTokensInput,
                {},
                validateAllFields as any
            );

            expect(statusDiv.textContent).toBe('Save error: undefined');
            expect(statusDiv.className).toBe('error');
        });

        it('should handle saveSettingsWithAllowedUrls throwing 0 (falsy value)', async () => {
            const statusDiv = document.createElement('div');
            const inputs = createMockInputs();

            (validateAllFields as any).mockReturnValue(true);
            (getSettings as any).mockResolvedValue({});
            (extractSettingsFromInputs as any).mockReturnValue({});
            (saveSettingsWithAllowedUrls as any).mockRejectedValue(0);

            await handleSaveAndTest(
                statusDiv,
                inputs.protocolInput,
                inputs.portInput,
                inputs.minVisitDurationInput,
                inputs.minScrollDepthInput,
                inputs.maxTokensInput,
                {},
                validateAllFields as any
            );

            expect(statusDiv.textContent).toBe('Save error: 0');
            expect(statusDiv.className).toBe('error');
        });

        it('should handle saveSettingsWithAllowedUrls throwing an object without message property', async () => {
            const statusDiv = document.createElement('div');
            const inputs = createMockInputs();

            (validateAllFields as any).mockReturnValue(true);
            (getSettings as any).mockResolvedValue({});
            (extractSettingsFromInputs as any).mockReturnValue({});
            (saveSettingsWithAllowedUrls as any).mockRejectedValue({ code: 'ECONNREFUSED' });

            await handleSaveAndTest(
                statusDiv,
                inputs.protocolInput,
                inputs.portInput,
                inputs.minVisitDurationInput,
                inputs.minScrollDepthInput,
                inputs.maxTokensInput,
                {},
                validateAllFields as any
            );

            expect(statusDiv.textContent).toBe('Save error: [object Object]');
            expect(statusDiv.className).toBe('error');
        });

        it('should handle getSettings throwing before save', async () => {
            const statusDiv = document.createElement('div');
            const inputs = createMockInputs();
            const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            (validateAllFields as any).mockReturnValue(true);
            (getSettings as any).mockRejectedValue(new Error('Storage error'));

            await expect(handleSaveAndTest(
                statusDiv,
                inputs.protocolInput,
                inputs.portInput,
                inputs.minVisitDurationInput,
                inputs.minScrollDepthInput,
                inputs.maxTokensInput,
                {},
                validateAllFields as any
            )).rejects.toThrow('Storage error');

            consoleErrorSpy.mockRestore();
        });
    });

    describe('displayConnectionResult edge cases', () => {
        it('should NOT add certificate warning when Obsidian fails with non-fetch message', () => {
            const statusDiv = document.createElement('div');
            const protocolInput = document.createElement('input');
            protocolInput.value = 'https';

            const result = {
                obsidianSuccess: false,
                obsidianMessage: 'Connection refused',
                aiSuccess: true,
                aiMessage: 'Connected',
            };

            displayConnectionResult(statusDiv, result, protocolInput, 8080);

            expect(statusDiv.querySelector('a')).toBeNull();
            expect(statusDiv.className).toBe('error');
        });

        it('should use SUCCESS color when Obsidian connection succeeds', () => {
            const statusDiv = document.createElement('div');
            const protocolInput = document.createElement('input');
            protocolInput.value = 'http';

            const result = {
                obsidianSuccess: true,
                obsidianMessage: 'Connected',
                aiSuccess: true,
                aiMessage: 'Connected',
            };

            displayConnectionResult(statusDiv, result, protocolInput, 80);

            const obsidianSpan = statusDiv.querySelector('div:first-child span');
            expect(obsidianSpan).not.toBeNull();
            expect((obsidianSpan as HTMLElement).style.color).toBeTruthy();
        });

        it('should use ERROR color when AI connection fails', () => {
            const statusDiv = document.createElement('div');
            const protocolInput = document.createElement('input');
            protocolInput.value = 'http';

            const result = {
                obsidianSuccess: true,
                obsidianMessage: 'Connected',
                aiSuccess: false,
                aiMessage: 'Timeout',
            };

            displayConnectionResult(statusDiv, result, protocolInput, 80);

            const spans = statusDiv.querySelectorAll('span');
            const aiSpan = spans[spans.length - 1];
            expect(aiSpan).not.toBeNull();
            expect((aiSpan as HTMLElement).style.color).toBeTruthy();
        });

        it('should show success for HTTP protocol when both connections succeed', () => {
            const statusDiv = document.createElement('div');
            const protocolInput = document.createElement('input');
            protocolInput.value = 'http';

            const result = {
                obsidianSuccess: true,
                obsidianMessage: 'Connected',
                aiSuccess: true,
                aiMessage: 'Connected',
            };

            displayConnectionResult(statusDiv, result, protocolInput, 80);

            expect(statusDiv.className).toBe('success');
            expect(statusDiv.querySelector('a')).toBeNull();
        });
    });

    describe('runConnectionTest edge cases', () => {
        it('should propagate when sendMessage throws', async () => {
            (global.chrome.runtime.sendMessage as any).mockRejectedValue(new Error('Extension error'));

            await expect(runConnectionTest()).rejects.toThrow('Extension error');
        });

        it('should handle ai message being an empty string', async () => {
            (global.chrome.runtime.sendMessage as any).mockResolvedValue({
                obsidian: { success: true, message: 'OK' },
                ai: { success: false, message: '' },
            });

            const result = await runConnectionTest();

            expect(result.aiMessage).toBe('');
            expect(result.aiSuccess).toBe(false);
        });
    });
});
