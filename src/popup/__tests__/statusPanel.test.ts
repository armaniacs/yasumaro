// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getCleansedReasonText, updateCleansingStatus, renderSpecialUrlStatus, initStatusPanel, initAllUrlsPermissionBanner, updateTrustStatus } from '../statusPanel.js';

// Mock dependencies using vi.hoisted
const { mockGetCurrentTab, mockGetSettings, mockSaveSettings, mockGetMessage, mockIsAllUrlsPermitted, mockRequestAllUrls } = vi.hoisted(() => ({
    mockGetCurrentTab: vi.fn(),
    mockGetSettings: vi.fn(),
    mockSaveSettings: vi.fn(),
    mockGetMessage: vi.fn(),
    mockIsAllUrlsPermitted: vi.fn(),
    mockRequestAllUrls: vi.fn(),
}));

vi.mock('../tabUtils.js', () => ({
    getCurrentTab: mockGetCurrentTab,
}));

vi.mock('../../utils/storage.js', () => ({
    getSettings: mockGetSettings,
    saveSettings: mockSaveSettings,
    StorageKeys: {
        DOMAIN_WHITELIST: 'domainWhitelist',
    },
}));

vi.mock('../i18n.js', () => ({
    getMessage: mockGetMessage,
}));

vi.mock('../../utils/permissionManager.js', () => ({
    isAllUrlsPermitted: mockIsAllUrlsPermitted,
    requestAllUrls: mockRequestAllUrls,
}));

describe('getCleansedReasonText', () => {
    it('returns empty string when cleansedReason is undefined', () => {
        expect(getCleansedReasonText(undefined)).toBe('');
    });

    it('returns empty string when cleansedReason is "none"', () => {
        expect(getCleansedReasonText('none')).toBe('');
    });

    it('returns non-empty string for "hard"', () => {
        const result = getCleansedReasonText('hard');
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
    });

    it('returns non-empty string for "keyword"', () => {
        const result = getCleansedReasonText('keyword');
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
    });

    it('returns non-empty string for "both"', () => {
        const result = getCleansedReasonText('both');
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
    });
});

describe('updateCleansingStatus', () => {
    beforeEach(() => {
        document.body.innerHTML = `<div id="statusCleansingContent"></div>`;
    });

    it('does nothing when element does not exist', () => {
        document.body.innerHTML = '';
        expect(() => updateCleansingStatus({ totalRemoved: 5, hardStripRemoved: 3, keywordStripRemoved: 2 })).not.toThrow();
    });

    it('shows "none" message when cleanseStats is null-like (totalRemoved=0)', () => {
        updateCleansingStatus({ totalRemoved: 0, hardStripRemoved: 0, keywordStripRemoved: 0 });
        const el = document.getElementById('statusCleansingContent');
        expect(el!.innerHTML).toContain('status-muted');
    });

    it('renders html with status-value spans when hardStripRemoved > 0', () => {
        updateCleansingStatus({ totalRemoved: 3, hardStripRemoved: 3, keywordStripRemoved: 0 }, 'hard');
        const el = document.getElementById('statusCleansingContent');
        expect(el!.querySelectorAll('.status-value').length).toBeGreaterThan(0);
    });

    it('renders html with status-value spans when keywordStripRemoved > 0', () => {
        updateCleansingStatus({ totalRemoved: 2, hardStripRemoved: 0, keywordStripRemoved: 2 }, 'keyword');
        const el = document.getElementById('statusCleansingContent');
        expect(el!.querySelectorAll('.status-value').length).toBeGreaterThan(0);
    });

    it('renders spans for both hard and keyword when both applied', () => {
        updateCleansingStatus({ totalRemoved: 5, hardStripRemoved: 3, keywordStripRemoved: 2 }, 'both');
        const el = document.getElementById('statusCleansingContent');
        // hard + keyword + total + reason = 4 spans
        expect(el!.querySelectorAll('.status-value').length).toBeGreaterThanOrEqual(3);
    });
});

describe('renderSpecialUrlStatus', () => {
    beforeEach(() => {
        document.body.innerHTML = `<div id="statusPanel"></div>`;
    });

    it('renders error status in panel', () => {
        renderSpecialUrlStatus();
        const panel = document.getElementById('statusPanel');
        expect(panel!.innerHTML).toContain('status-error');
    });

    it('does nothing when statusPanel element does not exist', () => {
        document.body.innerHTML = '';
        expect(() => renderSpecialUrlStatus()).not.toThrow();
    });
});

describe('initStatusPanel', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <button id="statusAddPath"></button>
            <div id="mainStatus"></div>
        `;
        vi.clearAllMocks();
    });

    it('does not add URL if already in whitelist', async () => {
        const mockTab = { url: 'https://existing.com' };
        const mockSettings = { domainWhitelist: ['https://existing.com'] };

        mockGetCurrentTab.mockResolvedValue(mockTab);
        mockGetSettings.mockResolvedValue(mockSettings);

        await initStatusPanel();

        const addPathBtn = document.getElementById('statusAddPath')!;
        addPathBtn.click();

        await new Promise(resolve => setTimeout(resolve, 0));

        expect(mockSaveSettings).not.toHaveBeenCalled();
    });

    it('does nothing when no current tab', async () => {
        mockGetCurrentTab.mockResolvedValue(null);

        await initStatusPanel();

        const addPathBtn = document.getElementById('statusAddPath')!;
        addPathBtn.click();

        await new Promise(resolve => setTimeout(resolve, 0));

        expect(mockGetSettings).not.toHaveBeenCalled();
        expect(mockSaveSettings).not.toHaveBeenCalled();
    });

    it('does nothing when tab has no URL', async () => {
        const mockTab = { url: undefined };
        mockGetCurrentTab.mockResolvedValue(mockTab);

        await initStatusPanel();

        const addPathBtn = document.getElementById('statusAddPath')!;
        addPathBtn.click();

        await new Promise(resolve => setTimeout(resolve, 0));

        expect(mockGetSettings).not.toHaveBeenCalled();
        expect(mockSaveSettings).not.toHaveBeenCalled();
    });
});

describe('initAllUrlsPermissionBanner', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <div id="allUrlsPermissionBanner"></div>
            <button id="btnRequestAllUrls"></button>
        `;
        vi.clearAllMocks();
    });

    it('shows banner when permission not granted', async () => {
        mockIsAllUrlsPermitted.mockResolvedValue(false);

        await initAllUrlsPermissionBanner();

        const banner = document.getElementById('allUrlsPermissionBanner')!;
        expect(banner.classList.contains('hidden')).toBe(false);
    });

    it('hides banner when permission already granted', async () => {
        mockIsAllUrlsPermitted.mockResolvedValue(true);

        await initAllUrlsPermissionBanner();

        const banner = document.getElementById('allUrlsPermissionBanner')!;
        expect(banner.classList.contains('hidden')).toBe(true);
    });

    it('does nothing when banner element does not exist', async () => {
        document.body.innerHTML = '';
        mockIsAllUrlsPermitted.mockResolvedValue(false);

        await expect(initAllUrlsPermissionBanner()).resolves.not.toThrow();
    });
});

describe('updateTrustStatus', () => {
    it('returns early when trustContent element does not exist', async () => {
        document.body.innerHTML = '';
        await expect(updateTrustStatus('https://example.com')).resolves.not.toThrow();
    });
});
