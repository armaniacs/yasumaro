// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../tabUtils.js', () => ({
    getCurrentTab: vi.fn(),
    isRecordable: vi.fn().mockReturnValue(true),
}));

vi.mock('../i18n.js', () => ({
    getMessage: vi.fn((key: string) => key),
}));

vi.mock('../../utils/storage.js', () => ({
    getSettings: vi.fn().mockResolvedValue({}),
    saveSettings: vi.fn().mockResolvedValue(undefined),
    StorageKeys: {
        PII_CONFIRMATION_UI: 'pii_confirmation_ui',
        DOMAIN_WHITELIST: 'domain_whitelist',
    },
}));

vi.mock('../statusChecker.js', () => ({
    checkPageStatus: vi.fn().mockResolvedValue(null),
    formatTimeAgo: vi.fn().mockReturnValue(''),
}));

vi.mock('../spinner.js', () => ({
    showSpinner: vi.fn(),
    hideSpinner: vi.fn(),
}));

vi.mock('../errorUtils.js', () => ({
    showError: vi.fn(),
    showSuccess: vi.fn(),
    formatSuccessMessage: vi.fn().mockReturnValue('Success'),
}));

vi.mock('../sanitizePreview.js', () => ({
    showPreview: vi.fn(),
    initializeModalEvents: vi.fn(),
}));

vi.mock('../autoClose.js', () => ({
    startAutoCloseTimer: vi.fn(),
}));

vi.mock('../../utils/retryHelper.js', () => ({
    sendMessageWithRetry: vi.fn(),
}));

vi.mock('../../utils/storageUrls.js', () => ({
    getSavedUrlEntries: vi.fn().mockResolvedValue([]),
}));

vi.mock('../statusPanel.js', () => ({
    updateCleansingStatus: vi.fn(),
    updateTrustStatus: vi.fn(),
    initStatusPanel: vi.fn(),
}));

vi.mock('../privatePageDialog.js', () => ({
    setCurrentPendingSave: vi.fn(),
}));

vi.mock('../../utils/logger.js', () => ({
    logError: vi.fn(),
    ErrorCode: {
        CONTENT_EXTRACTION_FAILURE: 'CONTENT_EXTRACTION_FAILURE',
    },
}));

import { loadCurrentTab, recordCurrentPage, initRecordButton } from '../recordCurrentPage.js';
import { getCurrentTab, isRecordable } from '../tabUtils.js';
import { sendMessageWithRetry } from '../../utils/retryHelper.js';
import { showError } from '../errorUtils.js';
import { showSpinner } from '../spinner.js';

// getURL must return a valid URL for new URL() in loadCurrentTab
vi.spyOn(chrome.runtime, 'getURL').mockImplementation((path: string) =>
    `chrome-extension://test-extension-id${path}`
);

// Set up DOM for module-level initialization (L415)
document.body.innerHTML = '<button id="recordBtn"></button>';

// Mock chrome APIs
const mockChrome = {
    tabs: {
        sendMessage: vi.fn(),
        query: vi.fn().mockResolvedValue([{ url: 'https://example.com' }]),
    },
    scripting: {
        executeScript: vi.fn().mockImplementation(async ({ func }: { func: () => string }) => {
            return [{ result: func() }];
        }),
    },
    runtime: {
        sendMessage: vi.fn().mockResolvedValue(undefined),
        getURL: vi.fn((path: string) => `chrome-extension://test-extension-id${path}`),
        lastError: null as { message: string } | null,
    },
    permissions: {
        contains: vi.fn().mockResolvedValue(true),
        request: vi.fn().mockResolvedValue(true),
    },
};

Object.assign(chrome, mockChrome);

describe('loadCurrentTab', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <img id="favicon" src="">
            <div id="pageTitle"></div>
            <div id="pageUrl"></div>
            <button id="recordBtn"></button>
        `;
    });

    it('returns early when no tab found', async () => {
        (getCurrentTab as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
        await expect(loadCurrentTab()).resolves.not.toThrow();
    });

    it('sets favicon, title and url for normal tab', async () => {
        (getCurrentTab as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
            url: 'https://example.com',
            title: 'Example',
            id: 1,
        });
        await loadCurrentTab();
        expect((document.getElementById('favicon') as HTMLImageElement).src).toContain('example.com');
        expect(document.getElementById('pageTitle')!.textContent).toBe('Example');
    });

    it('truncates URL longer than 50 chars', async () => {
        const longUrl = 'https://example.com/' + 'a'.repeat(60);
        (getCurrentTab as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
            url: longUrl,
            title: 'Long URL Page',
            id: 1,
        });
        await loadCurrentTab();
        const urlEl = document.getElementById('pageUrl');
        expect(urlEl!.textContent!.length).toBeLessThanOrEqual(53); // 50 + '...'
        expect(urlEl!.textContent).toContain('...');
    });

    it('disables record button when tab is not recordable', async () => {
        (getCurrentTab as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
            url: 'chrome://extensions',
            title: 'Extensions',
            id: 1,
        });
        (isRecordable as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);
        await loadCurrentTab();
        const btn = document.getElementById('recordBtn') as HTMLButtonElement;
        expect(btn.disabled).toBe(true);
    });

    it('enables record button when tab is recordable', async () => {
        (getCurrentTab as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
            url: 'https://example.com',
            title: 'Example',
            id: 1,
        });
        (isRecordable as ReturnType<typeof vi.fn>).mockReturnValueOnce(true);
        await loadCurrentTab();
        const btn = document.getElementById('recordBtn') as HTMLButtonElement;
        expect(btn.disabled).toBe(false);
    });

    it('uses fallback title when tab has no title', async () => {
        (getCurrentTab as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
            url: 'https://example.com',
            title: undefined,
            id: 1,
        });
        await loadCurrentTab();
        const titleEl = document.getElementById('pageTitle');
        expect(titleEl!.textContent).toBe('noTitle');
    });
});

describe('recordCurrentPage', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <div id="mainStatus"></div>
            <button id="recordBtn"></button>
            <div id="tagResultPanel"></div>
        `;
        // Reset mocks
        vi.clearAllMocks();
        chrome.runtime.lastError = null;
        chrome.tabs.sendMessage.mockResolvedValue({ content: 'test content' });
        (sendMessageWithRetry as ReturnType<typeof vi.fn>).mockResolvedValue({
            success: true,
            aiDuration: 100,
        });
    });

    it('handles tab not recordable case (L209)', async () => {
        (getCurrentTab as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
            id: 1,
            url: 'https://example.com',
            title: 'Test',
        });
        (isRecordable as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);

        await recordCurrentPage();

        expect(showError).toHaveBeenCalledWith(
            document.getElementById('mainStatus'),
            expect.any(Error),
            expect.any(Function)
        );
    });

    it('handles chrome.runtime.lastError after sendMessage (L225)', async () => {
        (getCurrentTab as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
            id: 1,
            url: 'https://example.com',
            title: 'Test',
        });
        chrome.tabs.sendMessage.mockResolvedValueOnce({ content: 'test' });
        chrome.runtime.lastError = { message: 'Runtime error' };

        await recordCurrentPage();

        expect(chrome.scripting.executeScript).toHaveBeenCalledWith({
            target: { tabId: 1 },
            func: expect.any(Function),
        });
    });

    it('falls back to chrome.scripting.executeScript when sendMessage fails (L243)', async () => {
        (getCurrentTab as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
            id: 1,
            url: 'https://example.com',
            title: 'Test',
        });
        chrome.tabs.sendMessage.mockRejectedValueOnce(new Error('Send failed'));
        chrome.runtime.lastError = null;

        await recordCurrentPage();

        expect(chrome.scripting.executeScript).toHaveBeenCalledWith({
            target: { tabId: 1 },
            func: expect.any(Function),
        });
    });

    it('initializes record button onclick handler (L415)', async () => {
        (getCurrentTab as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
            id: 1,
            url: 'https://example.com',
            title: 'Test',
        });

        const btn = document.getElementById('recordBtn') as HTMLButtonElement;

        initRecordButton();

        expect(btn.onclick).toBeDefined();
        expect(typeof btn.onclick).toBe('function');

        // Trigger onclick to cover the arrow function at L415
        await (btn.onclick!() as Promise<void>);

        // Verify recordCurrentPage was invoked via showSpinner call
        expect(showSpinner).toHaveBeenCalled();
    });
});
