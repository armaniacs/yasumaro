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

import { loadPendingPages, saveSelectedPages } from '../pendingPages.js';
import { getPendingPages } from '../../utils/pendingStorage.js';

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
});
