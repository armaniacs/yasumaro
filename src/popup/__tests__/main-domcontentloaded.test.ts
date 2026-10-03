// @vitest-environment jsdom
/**
 * main-domcontentloaded.test.ts
 * Tests for main.ts DOMContentLoaded handler and error paths.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { drainMacrotask } from '../../../testDir/waitPolicy.js';

// Hoisted mock for logger
const { logErrorMock } = vi.hoisted(() => ({ logErrorMock: vi.fn() }));
vi.mock('../../utils/logger/types.js', async () =>
  (await import('../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    logError: logErrorMock,
    ErrorCode: { INTERNAL_ERROR: 'INTERNAL_ERROR' },
  }),
);
vi.mock('../../utils/logger/core.js', async () =>
  (await import('../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    logError: logErrorMock,
    ErrorCode: { INTERNAL_ERROR: 'INTERNAL_ERROR' },
  }),
);
vi.mock('../../utils/logger/api.js', async () =>
  (await import('../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    logError: logErrorMock,
    ErrorCode: { INTERNAL_ERROR: 'INTERNAL_ERROR' },
  }),
);

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

// Mock tabUtils — the single seam main.ts reads the active tab through
const { getCurrentTabMock } = vi.hoisted(() => ({
    getCurrentTabMock: vi.fn().mockResolvedValue(null)
}));
vi.mock('../tabUtils.js', () => ({
    getCurrentTab: getCurrentTabMock,
    isRecordable: vi.fn().mockReturnValue(false)
}));

// Mock recordCurrentPage
vi.mock('../recordCurrentPage.js', () => ({
    loadCurrentTab: vi.fn().mockResolvedValue(undefined),
    recordCurrentPage: vi.fn().mockResolvedValue(undefined),
    setRecordCurrentPageFn: vi.fn()
}));

// chrome.tabs.query stays stubbed as a tripwire: main.ts must not call it
// directly, the seam owns active-tab reads. Role split: the runtime twin
// below ("reads the active tab through the seam") proves the DOMContentLoaded
// path never touches chrome.tabs.query; the source pin ("contains no raw
// chrome.tabs.query") catches a direct call in ANY future main.ts path the
// twin does not execute. The pin is an intentional tripwire, not a style
// check — it also trips on a comment mentioning chrome.tabs.query in main.ts;
// edit the comment, never delete the pin.
vi.stubGlobal('chrome', {
    tabs: {
        query: vi.fn(),
    },
    action: {
        setBadgeText: vi.fn()
    }
});

const mainSource = readFileSync(resolve(process.cwd(), 'src/popup/main.ts'), 'utf-8');

// Import main.ts for side effects (registers DOMContentLoaded listener)
import '../main.js';

describe('main.ts DOMContentLoaded', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        logErrorMock.mockClear();
        getCurrentTabMock.mockResolvedValue(null);

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
        await vi.waitFor(
            () => expect(initStatusPanelMock).toHaveBeenCalled(),
            { interval: 1 }
        );
        expect(initAllUrlsPermissionBannerMock).toHaveBeenCalled();
        expect(getCurrentTabMock).toHaveBeenCalled();
    });

    // Deliberate tripwire, kept on purpose (role split with the runtime twin
    // below is documented at the chrome stub above): fails on any direct
    // chrome.tabs.query usage in main.ts source, including forms the runtime
    // twin could miss (destructuring, aliasing). Update consciously; do not
    // delete silently.
    it('contains no raw chrome.tabs.query', () => {
        expect(mainSource).not.toMatch(/chrome\.tabs\.query/);
    });

    it('logs error when loadCurrentTabAndInitStatus fails', async () => {
        initStatusPanelMock.mockRejectedValue(new Error('status init fail'));
        initAllUrlsPermissionBannerMock.mockResolvedValue(undefined);

        document.dispatchEvent(new Event('DOMContentLoaded'));
        await vi.waitFor(
            () => expect(logErrorMock).toHaveBeenCalledWith(
            expect.stringContaining('Failed to load current tab or init status panel'),
            expect.anything(),
            'INTERNAL_ERROR'
        ),
            { interval: 1 }
        );
    });

    it('logs error when initAllUrlsPermissionBanner fails', async () => {
        initStatusPanelMock.mockResolvedValue(undefined);
        initAllUrlsPermissionBannerMock.mockRejectedValue(new Error('banner fail'));

        document.dispatchEvent(new Event('DOMContentLoaded'));
        await vi.waitFor(
            () => expect(logErrorMock).toHaveBeenCalledWith(
            expect.stringContaining('Failed to init all-urls permission banner'),
            expect.anything(),
            'INTERNAL_ERROR'
        ),
            { interval: 1 }
        );
    });

    it('reads the active tab through the seam instead of chrome.tabs.query', async () => {
        initStatusPanelMock.mockResolvedValue(undefined);
        initAllUrlsPermissionBannerMock.mockResolvedValue(undefined);

        document.dispatchEvent(new Event('DOMContentLoaded'));
        await vi.waitFor(
            () => expect(getCurrentTabMock).toHaveBeenCalled(),
            { interval: 1 }
        );
        expect(chrome.tabs.query).not.toHaveBeenCalled();
    });

    it('clears badge text when the seam resolves a tab with an id', async () => {
        initStatusPanelMock.mockResolvedValue(undefined);
        initAllUrlsPermissionBannerMock.mockResolvedValue(undefined);
        getCurrentTabMock.mockResolvedValue({ id: 123, url: 'https://example.com' });

        document.dispatchEvent(new Event('DOMContentLoaded'));
        await vi.waitFor(
            () => expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '', tabId: 123 }),
            { interval: 1 }
        );
        expect(chrome.action.setBadgeText).toHaveBeenCalledTimes(1);
    });

    it('does not set badge text when the seam returns a tab with no id', async () => {
        initStatusPanelMock.mockResolvedValue(undefined);
        initAllUrlsPermissionBannerMock.mockResolvedValue(undefined);
        getCurrentTabMock.mockResolvedValue({ url: 'https://example.com' });

        document.dispatchEvent(new Event('DOMContentLoaded'));
        await drainMacrotask();
        expect(chrome.action.setBadgeText).not.toHaveBeenCalled();
    });

    it('does not set badge text when the seam returns no tab', async () => {
        initStatusPanelMock.mockResolvedValue(undefined);
        initAllUrlsPermissionBannerMock.mockResolvedValue(undefined);
        getCurrentTabMock.mockResolvedValue(null);

        document.dispatchEvent(new Event('DOMContentLoaded'));
        await drainMacrotask();
        expect(chrome.action.setBadgeText).not.toHaveBeenCalled();
    });

    it('swallows a failing tab read without logging or breaking the other init work', async () => {
        initStatusPanelMock.mockResolvedValue(undefined);
        initAllUrlsPermissionBannerMock.mockResolvedValue(undefined);
        getCurrentTabMock.mockRejectedValue(new Error('tabs unavailable'));

        document.dispatchEvent(new Event('DOMContentLoaded'));
        await vi.waitFor(
            () => expect(initStatusPanelMock).toHaveBeenCalled(),
            { interval: 1 }
        );
        expect(chrome.action.setBadgeText).not.toHaveBeenCalled();
        expect(logErrorMock).not.toHaveBeenCalled();
    });
});
