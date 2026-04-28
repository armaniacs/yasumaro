// @vitest-environment jsdom
/**
 * main-domcontentloaded.test.ts
 * Tests for main.ts DOMContentLoaded handler and error paths.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted mock for logger
const { logErrorMock } = vi.hoisted(() => ({ logErrorMock: vi.fn() }));
vi.mock('../../utils/logger.js', () => ({
    logError: logErrorMock,
    ErrorCode: { INTERNAL_ERROR: 'INTERNAL_ERROR' }
}));

// Hoisted mocks for statusPanel
const { initStatusPanelMock, initAllUrlsPermissionBannerMock } = vi.hoisted(() => ({
    initStatusPanelMock: vi.fn(),
    initAllUrlsPermissionBannerMock: vi.fn()
}));

vi.mock('../statusPanel.js', () => ({
    initStatusPanel: initStatusPanelMock,
    initAllUrlsPermissionBanner: initAllUrlsPermissionBannerMock,
    getCleansedReasonText: vi.fn((reason: string | undefined) => reason || ''),
    renderSpecialUrlStatus: vi.fn(),
    updateCleansingStatus: vi.fn(),
    updateTrustStatus: vi.fn()
}));

// Mock sanitizePreview
vi.mock('../sanitizePreview.js', () => ({
    showPreview: vi.fn(),
    initializeModalEvents: vi.fn()
}));

// Mock tabUtils
vi.mock('../tabUtils.js', () => ({
    getCurrentTab: vi.fn().mockResolvedValue(null),
    isRecordable: vi.fn().mockReturnValue(false)
}));

// Mock recordCurrentPage
vi.mock('../recordCurrentPage.js', () => ({
    loadCurrentTab: vi.fn().mockResolvedValue(undefined),
    recordCurrentPage: vi.fn().mockResolvedValue(undefined),
    setRecordCurrentPageFn: vi.fn()
}));

// Global chrome mock with callback support for tabs.query
vi.stubGlobal('chrome', {
    tabs: {
        query: vi.fn((_query, callback) => {
            if (callback) callback([{ id: 123, url: 'https://example.com' }]);
        }),
    },
    action: {
        setBadgeText: vi.fn()
    }
});

// Import main.ts for side effects (registers DOMContentLoaded listener)
import '../main.js';

describe('main.ts DOMContentLoaded', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        logErrorMock.mockClear();

        document.body.innerHTML = `
            <img id="favicon" src="" alt="Favicon">
            <h2 id="pageTitle">Loading...</h2>
            <p id="pageUrl">Loading...</p>
            <button id="recordBtn">Record</button>
            <div id="mainStatus"></div>
            <div id="tagResultPanel" class="hidden"></div>
            <div id="statusPanel">
                <div id="statusDomainIcon" class="status-icon"><svg class="status-svg"></svg></div>
                <div id="statusPrivacyIcon" class="status-icon"><svg class="status-svg"></svg></div>
                <div id="statusDomainState"></div>
                <div id="statusDomainMode"></div>
                <div id="statusPrivacyContent"></div>
                <div id="statusCacheContent"></div>
                <div id="statusLastSavedContent"></div>
                <div id="statusCleansingContent"></div>
                <div id="statusTrustContent"></div>
                <button id="statusToggleBtn" aria-expanded="false"></button>
                <div id="statusDetails" class="hidden"></div>
                <span id="statusToggleText"></span>
                <div id="permissionRequestArea" class="hidden"></div>
                <div id="permissionDeniedMessage" class="hidden"></div>
            </div>
            <div id="allUrlsPermissionBanner" class="hidden"></div>
            <div id="private-page-dialog">
                <div id="dialog-message"></div>
                <button id="dialog-cancel"></button>
                <button id="dialog-save-once"></button>
                <button id="dialog-save-domain"></button>
                <button id="dialog-save-path"></button>
            </div>
        `;
    });

    it('initializes on DOMContentLoaded', async () => {
        initStatusPanelMock.mockResolvedValue(undefined);
        initAllUrlsPermissionBannerMock.mockResolvedValue(undefined);

        document.dispatchEvent(new Event('DOMContentLoaded'));
        await new Promise(r => setTimeout(r, 50));

        expect(initStatusPanelMock).toHaveBeenCalled();
        expect(initAllUrlsPermissionBannerMock).toHaveBeenCalled();
        expect(chrome.tabs.query).toHaveBeenCalled();
    });

    it('logs error when loadCurrentTabAndInitStatus fails', async () => {
        initStatusPanelMock.mockRejectedValue(new Error('status init fail'));
        initAllUrlsPermissionBannerMock.mockResolvedValue(undefined);

        document.dispatchEvent(new Event('DOMContentLoaded'));
        await new Promise(r => setTimeout(r, 50));

        expect(logErrorMock).toHaveBeenCalledWith(
            expect.stringContaining('Failed to load current tab or init status panel'),
            expect.anything(),
            'INTERNAL_ERROR'
        );
    });

    it('logs error when initAllUrlsPermissionBanner fails', async () => {
        initStatusPanelMock.mockResolvedValue(undefined);
        initAllUrlsPermissionBannerMock.mockRejectedValue(new Error('banner fail'));

        document.dispatchEvent(new Event('DOMContentLoaded'));
        await new Promise(r => setTimeout(r, 50));

        expect(logErrorMock).toHaveBeenCalledWith(
            expect.stringContaining('Failed to init all-urls permission banner'),
            expect.anything(),
            'INTERNAL_ERROR'
        );
    });

    it('clears badge text via chrome.tabs.query callback when tab id exists', async () => {
        initStatusPanelMock.mockResolvedValue(undefined);
        initAllUrlsPermissionBannerMock.mockResolvedValue(undefined);

        document.dispatchEvent(new Event('DOMContentLoaded'));
        await new Promise(r => setTimeout(r, 50));

        expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '', tabId: 123 });
    });

    it('does not set badge text when tab has no id', async () => {
        initStatusPanelMock.mockResolvedValue(undefined);
        initAllUrlsPermissionBannerMock.mockResolvedValue(undefined);

        // @ts-expect-error mockImplementation override
        chrome.tabs.query.mockImplementation((_query, callback) => {
            if (callback) callback([{ url: 'https://example.com' }]);
        });

        document.dispatchEvent(new Event('DOMContentLoaded'));
        await new Promise(r => setTimeout(r, 50));

        expect(chrome.action.setBadgeText).not.toHaveBeenCalled();
    });

    it('does not set badge text when tabs.query returns empty array', async () => {
        initStatusPanelMock.mockResolvedValue(undefined);
        initAllUrlsPermissionBannerMock.mockResolvedValue(undefined);

        // @ts-expect-error mockImplementation override
        chrome.tabs.query.mockImplementation((_query, callback) => {
            if (callback) callback([]);
        });

        document.dispatchEvent(new Event('DOMContentLoaded'));
        await new Promise(r => setTimeout(r, 50));

        expect(chrome.action.setBadgeText).not.toHaveBeenCalled();
    });
});
