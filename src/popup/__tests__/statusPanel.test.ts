// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getCleansedReasonText, updateCleansingStatus, renderSpecialUrlStatus, initStatusPanel, initAllUrlsPermissionBanner } from '../statusPanel.js';

// Mock dependencies using vi.hoisted
const { mockGetCurrentTab, mockGetSettings, mockSaveSettings, mockGetMessage, mockIsAllUrlsPermitted, mockRequestAllUrls, mockChromeTabsQuery } = vi.hoisted(() => ({
    mockGetCurrentTab: vi.fn(),
    mockGetSettings: vi.fn(),
    mockSaveSettings: vi.fn(),
    mockGetMessage: vi.fn(),
    mockIsAllUrlsPermitted: vi.fn(),
    mockRequestAllUrls: vi.fn(),
    mockChromeTabsQuery: vi.fn(),
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

vi.mock('../../utils/i18n.js', () => ({
    getMessage: mockGetMessage,
}));

vi.mock('../utils/permissionManager.js', () => ({
    isAllUrlsPermitted: mockIsAllUrlsPermitted,
    requestAllUrls: mockRequestAllUrls,
}));

vi.mock('chrome', () => ({
    tabs: {
        query: mockChromeTabsQuery,
    },
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

    it('adds current tab URL to whitelist when addPathBtn is clicked', async () => {
        const mockTab = { id: 1, url: 'https://example.com' };
        const mockSettings = { domainWhitelist: ['https://existing.com'] };

        mockChromeTabsQuery.mockResolvedValue([mockTab]);
        mockGetSettings.mockResolvedValue(mockSettings);
        mockSaveSettings.mockResolvedValue(undefined);
        mockGetMessage.mockReturnValue('Path added successfully');

        // Mock checkPageStatus and other functions that might be called
        const mockCheckPageStatus = vi.fn().mockResolvedValue({ isAllowed: true });
        vi.doMock('../statusChecker.js', () => ({
            checkPageStatus: mockCheckPageStatus,
        }));

        // Mock renderStatusPanel
        const mockRenderStatusPanel = vi.fn();
        vi.doMock('../statusPanel.js', async () => {
            const actual = await vi.importActual('../statusPanel.js');
            return {
                ...actual,
                renderStatusPanel: mockRenderStatusPanel,
                updateTrustStatus: vi.fn(),
                initStatusPanel: vi.fn(), // Mock recursive call
            };
        });

        await initStatusPanel();

        const addPathBtn = document.getElementById('statusAddPath')!;
        addPathBtn.click();

        // Wait for async operations
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(mockGetCurrentTab).toHaveBeenCalled();
        expect(mockGetSettings).toHaveBeenCalled();
        expect(mockSaveSettings).toHaveBeenCalledWith(
            { domainWhitelist: ['https://existing.com', 'https://example.com'] },
            true
        );

        const statusDiv = document.getElementById('mainStatus');
        expect(statusDiv!.textContent).toBe('Path added successfully');
        expect(statusDiv!.className).toBe('success');
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

    it('requests permission and hides banner when granted', async () => {
        const mockTab = { url: 'https://example.com' };
        mockIsAllUrlsPermitted.mockResolvedValue(false);
        mockRequestAllUrls.mockResolvedValue(true);
        mockChromeTabsQuery.mockResolvedValue([mockTab]);

        // Mock updateTrustStatus using vi.hoisted
        const { mockUpdateTrustStatus } = vi.hoisted(() => ({
            mockUpdateTrustStatus: vi.fn(),
        }));

        vi.doMock('../statusPanel.js', async () => {
            const actual = await vi.importActual('../statusPanel.js');
            return {
                ...actual,
                updateTrustStatus: mockUpdateTrustStatus,
            };
        });

        await initAllUrlsPermissionBanner();

        const btnRequestAllUrls = document.getElementById('btnRequestAllUrls')!;
        btnRequestAllUrls.click();

        await new Promise(resolve => setTimeout(resolve, 0));

        expect(mockRequestAllUrls).toHaveBeenCalled();
        expect(mockUpdateTrustStatus).toHaveBeenCalledWith('https://example.com');

        const banner = document.getElementById('allUrlsPermissionBanner')!;
        expect(banner.classList.contains('hidden')).toBe(true);
    });

    it('does not hide banner when permission denied', async () => {
        mockIsAllUrlsPermitted.mockResolvedValue(false);
        mockRequestAllUrls.mockResolvedValue(false);

        await initAllUrlsPermissionBanner();

        const btnRequestAllUrls = document.getElementById('btnRequestAllUrls')!;
        btnRequestAllUrls.click();

        await new Promise(resolve => setTimeout(resolve, 0));

        const banner = document.getElementById('allUrlsPermissionBanner')!;
        expect(banner.classList.contains('hidden')).toBe(false);
    });

    it('does nothing when banner element does not exist', async () => {
        document.body.innerHTML = '';
        mockIsAllUrlsPermitted.mockResolvedValue(false);

        await expect(initAllUrlsPermissionBanner()).resolves.not.toThrow();
    });
});
