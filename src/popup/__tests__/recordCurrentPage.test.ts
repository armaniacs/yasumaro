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
}));

vi.mock('../sanitizePreview.js', () => ({
    showPreview: vi.fn(),
    initializeModalEvents: vi.fn(),
}));

import { loadCurrentTab } from '../recordCurrentPage.js';
import { getCurrentTab, isRecordable } from '../tabUtils.js';

// getURL must return a valid URL for new URL() in loadCurrentTab
vi.spyOn(chrome.runtime, 'getURL').mockImplementation((path: string) =>
    `chrome-extension://test-extension-id${path}`
);

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
