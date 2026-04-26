// @vitest-environment jsdom
/**
 * settingsSaver.test.ts
 * settingsSaver.ts のユニットテスト
 * 注: runConnectionTest()は結合テストのため здесьではテストしない
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    addCertificateWarning,
    displayConnectionResult
} from '../settingsSaver.js';

import { STATUS_COLORS } from '../../constants/appConstants.js';

// Mock dependencies
vi.mock('../../utils/storage.js', () => ({
    getSettings: vi.fn(),
    saveSettingsWithAllowedUrls: vi.fn(),
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
        };
        return messages[key] || key;
    }),
}));

vi.mock('./fieldValidation.js', () => ({
    clearAllFieldErrors: vi.fn(),
    validateAllFields: vi.fn(() => true),
}));

describe('settingsSaver', () => {
    beforeEach(() => {
        vi.clearAllMocks();
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

            // Should show certificate warning for HTTPS
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

            // Should NOT show certificate warning for HTTP
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
});