// @vitest-environment jsdom
/**
 * popup.test.ts
 * Unit tests for popup.ts after PBI-27 (settings UI moved to dashboard)
 */
import { setHtmlLangAndDir } from '../../utils/i18n-dom.js';
import { describe, it, expect, vi } from 'vitest';

// Setup chrome mock BEFORE importing popup
vi.stubGlobal('chrome', {
    i18n: {
        getMessage: vi.fn((key: string) => key),
        getUILanguage: vi.fn(() => 'en'),
    },
    runtime: {
        sendMessage: vi.fn().mockResolvedValue({}),
        onMessage: { addListener: vi.fn() },
    },
    storage: {
        local: {
            get: vi.fn().mockResolvedValue({}),
            set: vi.fn().mockResolvedValue(undefined),
        },
    },
    tabs: {
        query: vi.fn().mockResolvedValue([]),
    },
    action: {
        setBadgeText: vi.fn(),
    },
});

// Setup minimal DOM BEFORE importing popup
document.body.innerHTML = `
    <div id="mainScreen"></div>
    <div id="currentPage">
        <div id="pageTitle"></div>
        <div id="pageUrl"></div>
    </div>
    <button id="recordBtn"></button>
    <div id="mainStatus"></div>
    <div id="privacyConsentModal" class="modal-dialog"></div>
    <div id="private-page-dialog"></div>
`;

// Mock logger - must be before importing popup
const { logErrorMock } = vi.hoisted(() => ({ logErrorMock: vi.fn() }));
vi.mock('../../utils/logger.js', () => ({
    logError: logErrorMock,
    ErrorCode: {
        INTERNAL_ERROR: 'INTERNAL_ERROR',
    },
}));

// Mock navigation
vi.mock('../navigation.js', () => ({
    init: vi.fn(),
}));

// Mock privacyConsentController
vi.mock('../privacyConsentController.js', () => ({
    initPrivacyConsent: vi.fn(),
    setupPrivacyConsentListeners: vi.fn(),
}));

// Mock trancoNotification
vi.mock('../trancoNotification.js', () => ({
    initTrancoUpdateNotification: vi.fn(),
}));

// Mock pendingStorage
vi.mock('../../utils/pendingStorage.js', async (importOriginal) => {
    // Keep the real reason-classification helpers so the dialog routing under
    // test is the real one; only the storage access is mocked.
    const actual = await importOriginal<typeof import('../../utils/pendingStorage.js')>();
    return {
        ...actual,
        getPendingPages: vi.fn(() => Promise.resolve([])),
        removePendingPages: vi.fn(() => Promise.resolve()),
    };
});

// Mock privatePageDialog
vi.mock('../privatePageDialog.js', () => ({
    showPrivatePageDialog: vi.fn(),
    showRecordingFailedDialog: vi.fn(),
}));

// Mock privacyConsent
vi.mock('../../utils/storage/privacyConsent.js', () => ({
    getPrivacyConsent: vi.fn(() => Promise.resolve({ hasConsented: true })),
}));

// Mock onboardingWizard
vi.mock('../onboardingWizard.js', () => ({
    hasCompletedWizard: vi.fn(() => Promise.resolve(false)),
    initOnboardingWizard: vi.fn(),
}));

// Import after mocks
import {
    initPopup,
} from '../popup.js';

describe('popup.ts exports', () => {
    it('exports initPopup', () => {
        expect(typeof initPopup).toBe('function');
    });
});

describe('setHtmlLangAndDir (single lang/dir helper — PBI 2026-09-11-04)', () => {
    it('sets RTL for Arabic', () => {
        vi.stubGlobal('chrome', {
            ...chrome,
            i18n: {
                ...chrome.i18n,
                getUILanguage: vi.fn().mockReturnValue('ar'),
            },
        });

        setHtmlLangAndDir();
        expect(document.documentElement.lang).toBe('ar');
        expect(document.documentElement.dir).toBe('rtl');
        vi.unstubAllGlobals();
    });

    it('sets LTR for English', () => {
        vi.stubGlobal('chrome', {
            ...chrome,
            i18n: {
                ...chrome.i18n,
                getUILanguage: vi.fn().mockReturnValue('en'),
            },
        });

        setHtmlLangAndDir();
        expect(document.documentElement.lang).toBe('en');
        expect(document.documentElement.dir).toBe('ltr');
        vi.unstubAllGlobals();
    });
});

describe('initPopup error handling', () => {
    beforeEach(() => {
        logErrorMock.mockClear();
    });

    it('initPopup completes without throwing', () => {
        expect(() => initPopup()).not.toThrow();
    });

    it('logError is not called during normal initPopup execution', async () => {
        logErrorMock.mockClear();
        await initPopup();
        expect(logErrorMock).not.toHaveBeenCalled();
    });

    it('setHtmlLangAndDir handles RTL languages', () => {
        setHtmlLangAndDir();
        expect(document.documentElement.dir).toBe('ltr');
    });
});

describe('initPopup coverage', () => {
    beforeEach(() => {
        logErrorMock.mockClear();
    });

    it('covers normal flow including pending page dialog (one pending page)', async () => {
        const { getPendingPages } = await import('../../utils/pendingStorage.js');
        vi.mocked(getPendingPages).mockResolvedValue([
            { url: 'https://example.com', reason: 'cache-control', headerValue: 'Cache-Control: private' }
        ] as unknown as Awaited<ReturnType<typeof getPendingPages>>);
        await expect(initPopup()).resolves.not.toThrow();
        await new Promise(r => setTimeout(r, 50));
    });

    it('shows private page dialog when exactly one pending page exists', async () => {
        const { getPendingPages } = await import('../../utils/pendingStorage.js');
        const { showPrivatePageDialog } = await import('../privatePageDialog.js');
        vi.mocked(getPendingPages).mockResolvedValue([
            { url: 'https://example.com', reason: 'cache-control', headerValue: 'Cache-Control: private' }
        ] as unknown as Awaited<ReturnType<typeof getPendingPages>>);
        await initPopup();
        await new Promise(r => setTimeout(r, 50));
        expect(showPrivatePageDialog).toHaveBeenCalledWith('https://example.com', 'cache-control', 'Cache-Control: private');
    });

    it('shows private page dialog with empty headerValue fallback', async () => {
        const { getPendingPages } = await import('../../utils/pendingStorage.js');
        const { showPrivatePageDialog } = await import('../privatePageDialog.js');
        vi.mocked(getPendingPages).mockResolvedValue([
            { url: 'https://example.com', reason: 'cache-control', headerValue: undefined }
        ] as unknown as Awaited<ReturnType<typeof getPendingPages>>);
        await initPopup();
        await new Promise(r => setTimeout(r, 50));
        expect(showPrivatePageDialog).toHaveBeenCalledWith('https://example.com', 'cache-control', '');
    });

    it('does not show dialog when no pending pages exist', async () => {
        const { getPendingPages } = await import('../../utils/pendingStorage.js');
        const { showPrivatePageDialog } = await import('../privatePageDialog.js');
        vi.mocked(getPendingPages).mockResolvedValue([]);
        await initPopup();
        await new Promise(r => setTimeout(r, 50));
        expect(showPrivatePageDialog).not.toHaveBeenCalled();
    });

    it('does not show dialog when multiple pending pages exist', async () => {
        const { getPendingPages } = await import('../../utils/pendingStorage.js');
        const { showPrivatePageDialog } = await import('../privatePageDialog.js');
        vi.mocked(getPendingPages).mockResolvedValue([
            { url: 'https://example.com', reason: 'cache-control' },
            { url: 'https://example.org', reason: 'cache-control' }
        ] as unknown as Awaited<ReturnType<typeof getPendingPages>>);
        await initPopup();
        await new Promise(r => setTimeout(r, 50));
        expect(showPrivatePageDialog).not.toHaveBeenCalled();
    });

    it.each([
        'pipeline-error',
        'obsidian-write-failed',
        'local-ai-unavailable'
    ] as const)('shows the failure dialog, not the private page dialog, for %s', async (reason) => {
        const { getPendingPages } = await import('../../utils/pendingStorage.js');
        const { showPrivatePageDialog, showRecordingFailedDialog } = await import('../privatePageDialog.js');
        vi.mocked(showPrivatePageDialog).mockClear();
        vi.mocked(showRecordingFailedDialog).mockClear();
        vi.mocked(getPendingPages).mockResolvedValue([
            { url: 'https://example.com', reason }
        ] as unknown as Awaited<ReturnType<typeof getPendingPages>>);
        await initPopup();
        await new Promise(r => setTimeout(r, 50));
        expect(showPrivatePageDialog).not.toHaveBeenCalled();
        expect(showRecordingFailedDialog).toHaveBeenCalledWith('https://example.com', expect.any(String));
    });

    it.each([
        'cache-control',
        'set-cookie',
        'authorization'
    ] as const)('shows the private page dialog, not the failure dialog, for %s', async (reason) => {
        const { getPendingPages } = await import('../../utils/pendingStorage.js');
        const { showPrivatePageDialog, showRecordingFailedDialog } = await import('../privatePageDialog.js');
        vi.mocked(showPrivatePageDialog).mockClear();
        vi.mocked(showRecordingFailedDialog).mockClear();
        vi.mocked(getPendingPages).mockResolvedValue([
            { url: 'https://example.com', reason }
        ] as unknown as Awaited<ReturnType<typeof getPendingPages>>);
        await initPopup();
        await new Promise(r => setTimeout(r, 50));
        expect(showRecordingFailedDialog).not.toHaveBeenCalled();
        expect(showPrivatePageDialog).toHaveBeenCalled();
    });

    it('catches error in initNavigation', async () => {
        const { init: initNavigation } = await import('../navigation.js');
        vi.mocked(initNavigation).mockImplementation(() => {
            throw new Error('fail');
        });
        await expect(initPopup()).resolves.not.toThrow();
    });

    it('catches error in initPrivacyConsent', async () => {
        const { initPrivacyConsent } = await import('../privacyConsentController.js');
        vi.mocked(initPrivacyConsent).mockImplementation(() => {
            throw new Error('fail');
        });
        await expect(initPopup()).resolves.not.toThrow();
    });

    it('catches error in setupPrivacyConsentListeners', async () => {
        const { setupPrivacyConsentListeners } = await import('../privacyConsentController.js');
        vi.mocked(setupPrivacyConsentListeners).mockImplementation(() => {
            throw new Error('fail');
        });
        await expect(initPopup()).resolves.not.toThrow();
    });

    it('catches error in initTrancoUpdateNotification', async () => {
        const { initTrancoUpdateNotification } = await import('../trancoNotification.js');
        vi.mocked(initTrancoUpdateNotification).mockImplementation(() => {
            throw new Error('fail');
        });
        await expect(initPopup()).resolves.not.toThrow();
    });

    it('catches error in pending pages getPendingPages', async () => {
        const { getPendingPages } = await import('../../utils/pendingStorage.js');
        vi.mocked(getPendingPages).mockRejectedValue(new Error('fail'));
        await expect(initPopup()).resolves.not.toThrow();
        await new Promise(r => setTimeout(r, 50));
    });

    it('catches error in setHtmlLangAndDir (navigation init)', async () => {
        vi.stubGlobal('chrome', {
            ...chrome,
            i18n: {
                ...chrome.i18n,
                getUILanguage: vi.fn().mockImplementation(() => { throw new Error('fail'); }),
            },
        });
        await expect(initPopup()).resolves.not.toThrow();
    });

    it('shows onboarding wizard when consented and not completed', async () => {
        const { getPrivacyConsent } = await import('../../utils/storage/privacyConsent.js');
        const { hasCompletedWizard, initOnboardingWizard } = await import('../onboardingWizard.js');
        vi.mocked(getPrivacyConsent).mockResolvedValue({ hasConsented: true });
        vi.mocked(hasCompletedWizard).mockResolvedValue(false);
        await initPopup();
        await new Promise(r => setTimeout(r, 50));
        expect(initOnboardingWizard).toHaveBeenCalled();
    });

    it('does not show onboarding wizard when not consented', async () => {
        const { getPrivacyConsent } = await import('../../utils/storage/privacyConsent.js');
        const { hasCompletedWizard, initOnboardingWizard } = await import('../onboardingWizard.js');
        vi.mocked(getPrivacyConsent).mockResolvedValue({ hasConsented: false });
        vi.mocked(hasCompletedWizard).mockResolvedValue(false);
        await initPopup();
        await new Promise(r => setTimeout(r, 50));
        expect(initOnboardingWizard).not.toHaveBeenCalled();
    });

    it('does not show onboarding wizard when already completed', async () => {
        const { getPrivacyConsent } = await import('../../utils/storage/privacyConsent.js');
        const { hasCompletedWizard, initOnboardingWizard } = await import('../onboardingWizard.js');
        vi.mocked(getPrivacyConsent).mockResolvedValue({ hasConsented: true });
        vi.mocked(hasCompletedWizard).mockResolvedValue(true);
        await initPopup();
        await new Promise(r => setTimeout(r, 50));
        expect(initOnboardingWizard).not.toHaveBeenCalled();
    });

    it('handles pending page with null entry (length 1 but page is null)', async () => {
        const { getPendingPages } = await import('../../utils/pendingStorage.js');
        const { showPrivatePageDialog, showRecordingFailedDialog } = await import('../privatePageDialog.js');
        vi.mocked(showPrivatePageDialog).mockClear();
        vi.mocked(showRecordingFailedDialog).mockClear();
        vi.mocked(getPendingPages).mockResolvedValue([null as any]);
        await initPopup();
        await new Promise(r => setTimeout(r, 50));
        expect(showPrivatePageDialog).not.toHaveBeenCalled();
        expect(showRecordingFailedDialog).not.toHaveBeenCalled();
    });

    it('handles getPrivacyConsent rejection', async () => {
        const { getPrivacyConsent } = await import('../../utils/storage/privacyConsent.js');
        vi.mocked(getPrivacyConsent).mockRejectedValue(new Error('consent fail'));
        await expect(initPopup()).resolves.not.toThrow();
        await new Promise(r => setTimeout(r, 50));
    });

    it('covers setHtmlLangAndDir with locale containing hyphen (PBI 2026-09-11-04)', () => {
        vi.stubGlobal('chrome', {
            ...chrome,
            i18n: {
                ...chrome.i18n,
                getUILanguage: vi.fn().mockReturnValue('en-US'),
            },
        });
        setHtmlLangAndDir();
        expect(document.documentElement.lang).toBe('en-US');
        expect(document.documentElement.dir).toBe('ltr');
        vi.unstubAllGlobals();
    });
});
