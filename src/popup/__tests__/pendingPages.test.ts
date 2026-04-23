// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/pendingStorage.js', () => ({
    getPendingPages: vi.fn().mockResolvedValue([]),
    removePendingPages: vi.fn().mockResolvedValue(undefined),
    savePendingPages: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../i18n.js', () => ({
    getMessage: vi.fn((key: string) => key),
}));

vi.mock('../errorUtils.js', () => ({
    showSuccess: vi.fn(),
    showError: vi.fn(),
}));

vi.mock('../domUtils.js', () => ({
    escapeHtml: vi.fn((s: string) => s),
}));

vi.mock('../../utils/storage.js', () => ({
    getSettings: vi.fn().mockResolvedValue({}),
    saveSettings: vi.fn().mockResolvedValue(undefined),
    StorageKeys: {
        DOMAIN_WHITELIST: 'domain_whitelist',
        DOMAIN_BLACKLIST: 'domain_blacklist',
    },
}));

vi.mock('../../utils/addDomainsOrPathsToWhitelist.js', () => ({
    addDomainsOrPathsToWhitelist: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../utils/logger.js', () => ({
    logError: vi.fn(),
    ErrorCode: {
        CONTENT_EXTRACTION_FAILURE: 'CONTENT_EXTRACTION_FAILURE',
    },
}));

// Mock Chrome APIs
const mockChrome = {
    runtime: {
        sendMessage: vi.fn().mockResolvedValue({}),
    },
    storage: {
        local: {
            get: vi.fn().mockResolvedValue({}),
            set: vi.fn().mockResolvedValue(undefined),
        },
    },
    tabs: {
        create: vi.fn().mockResolvedValue({}),
    },
    i18n: {
        getMessage: vi.fn((key: string) => `mock_${key}`),
    },
};

Object.defineProperty(global, 'chrome', {
    value: mockChrome,
    writable: true,
});

// Mock confirm
global.confirm = vi.fn();

import { loadPendingPages, saveSelectedPages, setupEventListeners } from '../pendingPages.js';
import { getPendingPages, removePendingPages } from '../../utils/pendingStorage.js';
import { showSuccess } from '../errorUtils.js';
import { logError } from '../../utils/logger.js';

// Import pendingPages.ts to set up event listeners
import '../pendingPages.js';

describe('loadPendingPages', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <div id="pending-section" class="hidden"></div>
            <div id="pending-empty"></div>
            <div id="pending-pages-list"></div>
        `;
    });

    it('shows empty state when no pending pages', async () => {
        (getPendingPages as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
        await loadPendingPages();
        const section = document.getElementById('pending-section');
        expect(section!.classList.contains('hidden')).toBe(true);
    });

    it('renders pending pages when pages exist', async () => {
        (getPendingPages as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
            { url: 'https://example.com', title: 'Example', reason: 'test', headerValue: '' }
        ]);
        await loadPendingPages();
        const list = document.getElementById('pending-pages-list');
        expect(list!.querySelector('.pending-item')).not.toBeNull();
    });

    it('shows multiple pending pages', async () => {
        (getPendingPages as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
            { url: 'https://a.com', title: 'A', reason: 'r1', headerValue: '' },
            { url: 'https://b.com', title: 'B', reason: 'r2', headerValue: '' },
        ]);
        await loadPendingPages();
        const list = document.getElementById('pending-pages-list');
        expect(list!.querySelectorAll('.pending-item').length).toBe(2);
    });

    it('opens tab when title is clicked', async () => {
        (getPendingPages as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
            { url: 'https://example.com', title: 'Example', reason: 'test', headerValue: '' }
        ]);
        await loadPendingPages();
        const titleEl = document.querySelector('.pending-item-title') as HTMLElement;
        const createSpy = vi.spyOn(chrome.tabs, 'create').mockResolvedValue({});
        titleEl.click();
        expect(createSpy).toHaveBeenCalledWith({ url: 'https://example.com' });
    });

    it('logs error when getPendingPages throws', async () => {
        (getPendingPages as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('fail'));
        await loadPendingPages();
        expect(logError).toHaveBeenCalledWith(
            'Failed to load pending pages',
            expect.any(Object),
            'CONTENT_EXTRACTION_FAILURE'
        );
    });
});

describe('saveSelectedPages', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <div id="pending-section"></div>
            <div id="pending-empty"></div>
            <div id="pending-pages-list"></div>
        `;
        (getPendingPages as ReturnType<typeof vi.fn>).mockResolvedValue([
            { url: 'https://example.com', title: 'Example', reason: 'test', headerValue: '' }
        ]);
    });

    it('does nothing when no checkboxes are checked', async () => {
        document.body.innerHTML += `<input type="checkbox" class="pending-checkbox" value="https://example.com">`;
        await expect(saveSelectedPages()).resolves.not.toThrow();
    });

    it('processes checked checkboxes and sends messages', async () => {
        document.body.innerHTML += `
            <input type="checkbox" class="pending-checkbox" value="https://example.com" checked>
        `;
        const sendMessageSpy = vi.spyOn(chrome.runtime, 'sendMessage').mockResolvedValue({});
        await saveSelectedPages();
        expect(sendMessageSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'record' }));
    });

    it('adds path regex to whitelist when whitelistType is path', async () => {
        document.body.innerHTML += `
            <input type="checkbox" class="pending-checkbox" value="https://example.com/page" checked>
        `;
        (getPendingPages as ReturnType<typeof vi.fn>).mockResolvedValue([
            { url: 'https://example.com/page', title: 'Example Page', reason: 'test', headerValue: '' }
        ]);
        const storageSetSpy = vi.spyOn(chrome.storage.local, 'set').mockResolvedValue(undefined);
        const sendMessageSpy = vi.spyOn(chrome.runtime, 'sendMessage').mockResolvedValue({});
        await saveSelectedPages('path');
        expect(storageSetSpy).toHaveBeenCalledWith({
            domainWhitelist: expect.arrayContaining(['^https://example\\.com/page$'])
        });
        expect(sendMessageSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'record' }));
    });
});

// Set up DOM elements and event listeners
document.body.innerHTML = `
    <div id="pending-section"></div>
    <div id="pending-empty"></div>
    <div id="pending-pages-list"></div>
    <div id="mainStatus"></div>
    <button id="btn-select-all"></button>
    <button id="btn-save-selected"></button>
    <button id="btn-save-whitelist"></button>
    <button id="btn-discard"></button>
`;

// Set up event listeners after DOM is ready
setupEventListeners();

describe('DOM Event Listeners', () => {
    beforeEach(() => {
        // Re-create DOM elements and set up event listeners
        document.body.innerHTML = `
            <div id="pending-section"></div>
            <div id="pending-empty"></div>
            <div id="pending-pages-list"></div>
            <div id="mainStatus"></div>
            <button id="btn-select-all"></button>
            <button id="btn-save-selected"></button>
            <button id="btn-save-whitelist"></button>
            <button id="btn-discard"></button>
        `;
        setupEventListeners();
        (getPendingPages as ReturnType<typeof vi.fn>).mockResolvedValue([
            { url: 'https://example.com', title: 'Example', reason: 'test', headerValue: '' }
        ]);
        vi.clearAllMocks();
    });

    describe('btn-select-all click', () => {
        it('checks all checkboxes when some are unchecked', () => {
            document.getElementById('pending-pages-list')!.innerHTML = `
                <input type="checkbox" class="pending-checkbox" value="https://a.com">
                <input type="checkbox" class="pending-checkbox" value="https://b.com">
            `;

            const button = document.getElementById('btn-select-all')!;
            button.click();

            const checkboxes = document.querySelectorAll('.pending-checkbox') as NodeListOf<HTMLInputElement>;
            expect(Array.from(checkboxes).every(cb => cb.checked)).toBe(true);
        });

        it('unchecks all checkboxes when all are checked', () => {
            document.getElementById('pending-pages-list')!.innerHTML = `
                <input type="checkbox" class="pending-checkbox" value="https://a.com" checked>
                <input type="checkbox" class="pending-checkbox" value="https://b.com" checked>
            `;

            const button = document.getElementById('btn-select-all')!;
            button.click();

            const checkboxes = document.querySelectorAll('.pending-checkbox') as NodeListOf<HTMLInputElement>;
            expect(Array.from(checkboxes).every(cb => !cb.checked)).toBe(true);
        });
    });

    describe('btn-save-selected click', () => {
        it('calls saveSelectedPages when clicked', async () => {
            // Add checkbox to DOM
            document.getElementById('pending-pages-list')!.innerHTML = `
                <input type="checkbox" class="pending-checkbox" value="https://example.com" checked>
            `;

            const sendMessageSpy = vi.spyOn(chrome.runtime, 'sendMessage').mockResolvedValue({});

            const button = document.getElementById('btn-save-selected')!;
            button.click();

            // Wait for async operations
            await new Promise(resolve => setTimeout(resolve, 0));

            expect(sendMessageSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'record' }));
        });
    });

    describe('btn-save-whitelist click', () => {
        it('calls saveSelectedPages with domain whitelist when clicked', async () => {
            // Add checkbox to DOM
            document.getElementById('pending-pages-list')!.innerHTML = `
                <input type="checkbox" class="pending-checkbox" value="https://example.com" checked>
            `;

            const storageSetSpy = vi.spyOn(chrome.storage.local, 'set').mockResolvedValue(undefined);
            const sendMessageSpy = vi.spyOn(chrome.runtime, 'sendMessage').mockResolvedValue({});

            const button = document.getElementById('btn-save-whitelist')!;
            button.click();

            // Wait for async operations
            await new Promise(resolve => setTimeout(resolve, 0));

            expect(storageSetSpy).toHaveBeenCalled();
            expect(sendMessageSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'record' }));
        });
    });

    describe('btn-discard click', () => {
        it('shows message when no items selected', async () => {
            // Add unchecked checkbox to DOM
            document.getElementById('pending-pages-list')!.innerHTML = `
                <input type="checkbox" class="pending-checkbox" value="https://example.com">
            `;

            const showSuccessSpy = vi.spyOn({ showSuccess }, 'showSuccess');

            const button = document.getElementById('btn-discard')!;
            button.click();

            // Wait for async operations
            await new Promise(resolve => setTimeout(resolve, 0));

            expect(showSuccessSpy).toHaveBeenCalledWith(
                expect.any(Element),
                expect.stringContaining('pendingPagesEmpty')
            );
        });

        it('removes selected pages when confirmed', async () => {
            // Add checked checkbox to DOM
            document.getElementById('pending-pages-list')!.innerHTML = `
                <input type="checkbox" class="pending-checkbox" value="https://example.com" checked>
            `;

            (global.confirm as ReturnType<typeof vi.fn>).mockReturnValue(true);
            const removeSpy = vi.spyOn({ removePendingPages }, 'removePendingPages');

            const button = document.getElementById('btn-discard')!;
            button.click();

            // Wait for async operations
            await new Promise(resolve => setTimeout(resolve, 0));

            expect(global.confirm).toHaveBeenCalledWith('mock_warningConfirmSave');
            expect(removeSpy).toHaveBeenCalledWith(['https://example.com']);
        });

        it('does not remove pages when not confirmed', async () => {
            // Add checked checkbox to DOM
            document.getElementById('pending-pages-list')!.innerHTML = `
                <input type="checkbox" class="pending-checkbox" value="https://example.com" checked>
            `;

            (global.confirm as ReturnType<typeof vi.fn>).mockReturnValue(false);
            const removeSpy = vi.spyOn({ removePendingPages }, 'removePendingPages');

            const button = document.getElementById('btn-discard')!;
            button.click();

            // Wait for async operations
            await new Promise(resolve => setTimeout(resolve, 0));

            expect(global.confirm).toHaveBeenCalledWith('mock_warningConfirmSave');
            expect(removeSpy).not.toHaveBeenCalled();
        });
    });
});
